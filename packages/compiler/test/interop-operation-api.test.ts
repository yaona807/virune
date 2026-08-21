import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { checkModule as checkModuleBase } from '../src/checker/checker.js';
import { buildProject, checkModule, compileSource, IncrementalProjectBuilder } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { parseSource, ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

function providerForGeneration(generation: number): JsInteropProvider {
	return {
		id: 'test-provider',
		version: '1',
		generation,
		resolveImport(request) {
			return {
				type: {
					ref: { providerId: 'test-provider', generation, id: 'value' },
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
					providerVersion: `provider-${generation}`,
				},
			};
		},
		getProperty() {
			return {
				ref: { providerId: 'test-provider', generation, id: 'field' },
				display: 'string',
				category: 'primitive',
				primitive: 'string',
				origin: { moduleSpecifier: './library.js', exportName: 'field' },
			};
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

const provider = providerForGeneration(1);
const source = {
	id: 1,
	path: '/virtual/main.virune',
	text: [
		'import js { value } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard value.field',
		'}',
		'',
	].join('\n'),
};

function operationKinds(module: NonNullable<ReturnType<typeof parseSource>['ast']>, semantic: Parameters<typeof externalOperationSequence>[0]['semantic']): readonly string[] {
	return externalOperationSequence({ module, semantic }).map(operation => operation.kind);
}

function memoryHost(mainPath: string, text = source.text): ProjectHost {
	return {
		async readFile(path) {
			if (path === mainPath) return text;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

function gatedHost(mainPath: string, gate: Promise<void>): ProjectHost {
	return {
		async readFile(path) {
			if (path === mainPath) {
				await gate;
				return source.text;
			}
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

test('public operation derivation is bound to the exact AST that produced its SemanticModel', () => {
	const checked = compileSource(source, { emit: false, jsInteropProvider: provider });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.ast);
	assert.ok(checked.semantic);
	assert.deepEqual(operationKinds(checked.ast, checked.semantic), ['module-load', 'read-property']);

	const reparsed = parseSource(source);
	assert.ok(reparsed.ast);
	assert.deepEqual(reparsed.diagnostics.filter(item => item.severity === 'error'), []);
	assert.throws(
		() => externalOperationSequence({ module: reparsed.ast!, semantic: checked.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const separatelyChecked = compileSource(source, { emit: false, jsInteropProvider: provider });
	assert.deepEqual(separatelyChecked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(separatelyChecked.ast);
	assert.ok(separatelyChecked.semantic);
	assert.throws(
		() => externalOperationSequence({ module: separatelyChecked.ast!, semantic: checked.semantic! }),
		/not from the current checked AST semantic session/u,
	);
});

test('project-level compilation errors withhold successful Direct operation evidence', async () => {
	const root = resolve('virtual-operation-project-diagnostic');
	const mainPath = join(root, 'src/main.virune');
	const projectRejectedSource = `unsafe module\n\n${source.text}`;
	const result = await buildProject(root, {
		write: false,
		host: memoryHost(mainPath, projectRejectedSource),
		jsInteropProvider: providerForGeneration(1),
	});
	assert.ok(result.diagnostics.some(item => item.severity === 'error' && item.code === 'L4009'));
	const main = result.modules.find(module => module.source.path === mainPath);
	assert.ok(main?.ast);
	assert.ok(main.semantic);
	assert.deepEqual(main.semantic.diagnostics.items.filter(item => item.severity === 'error'), [], 'test must isolate a project-level error absent from SemanticModel diagnostics');
	assert.deepEqual(externalOperationSequence({ module: main.ast, semantic: main.semantic }), []);
});

test('checking the same AST again invalidates the previous semantic session', () => {
	const parsed = parseSource(source);
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);

	const first = checkModule(parsed.ast, { containingFile: source.path, platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(first.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(parsed.ast, first), ['module-load', 'read-property']);

	const second = checkModule(parsed.ast, { containingFile: source.path, platform: 'node', jsInteropProvider: providerForGeneration(2) });
	assert.deepEqual(second.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, semantic: first }),
		/not from the current checked AST semantic session/u,
	);
	assert.deepEqual(operationKinds(parsed.ast, second), ['module-load', 'read-property']);
});

test('a stable checker recheck invalidates retained experimental evidence before provider resolution', () => {
	const parsed = parseSource(source);
	assert.ok(parsed.ast);
	const first = checkModule(parsed.ast, { containingFile: source.path, platform: 'node', jsInteropProvider: providerForGeneration(1) });
	assert.deepEqual(operationKinds(parsed.ast, first), ['module-load', 'read-property']);

	const next = providerForGeneration(2);
	let observedDuringResolution = false;
	const reentrantProvider: JsInteropProvider = {
		...next,
		resolveImport(request) {
			observedDuringResolution = true;
			assert.throws(
				() => externalOperationSequence({ module: parsed.ast!, semantic: first }),
				/not from the current checked AST semantic session/u,
			);
			return next.resolveImport(request);
		},
	};
	const second = checkModuleBase(parsed.ast, { containingFile: source.path, platform: 'node', jsInteropProvider: reentrantProvider });
	assert.equal(observedDuringResolution, true);
	assert.deepEqual(second.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, semantic: first }),
		/not from the current checked AST semantic session/u,
	);
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, semantic: second }),
		/not from the current checked AST semantic session/u,
		'base checker results are not promoted into the experimental public session registry',
	);
});

test('incremental project recheck invalidates retained semantics when the parsed AST is reused', async () => {
	const root = resolve('virtual-operation-session-project');
	const mainPath = join(root, 'src/main.virune');
	const host = memoryHost(mainPath);
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: providerForGeneration(1) });
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(firstMain.ast, firstMain.semantic), ['module-load', 'read-property']);

	const second = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: providerForGeneration(2) });
	const secondMain = second.modules.find(module => module.source.path === mainPath);
	assert.ok(secondMain?.ast);
	assert.ok(secondMain.semantic);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(second.stats.reusedParsedModules > 0);
	assert.equal(secondMain.ast, firstMain.ast, 'test must exercise the same cached parsed AST object');
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);
	assert.deepEqual(operationKinds(secondMain.ast, secondMain.semantic), ['module-load', 'read-property']);
});

test('cached project builds invalidate old evidence before awaiting recheck and reject concurrent cache reuse', async () => {
	const root = resolve('virtual-operation-session-pending-project');
	const mainPath = join(root, 'src/main.virune');
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, { write: false, host: memoryHost(mainPath), incrementalCache: cache, jsInteropProvider: providerForGeneration(1) });
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.deepEqual(operationKinds(firstMain.ast, firstMain.semantic), ['module-load', 'read-property']);

	let release!: () => void;
	const gate = new Promise<void>(resolveGate => { release = resolveGate; });
	const host = gatedHost(mainPath, gate);
	const pending = buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: providerForGeneration(2) });
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
		'old evidence must be invalidated synchronously when the recheck starts',
	);
	await assert.rejects(
		buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: providerForGeneration(3) }),
		/Concurrent experimental project builds cannot share one ProjectBuildCache/u,
	);
	release();
	const second = await pending;
	const secondMain = second.modules.find(module => module.source.path === mainPath);
	assert.ok(secondMain?.ast);
	assert.ok(secondMain.semantic);
	assert.deepEqual(operationKinds(secondMain.ast, secondMain.semantic), ['module-load', 'read-property']);
});

test('IncrementalProjectBuilder invalidates old evidence before awaiting recheck and rejects concurrent builds', async () => {
	const root = resolve('virtual-operation-session-builder-project');
	const mainPath = join(root, 'src/main.virune');
	const builder = new IncrementalProjectBuilder();
	const first = await builder.build(root, { write: false, host: memoryHost(mainPath), jsInteropProvider: providerForGeneration(1) });
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.deepEqual(operationKinds(firstMain.ast, firstMain.semantic), ['module-load', 'read-property']);

	let release!: () => void;
	const gate = new Promise<void>(resolveGate => { release = resolveGate; });
	const host = gatedHost(mainPath, gate);
	const pending = builder.build(root, { write: false, host, jsInteropProvider: providerForGeneration(2) });
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);
	await assert.rejects(
		builder.build(root, { write: false, host, jsInteropProvider: providerForGeneration(3) }),
		/Concurrent experimental builds cannot share one IncrementalProjectBuilder/u,
	);
	release();
	const second = await pending;
	const secondMain = second.modules.find(module => module.source.path === mainPath);
	assert.ok(secondMain?.ast);
	assert.ok(secondMain.semantic);
	assert.deepEqual(operationKinds(secondMain.ast, secondMain.semantic), ['module-load', 'read-property']);
});
