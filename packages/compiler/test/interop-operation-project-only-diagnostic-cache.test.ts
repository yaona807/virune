import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type * as A from '../src/ast/nodes.js';
import type { SemanticModel } from '../src/checker/checker.js';
import { buildProject, IncrementalProjectBuilder } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { ProjectBuildCache, type ProjectHost, type ProjectBuildResult } from '../src/project/project.js';

const mainText = [
	'import { missing } from "./helper.virune"',
	'import js "./library.js"',
	'',
	'fn main() -> Unit uses JavaScript {}',
	'',
].join('\n');
const helperText = 'pub fn helper() -> Unit {}\n';

function provider(): JsInteropProvider {
	return {
		id: 'project-only-diagnostic-provider',
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
					providerVersion: 'project-only-diagnostic-provider-1',
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

function hostFor(mainPath: string, helperPath: string): ProjectHost {
	return {
		async readFile(path) {
			if (path === mainPath) return mainText;
			if (path === helperPath) return helperText;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

function mainModule(result: ProjectBuildResult, mainPath: string): {
	readonly ast: A.ModuleNode;
	readonly semantic: SemanticModel;
} {
	const module = result.modules.find(item => item.source.path === mainPath);
	assert.ok(module?.ast);
	assert.ok(module.semantic);
	return { ast: module.ast, semantic: module.semantic };
}

function assertProjectOnlyFailure(result: ProjectBuildResult, mainPath: string): void {
	assert.ok(result.diagnostics.some(item => item.code === 'L4004' && item.severity === 'error'));
	const main = mainModule(result, mainPath);
	assert.deepEqual(
		main.semantic.diagnostics.items.filter(item => item.severity === 'error'),
		[],
		'test must isolate a project-only import-model error absent from the checker SemanticModel',
	);
	assert.deepEqual(
		externalOperationSequence({ module: main.ast, semantic: main.semantic }),
		[],
		'project-only failure must withhold otherwise-resolvable ModuleLoad evidence',
	);
}

test('ProjectBuildCache does not retain checked results from a project-only error build', async () => {
	const root = resolve('virtual-operation-project-only-diagnostic-cache');
	const mainPath = join(root, 'src/main.virune');
	const helperPath = join(root, 'src/helper.virune');
	const host = hostFor(mainPath, helperPath);
	const cache = new ProjectBuildCache();

	const first = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: provider(),
	});
	assertProjectOnlyFailure(first, mainPath);
	const firstMain = mainModule(first, mainPath);

	const second = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: provider(),
	});
	assertProjectOnlyFailure(second, mainPath);
	assert.equal(second.stats.reusedParsedModules, 0, 'failed project must be reparsed on retry');
	assert.equal(second.stats.reusedCheckedModules, 0, 'failed project must be rechecked on retry');
	assert.notEqual(mainModule(second, mainPath).semantic, firstMain.semantic);
});

test('IncrementalProjectBuilder clears checked cache after a project-only error build', async () => {
	const root = resolve('virtual-operation-builder-project-only-diagnostic-cache');
	const mainPath = join(root, 'src/main.virune');
	const helperPath = join(root, 'src/helper.virune');
	const host = hostFor(mainPath, helperPath);
	const builder = new IncrementalProjectBuilder();

	const first = await builder.build(root, {
		write: false,
		host,
		jsInteropProvider: provider(),
	});
	assertProjectOnlyFailure(first, mainPath);
	const firstMain = mainModule(first, mainPath);

	const second = await builder.build(root, {
		write: false,
		host,
		jsInteropProvider: provider(),
	});
	assertProjectOnlyFailure(second, mainPath);
	assert.equal(second.stats.reusedParsedModules, 0, 'failed builder project must be reparsed on retry');
	assert.equal(second.stats.reusedCheckedModules, 0, 'failed builder project must be rechecked on retry');
	assert.notEqual(mainModule(second, mainPath).semantic, firstMain.semantic);
});
