import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { buildProject as buildProjectBase, ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

const sourceText = [
	'import js "./library.js"',
	'',
	'fn main() -> Unit uses JavaScript {}',
	'',
].join('\n');

function provider(generation: number): JsInteropProvider {
	return {
		id: 'parsed-cache-provenance-provider',
		version: '1',
		generation,
		resolveImport(request) {
			if (request.kind !== 'side-effect') throw new Error('test provider expects side-effect imports');
			return {
				runtime: { kind: 'side-effect' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: `parsed-cache-provenance-provider-${generation}`,
				},
			};
		},
		getProperty() { return undefined; },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'unknown'; },
	};
}

function hostFor(mainPath: string): ProjectHost {
	return {
		async readFile(path) {
			if (path === mainPath) return sourceText;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

function gatedHostFor(mainPath: string): { readonly host: ProjectHost; readonly entered: Promise<void>; readonly release: () => void } {
	let markEntered: () => void = () => {};
	let releaseGate: () => void = () => {};
	const entered = new Promise<void>(resolveEntered => { markEntered = resolveEntered; });
	const gate = new Promise<void>(resolveGate => { releaseGate = resolveGate; });
	return {
		entered,
		release: () => releaseGate(),
		host: {
			async readFile(path) {
				if (path === mainPath) {
					markEntered();
					await gate;
					return sourceText;
				}
				throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
			},
		},
	};
}

test('stable API parsed-AST reuse cannot be promoted after public mutation even when checker evidence is fresh', async () => {
	const root = resolve('virtual-operation-session-untracked-parsed-cache');
	const mainPath = join(root, 'src/main.virune');
	const host = hostFor(mainPath);
	const cache = new ProjectBuildCache();

	const stable = await buildProjectBase(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: provider(1),
	});
	assert.deepEqual(stable.diagnostics.filter(item => item.severity === 'error'), []);
	const exposed = stable.modules.find(module => module.source.path === mainPath);
	assert.ok(exposed?.ast);
	assert.ok(exposed.semantic);
	assert.equal(exposed.ast.imports[0]?.typeOnly, false);

	(exposed.ast.imports[0] as { typeOnly: boolean }).typeOnly = true;
	await assert.rejects(
		buildProject(root, {
			write: false,
			host,
			incrementalCache: cache,
			jsInteropProvider: provider(2),
		}),
		/Cannot promote parsed or checked results from an unregistered or changed project cache/u,
		'untracked parsed reuse must not become trusted merely because provider invalidation produced a fresh semantic',
	);

	const rebuilt = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: provider(2),
	});
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	assert.equal(rebuilt.stats.reusedParsedModules, 0, 'rejected provenance must clear the mutated parsed cache');
	const main = rebuilt.modules.find(module => module.source.path === mainPath);
	assert.ok(main?.ast);
	assert.ok(main.semantic);
	assert.equal(main.ast.imports[0]?.typeOnly, false, 'fresh retry must reconstruct the source-authored runtime import');
	assert.deepEqual(
		externalOperationSequence({ module: main.ast, semantic: main.semantic }).map(operation => operation.kind),
		['module-load'],
	);
});

test('tracked parsed reuse rejects mid-build source mutation when provider invalidation creates a fresh semantic', async () => {
	const root = resolve('virtual-operation-session-tracked-parsed-mid-build-mutation');
	const mainPath = join(root, 'src/main.virune');
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, {
		write: false,
		host: hostFor(mainPath),
		incrementalCache: cache,
		jsInteropProvider: provider(1),
	});
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.deepEqual(
		externalOperationSequence({ module: firstMain.ast, semantic: firstMain.semantic }).map(operation => operation.kind),
		['module-load'],
	);

	const gated = gatedHostFor(mainPath);
	const pending = buildProject(root, {
		write: false,
		host: gated.host,
		incrementalCache: cache,
		jsInteropProvider: provider(2),
	});
	await gated.entered;
	(firstMain.ast.imports[0] as { typeOnly: boolean }).typeOnly = true;
	gated.release();
	await assert.rejects(
		pending,
		/Cannot promote parsed or checked results from an unregistered or changed project cache/u,
		'fresh checker evidence must not bless source-authored mutation that happened after cache preflight',
	);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const rebuilt = await buildProject(root, {
		write: false,
		host: hostFor(mainPath),
		incrementalCache: cache,
		jsInteropProvider: provider(2),
	});
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	assert.equal(rebuilt.stats.reusedParsedModules, 0, 'failed mid-build source reuse must clear the parsed cache');
	const rebuiltMain = rebuilt.modules.find(module => module.source.path === mainPath);
	assert.ok(rebuiltMain?.ast);
	assert.ok(rebuiltMain.semantic);
	assert.equal(rebuiltMain.ast.imports[0]?.typeOnly, false);
	assert.deepEqual(
		externalOperationSequence({ module: rebuiltMain.ast, semantic: rebuiltMain.semantic }).map(operation => operation.kind),
		['module-load'],
	);
});
