import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource as compileSourceBase } from '../src/compiler.js';
import { buildProject, compileSource } from '../src/interop/checked-api.js';
import { externalExecutionReadiness } from '../src/interop/operation-api.js';
import { projectRuntimeModuleClosure, ProjectBuildCache } from '../src/project/project.js';
import type { JsInteropProvider, ModuleResolutionWitness } from '../src/interop/types.js';

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

const defaultImportSource = {
	...source,
	text: source.text.replace('import js { value } from "./library.js"', 'import js value from "./library.js"'),
};

const builtinImportSource = {
	...source,
	text: source.text.replace('./library.js', 'node:fs'),
};

const checkedErrorSource = {
	...source,
	text: source.text.replace('\treturn Unit', '\treturn 1'),
};

function provider(runtimeFormat: NonNullable<ModuleResolutionWitness['runtimeFormat']>, malformedProperty = false): JsInteropProvider {
	const generation = 1;
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
				runtime: request.kind === 'default'
					? { kind: 'default' }
					: { kind: 'named', importedName: request.importedName ?? 'value' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					...(runtimeFormat === 'esm' || runtimeFormat === 'commonjs' || runtimeFormat === 'builtin'
						? { runtimeEntry: runtimeFormat === 'builtin' ? 'node:fs' : 'dist/library.js' }
						: {}),
					runtimeFormat,
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'test-provider-1',
				},
			};
		},
		getProperty() {
			return {
				ref: { providerId: 'test-provider', generation, id: 'field' },
				display: 'string',
				category: malformedProperty ? 'future-category' : 'primitive',
				primitive: 'string',
			} as ReturnType<JsInteropProvider['getProperty']>;
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

test('execution readiness accepts only module loads with discharged runtime resolution', () => {
	for (const [format, input] of [
		['esm', source],
		['commonjs', defaultImportSource],
		['builtin', builtinImportSource],
	] as const) {
		const result = compileSource(input, { emit: false, platform: 'node', jsInteropProvider: provider(format) });
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		assert.ok(result.semantic);
		assert.deepEqual(externalExecutionReadiness(result.semantic), { status: 'ready', blockers: [] });
	}
});

test('execution readiness blocks pending and unresolved runtime resolution without changing checker acceptance', () => {
	for (const [format, reason] of [
		['bundler', 'runtime-resolution-pending'],
		['unknown', 'runtime-resolution-unresolved'],
	] as const) {
		const result = compileSource(source, { emit: false, jsInteropProvider: provider(format) });
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		assert.ok(result.semantic);
		assert.deepEqual(externalExecutionReadiness(result.semantic), {
			status: 'blocked',
			blockers: [{ reason, moduleSpecifier: './library.js' }],
		});
	}
});

test('execution readiness fails closed when operation evidence is unregistered, invalid, or suppressed by checked errors', () => {
	const unregistered = compileSourceBase(source, { emit: false, jsInteropProvider: provider('esm') });
	assert.deepEqual(unregistered.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(unregistered.semantic);
	assert.deepEqual(externalExecutionReadiness(unregistered.semantic), {
		status: 'blocked',
		blockers: [{ reason: 'operation-evidence-unavailable' }],
	});

	const invalid = compileSource(source, { emit: false, jsInteropProvider: provider('esm', true) });
	assert.deepEqual(invalid.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(invalid.semantic);
	assert.deepEqual(externalExecutionReadiness(invalid.semantic), {
		status: 'blocked',
		blockers: [{ reason: 'operation-evidence-unavailable' }],
	});

	const checkedError = compileSource(checkedErrorSource, { emit: false, jsInteropProvider: provider('esm') });
	assert.ok(checkedError.diagnostics.some(item => item.severity === 'error'));
	assert.ok(checkedError.semantic);
	assert.deepEqual(externalExecutionReadiness(checkedError.semantic), {
		status: 'blocked',
		blockers: [{ reason: 'operation-evidence-unavailable' }],
	});
});

test('execution readiness is deterministic for equivalent registered evidence', () => {
	const first = compileSource(source, { emit: false, jsInteropProvider: provider('bundler') });
	const second = compileSource({ ...source, id: 2 }, { emit: false, jsInteropProvider: provider('bundler') });
	assert.ok(first.semantic);
	assert.ok(second.semantic);
	assert.deepEqual(externalExecutionReadiness(first.semantic), externalExecutionReadiness(second.semantic));
});

test('project runtime module closure remains exact across cache reuse and excludes type-only dependencies', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-execution-closure-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'src'), { recursive: true });
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
	await writeFile(join(root, 'src/helper.virune'), 'pub fn value() -> Int {\n\treturn 1\n}\n');
	await writeFile(join(root, 'src/types.virune'), 'pub record Box {\n\tvalue: Int\n}\n');
	await writeFile(join(root, 'src/main.virune'), [
		'import { value } from "./helper.virune"',
		'import type { Box } from "./types.virune"',
		'',
		'pub fn main() -> Int {',
		'\treturn value()',
		'}',
		'',
	].join('\n'));

	const cache = new ProjectBuildCache();
	const first = await buildProject(root, { write: false, incrementalCache: cache });
	const second = await buildProject(root, { write: false, incrementalCache: cache });
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);
	assert.equal(second.stats.reusedCheckedModules, 3);
	const mainPath = join(root, 'src/main.virune');
	const relativePaths = (result: typeof first) => projectRuntimeModuleClosure(result, [mainPath])
		.map(module => module.source.path.slice(root.length + 1).replaceAll('\\', '/'));
	assert.deepEqual(relativePaths(first), ['src/helper.virune', 'src/main.virune']);
	assert.deepEqual(relativePaths(second), ['src/helper.virune', 'src/main.virune']);

	const fabricated = { ...second, modules: second.modules.map(module => ({ ...module })) };
	assert.throws(() => projectRuntimeModuleClosure(fabricated, [mainPath]), /runtime dependency evidence is unavailable/u);
});
