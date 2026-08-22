import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

function provider(): JsInteropProvider {
	return {
		id: 'diagnostic-reuse-provider',
		version: '1',
		generation: 1,
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
					providerVersion: 'diagnostic-reuse-provider-1',
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
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard missingValue',
		'}',
		'',
	].join('\n');
	return {
		async readFile(path) {
			if (path === mainPath) return source;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

test('public BuiltModule diagnostic mutation cannot survive the required fresh rebuild after an error', async () => {
	const root = resolve('virtual-operation-project-cached-diagnostic-mutation');
	const mainPath = join(root, 'src/main.virune');
	const host = hostFor(mainPath);
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: provider(),
	});
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.ok(firstMain.semantic.diagnostics.items.some(item => item.severity === 'error'));
	assert.ok(firstMain.diagnostics.some(item => item.severity === 'error'));
	assert.deepEqual(externalOperationSequence({ module: firstMain.ast, semantic: firstMain.semantic }), []);

	(firstMain.diagnostics as unknown as { length: number }).length = 0;
	const second = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: provider(),
	});
	assert.equal(second.stats.reusedParsedModules, 0, 'error results must not retain parsed cache state for retry');
	assert.equal(second.stats.reusedCheckedModules, 0, 'error results must not retain checked cache state for retry');
	assert.ok(second.diagnostics.some(item => item.severity === 'error'), 'fresh rebuild must rediscover the project error');
	const secondMain = second.modules.find(module => module.source.path === mainPath);
	assert.ok(secondMain?.ast);
	assert.ok(secondMain.semantic);
	assert.notEqual(secondMain.semantic, firstMain.semantic, 'retry after an error must use a fresh semantic object');
	assert.ok(secondMain.semantic.diagnostics.items.some(item => item.severity === 'error'));
	assert.deepEqual(
		externalOperationSequence({ module: secondMain.ast, semantic: secondMain.semantic }),
		[],
		'fresh semantic errors remain authoritative after public diagnostics mutation',
	);
});
