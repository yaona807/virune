import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { checkModule as checkModuleBase } from '../src/checker/checker.js';
import { buildProject } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { buildProject as buildProjectBase, ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

function providerForGeneration(generation: number): JsInteropProvider {
	return {
		id: 'cache-rebind-provider',
		version: '1',
		generation,
		resolveImport(request) {
			return {
				type: {
					ref: { providerId: 'cache-rebind-provider', generation, id: 'value' },
					display: 'Value',
					category: 'object',
					origin: { moduleSpecifier: request.moduleSpecifier, exportName: request.importedName ?? 'value' },
				},
				runtime: { kind: 'named', importedName: request.importedName ?? 'value' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: `cache-rebind-provider-${generation}`,
				},
			};
		},
		getProperty(reference, name) {
			return {
				ref: { providerId: reference.providerId, generation: reference.generation, id: `${reference.id}.${name}` },
				display: 'string',
				category: 'primitive',
				primitive: 'string',
				origin: { moduleSpecifier: './library.js', exportName: name },
			};
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

const sourceText = [
	'import js { value } from "./library.js"',
	'',
	'fn main() -> Unit uses JavaScript {',
	'\tdiscard value.field',
	'}',
	'',
].join('\n');

function memoryHost(mainPath: string): ProjectHost {
	return multiFileHost(new Map([[mainPath, sourceText]]));
}

function multiFileHost(files: ReadonlyMap<string, string>): ProjectHost {
	return {
		async readFile(path) {
			const text = files.get(path);
			if (text !== undefined) return text;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

function gatedMultiFileHost(files: ReadonlyMap<string, string>, gatedPath: string): {
	readonly host: ProjectHost;
	readonly entered: Promise<void>;
	readonly release: () => void;
} {
	let markEntered: () => void = () => {};
	let release: () => void = () => {};
	const entered = new Promise<void>(resolveEntered => { markEntered = resolveEntered; });
	const gate = new Promise<void>(resolveGate => { release = resolveGate; });
	return {
		entered,
		release: () => release(),
		host: {
			async readFile(path) {
				const text = files.get(path);
				if (text === undefined) throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
				if (path === gatedPath) {
					markEntered();
					await gate;
				}
				return text;
			},
		},
	};
}

test('cached semantic cannot be rebound after an independent checker pass advances its witness', async () => {
	const root = resolve('virtual-operation-session-cache-rebind-project');
	const mainPath = join(root, 'src/main.virune');
	const host = memoryHost(mainPath);
	const cache = new ProjectBuildCache();
	const firstProvider = providerForGeneration(1);
	const first = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: firstProvider,
	});
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(
		externalOperationSequence({ module: firstMain.ast, semantic: firstMain.semantic }).map(operation => operation.kind),
		['module-load', 'read-property'],
	);

	const independent = checkModuleBase(firstMain.ast, {
		containingFile: mainPath,
		platform: 'node',
		jsInteropProvider: providerForGeneration(2),
	});
	assert.deepEqual(independent.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	await assert.rejects(
		buildProject(root, {
			write: false,
			host,
			incrementalCache: cache,
			jsInteropProvider: firstProvider,
		}),
		/Cannot reuse experimental project cache after its checked result was mutated/u,
		'cache preflight must reject a previously exposed checked module whose checker witness advanced',
	);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
		'a rejected cached rebind must not revive the stale semantic session',
	);
});

test('checked results from an unregistered stable project cache are rebuilt before experimental promotion', async () => {
	const root = resolve('virtual-operation-session-stable-cache-promotion-project');
	const mainPath = join(root, 'src/main.virune');
	const host = memoryHost(mainPath);
	const cache = new ProjectBuildCache();
	const firstProvider = providerForGeneration(1);
	const stable = await buildProjectBase(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: firstProvider,
	});
	assert.deepEqual(stable.diagnostics.filter(item => item.severity === 'error'), []);
	const stableMain = stable.modules.find(module => module.source.path === mainPath);
	assert.ok(stableMain?.ast);
	assert.ok(stableMain.semantic);
	assert.throws(
		() => externalOperationSequence({ module: stableMain.ast!, semantic: stableMain.semantic! }),
		/not from the current checked AST semantic session/u,
		'base project results must not be operation-authorized before experimental registration',
	);

	await assert.rejects(
		buildProject(root, {
			write: false,
			host,
			incrementalCache: cache,
			jsInteropProvider: firstProvider,
		}),
		/Cannot promote checked results from an unregistered project cache/u,
		'checked objects exposed by a non-experimental cache cannot become first-registration truth',
	);
	assert.throws(
		() => externalOperationSequence({ module: stableMain.ast!, semantic: stableMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const rebuilt = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: firstProvider,
	});
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	const rebuiltMain = rebuilt.modules.find(module => module.source.path === mainPath);
	assert.ok(rebuiltMain?.ast);
	assert.ok(rebuiltMain.semantic);
	assert.notEqual(rebuiltMain.ast, stableMain.ast, 'rejected promotion must clear cached checked source before retry');
	assert.deepEqual(
		externalOperationSequence({ module: rebuiltMain.ast, semantic: rebuiltMain.semantic }).map(operation => operation.kind),
		['module-load', 'read-property'],
	);
});

test('untracked multi-module stable cache remains unauthorized after rejected promotion', async () => {
	const root = resolve('virtual-operation-session-untracked-multi-module-cache-project');
	const mainPath = join(root, 'src/main.virune');
	const helperPath = join(root, 'src/helper.virune');
	const mainSource = [
		'import { helper } from "./helper.virune"',
		'import js { value } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard value.field',
		'}',
		'',
	].join('\n');
	const helperSource = 'pub fn helper() -> Unit {}\n';
	const files = new Map([
		[mainPath, mainSource],
		[helperPath, helperSource],
	]);
	const host = multiFileHost(files);
	const cache = new ProjectBuildCache();
	const stable = await buildProjectBase(root, {
		write: false,
		host,
		incrementalCache: cache,
		jsInteropProvider: providerForGeneration(1),
	});
	assert.deepEqual(stable.diagnostics.filter(item => item.severity === 'error'), []);
	const stableHelper = stable.modules.find(module => module.source.path === helperPath);
	assert.ok(stableHelper?.ast);
	assert.ok(stableHelper.semantic);

	await assert.rejects(
		buildProject(root, {
			write: false,
			host,
			incrementalCache: cache,
			jsInteropProvider: providerForGeneration(1),
		}),
		/Cannot promote checked results from an unregistered project cache/u,
	);
	assert.throws(
		() => externalOperationSequence({ module: stableHelper.ast!, semantic: stableHelper.semantic! }),
		/not from the current checked AST semantic session/u,
	);
});

test('tracked multi-module re-registration rolls back earlier modules when a later source changed mid-build', async () => {
	const root = resolve('virtual-operation-session-cache-rebind-rollback-project');
	const mainPath = join(root, 'src/main.virune');
	const helperPath = join(root, 'src/helper.virune');
	const mainSource = [
		'import { helper } from "./helper.virune"',
		'import js { value } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard value.field',
		'}',
		'',
	].join('\n');
	const helperSource = 'pub fn helper() -> Unit {}\n';
	const files = new Map([
		[mainPath, mainSource],
		[helperPath, helperSource],
	]);
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, {
		write: false,
		host: multiFileHost(files),
		incrementalCache: cache,
		jsInteropProvider: providerForGeneration(1),
	});
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	const firstHelper = first.modules.find(module => module.source.path === helperPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.ok(firstHelper?.ast);
	assert.ok(firstHelper.semantic);
	assert.deepEqual(
		first.modules.filter(module => module.semantic !== undefined).map(module => module.source.path),
		[helperPath, mainPath],
		'test must register helper before the later main-module failure',
	);
	assert.deepEqual(externalOperationSequence({ module: firstHelper.ast, semantic: firstHelper.semantic }), []);

	const gated = gatedMultiFileHost(files, mainPath);
	const pending = buildProject(root, {
		write: false,
		host: gated.host,
		incrementalCache: cache,
		jsInteropProvider: providerForGeneration(1),
	});
	await gated.entered;
	const jsImport = firstMain.ast.imports.find(item => item.sourceKind === 'javascript');
	assert.ok(jsImport);
	(jsImport as { typeOnly: boolean }).typeOnly = true;
	gated.release();
	await assert.rejects(
		pending,
		/Cannot reuse checked semantic after its checked source graph changed/u,
	);
	assert.throws(
		() => externalOperationSequence({ module: firstHelper.ast!, semantic: firstHelper.semantic! }),
		/not from the current checked AST semantic session/u,
		'helper re-registration before the later main failure must be rolled back',
	);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const rebuilt = await buildProject(root, {
		write: false,
		host: multiFileHost(files),
		incrementalCache: cache,
		jsInteropProvider: providerForGeneration(1),
	});
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	const rebuiltMain = rebuilt.modules.find(module => module.source.path === mainPath);
	assert.ok(rebuiltMain?.ast);
	assert.ok(rebuiltMain.semantic);
	assert.deepEqual(
		externalOperationSequence({ module: rebuiltMain.ast, semantic: rebuiltMain.semantic }).map(operation => operation.kind),
		['module-load', 'read-property'],
	);
});
