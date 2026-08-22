import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { IncrementalProjectBuilder } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import type { ProjectHost } from '../src/project/project.js';

const sourceText = [
	'import js "./library.js"',
	'',
	'fn main() -> Unit uses JavaScript {}',
	'',
].join('\n');

function provider(generation: number): JsInteropProvider {
	return {
		id: 'builder-parsed-recheck-provider',
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
					providerVersion: `builder-parsed-recheck-provider-${generation}`,
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

test('incremental builder rejects mid-build authored-source mutation across a fresh provider recheck', async () => {
	const root = resolve('virtual-operation-session-builder-fresh-recheck-mutation');
	const mainPath = join(root, 'src/main.virune');
	const builder = new IncrementalProjectBuilder();
	const first = await builder.build(root, {
		write: false,
		host: hostFor(mainPath),
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
	const pending = builder.build(root, {
		write: false,
		host: gated.host,
		jsInteropProvider: provider(2),
	});
	await gated.entered;
	(firstMain.ast.imports[0] as { typeOnly: boolean }).typeOnly = true;
	gated.release();
	await assert.rejects(
		pending,
		/Cannot reuse incremental parsed or checked results after their checked source graph changed/u,
	);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const rebuilt = await builder.build(root, {
		write: false,
		host: hostFor(mainPath),
		jsInteropProvider: provider(2),
	});
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	assert.equal(rebuilt.stats.reusedParsedModules, 0, 'rejected builder reuse must clear the mutated parsed cache');
	const rebuiltMain = rebuilt.modules.find(module => module.source.path === mainPath);
	assert.ok(rebuiltMain?.ast);
	assert.ok(rebuiltMain.semantic);
	assert.equal(rebuiltMain.ast.imports[0]?.typeOnly, false);
	assert.deepEqual(
		externalOperationSequence({ module: rebuiltMain.ast, semantic: rebuiltMain.semantic }).map(operation => operation.kind),
		['module-load'],
	);
});
