import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { buildProject as buildProjectBase, ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

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
	const source = [
		'import js "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {}',
		'',
	].join('\n');
	return {
		async readFile(path) {
			if (path === mainPath) return source;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
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
		/Cannot promote parsed or checked results from an unregistered project cache/u,
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
