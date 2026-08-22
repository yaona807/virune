import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource as compileSourceBase } from '../src/compiler.js';
import {
	buildProject,
	compileSource,
	checkModule,
	IncrementalProjectBuilder,
	TypeChecker,
} from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import {
	buildProject as buildProjectBase,
	parseSource,
	ProjectBuildCache,
} from '../src/project/project.js';

const source = {
	id: 1,
	path: '/virtual/main.virune',
	text: [
		'import js { value } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard value.field',
		'\treturn Unit',
		'}',
		'',
	].join('\n'),
};

function providerForGeneration(generation: number, malformedProperty = false): JsInteropProvider {
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
				category: malformedProperty ? 'future-category' : 'primitive',
				primitive: 'string',
				origin: { moduleSpecifier: './library.js', exportName: 'field' },
			} as ReturnType<JsInteropProvider['getProperty']>;
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

test('experimental compiler entry points register operation evidence for the exact checked SemanticModel only', () => {
	const base = compileSourceBase(source, { emit: false, jsInteropProvider: providerForGeneration(1) });
	assert.deepEqual(base.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(base.semantic);
	assert.throws(
		() => externalOperationSequence(base.semantic!),
		/requires a registered checked SemanticModel/u,
	);

	const checked = compileSource(source, { emit: false, jsInteropProvider: providerForGeneration(1) });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.semantic);
	const operations = externalOperationSequence(checked.semantic);
	assert.deepEqual(operations.map(operation => operation.kind), ['module-load', 'read-property']);
	assert.equal(Object.isFrozen(operations), true);
	assert.equal(Object.isFrozen(operations[0]), true);

	const fabricated = { ...checked.semantic };
	assert.throws(
		() => externalOperationSequence(fabricated),
		/requires a registered checked SemanticModel/u,
	);
});

test('direct experimental checker entry points register the completed checker result', () => {
	const parsed = parseSource(source);
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);

	const semantic = checkModule(parsed.ast, {
		containingFile: source.path,
		platform: 'node',
		jsInteropProvider: providerForGeneration(1),
	});
	assert.deepEqual(semantic.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.deepEqual(externalOperationSequence(semantic).map(operation => operation.kind), ['module-load', 'read-property']);

	const checker = new TypeChecker({
		containingFile: source.path,
		platform: 'node',
		jsInteropProvider: providerForGeneration(2),
	});
	const classSemantic = checker.check(parsed.ast);
	assert.deepEqual(classSemantic.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.deepEqual(externalOperationSequence(classSemantic).map(operation => operation.kind), ['module-load', 'read-property']);
});

test('experimental project entry points register fresh and cached checked SemanticModels without changing cache semantics', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-interop-operation-api-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'src');
	await mkdir(sourceDirectory, { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: true,
		sourcesContent: true,
	}));
	await writeFile(join(sourceDirectory, 'main.virune'), source.text);

	const cache = new ProjectBuildCache();
	const provider = providerForGeneration(3);
	const base = await buildProjectBase(root, { write: false, incrementalCache: cache, jsInteropProvider: provider });
	assert.equal(base.stats.checkedModules, 1);
	assert.equal(base.stats.reusedCheckedModules, 0);
	const baseSemantic = base.modules[0]?.semantic;
	assert.ok(baseSemantic);
	assert.throws(
		() => externalOperationSequence(baseSemantic),
		/requires a registered checked SemanticModel/u,
	);

	const checked = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: provider });
	assert.equal(checked.stats.checkedModules, 0);
	assert.equal(checked.stats.reusedCheckedModules, 1);
	assert.equal(checked.modules[0]?.semantic, baseSemantic);
	assert.deepEqual(externalOperationSequence(baseSemantic).map(operation => operation.kind), ['module-load', 'read-property']);

	const incremental = new IncrementalProjectBuilder();
	const first = await incremental.build(root, { write: false, jsInteropProvider: providerForGeneration(4) });
	assert.equal(first.stats.checkedModules, 1);
	const incrementalSemantic = first.modules[0]?.semantic;
	assert.ok(incrementalSemantic);
	assert.deepEqual(externalOperationSequence(incrementalSemantic).map(operation => operation.kind), ['module-load', 'read-property']);

	const second = await incremental.build(root, { write: false, jsInteropProvider: providerForGeneration(4) });
	assert.equal(second.stats.checkedModules, 0);
	assert.equal(second.stats.reusedCheckedModules, 1);
	assert.equal(second.modules[0]?.semantic, incrementalSemantic);
});

test('later checks and later provider generations do not retroactively invalidate a completed snapshot', () => {
	const first = compileSource(source, { emit: false, jsInteropProvider: providerForGeneration(1) });
	const second = compileSource(source, { emit: false, jsInteropProvider: providerForGeneration(2) });
	assert.ok(first.semantic);
	assert.ok(second.semantic);
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);

	assert.deepEqual(externalOperationSequence(first.semantic).map(operation => operation.kind), ['module-load', 'read-property']);
	assert.deepEqual(externalOperationSequence(second.semantic).map(operation => operation.kind), ['module-load', 'read-property']);
});

test('invalid sidecar projection fails closed without changing checker acceptance or diagnostics', () => {
	const checked = compileSource(source, { emit: false, jsInteropProvider: providerForGeneration(1, true) });
	assert.deepEqual(
		checked.diagnostics.filter(item => item.severity === 'error'),
		[],
		'External Operation projection must not create new checker diagnostics',
	);
	const semantic = checked.semantic;
	assert.ok(semantic);
	assert.throws(
		() => externalOperationSequence(semantic),
		/evidence is unavailable for this checked SemanticModel/u,
	);
});
