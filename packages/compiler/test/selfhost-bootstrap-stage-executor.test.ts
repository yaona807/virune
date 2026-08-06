import assert from 'node:assert/strict';
import test from 'node:test';
import {
	BOOTSTRAP_STAGE_DIAGNOSTIC_SCHEMA,
	BOOTSTRAP_STAGE_EXECUTOR_VERSION,
	compareStageArtifacts,
	compareStageModules,
	executeBootstrapStages,
	stageArtifact,
	type BootstrapStageCompiler,
	type BootstrapStageArtifact,
} from '../src/selfhost/bootstrap-stage-executor.js';
import type { KernelInputV1 } from '../src/selfhost/contract.js';
import {
	PROJECT_COMPILER_RESULT_SCHEMA,
	type ProjectCompilerResultV1,
} from '../src/selfhost/project-compiler-adapter.js';

const input: KernelInputV1 = {
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: 'pub fn main() -> Int {\n\treturn 0\n}\n' }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
};

function result(
	code: string,
	overrides: Partial<ProjectCompilerResultV1> = {},
): ProjectCompilerResultV1 {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: input.entryPath,
		accepted: true,
		diagnostics: [],
		emittedModules: [{
			sourcePath: input.entryPath,
			outputPath: 'dist/main.js',
			code,
			sourceMap: '',
		}],
		dependencies: [],
		exportedSymbols: [{
			modulePath: input.entryPath,
			name: 'main',
			declarationKind: 'FunctionDeclaration',
		}],
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 1,
			reusedCheckedModules: 0,
			emittedModules: 1,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
		...overrides,
	};
}

function compiler(value: ProjectCompilerResultV1): BootstrapStageCompiler {
	return { compile: () => value };
}

test('stage executor proves normalized Stage 1 and Stage 2 equality', async () => {
	const loaded: string[] = [];
	const execution = await executeBootstrapStages(
		compiler(result('export const value = 1;\r\n')),
		input,
		async artifact => {
			loaded.push(artifact.sha256);
			return compiler(result('export const value = 1;\n'));
		},
	);
	assert.equal(execution.equivalent, true);
	assert.deepEqual(execution.differences, []);
	assert.equal(execution.stage1.sha256, execution.stage2.sha256);
	assert.deepEqual(loaded, [execution.stage1.sha256]);
	assert.equal(execution.stage1.executorVersion, BOOTSTRAP_STAGE_EXECUTOR_VERSION);
	assert.deepEqual(execution.stage1.metadata, {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		accepted: true,
		resultSchema: PROJECT_COMPILER_RESULT_SCHEMA,
		diagnosticSchema: BOOTSTRAP_STAGE_DIAGNOSTIC_SCHEMA,
	});
});

test('stage artifact serializes compiler and diagnostic schema metadata', () => {
	const artifact = stageArtifact('stage1', result('export const value = 1;\n'));
	const payload = JSON.parse(artifact.serializedPayload) as { readonly metadata: unknown };
	assert.deepEqual(payload.metadata, artifact.metadata);
	assert.equal(artifact.metadata.resultSchema, 'virune.selfhost.project-compiler.result.v2');
	assert.equal(
		artifact.metadata.diagnosticSchema,
		'virune.selfhost.project-compiler.result.v2#diagnostics',
	);

	const drifted: BootstrapStageArtifact = {
		...stageArtifact('stage2', result('export const value = 1;\n')),
		metadata: {
			...artifact.metadata,
			diagnosticSchema: 'virune.selfhost.project-compiler.result.v3#diagnostics' as unknown as typeof BOOTSTRAP_STAGE_DIAGNOSTIC_SCHEMA,
		},
	};
	assert.deepEqual(
		compareStageArtifacts(artifact, drifted).map(item => `${item.section}:${item.path}`),
		['metadata:diagnosticSchema'],
	);
});

test('stage comparison rejects executor version drift', () => {
	const stage1 = stageArtifact('stage1', result('export const value = 1;\n'));
	const stage2: BootstrapStageArtifact = {
		...stageArtifact('stage2', result('export const value = 1;\n')),
		executorVersion: (BOOTSTRAP_STAGE_EXECUTOR_VERSION + 1) as unknown as typeof BOOTSTRAP_STAGE_EXECUTOR_VERSION,
	};
	assert.deepEqual(
		compareStageArtifacts(stage1, stage2).map(item => `${item.section}:${item.path}`),
		['metadata:executorVersion'],
	);
});

test('stage artifacts canonicalize module, dependency, and export order', () => {
	const unordered = result('a', {
		emittedModules: [
			{ sourcePath: 'src/z.virune', outputPath: 'dist/z.js', code: 'z', sourceMap: '' },
			{ sourcePath: 'src/a.virune', outputPath: 'dist/a.js', code: 'a', sourceMap: '' },
		],
		dependencies: [
			{
				modulePath: 'src/z.virune',
				sourceKind: 'virune',
				specifier: './a.virune',
				resolvedPath: 'src/a.virune',
				typeOnly: false,
				public: false,
			},
			{
				modulePath: 'src/a.virune',
				sourceKind: 'javascript',
				specifier: 'node:path',
				resolvedPath: null,
				typeOnly: false,
				public: false,
			},
		],
		exportedSymbols: [
			{ modulePath: 'src/z.virune', name: 'z', declarationKind: 'FunctionDeclaration' },
			{ modulePath: 'src/a.virune', name: 'a', declarationKind: 'FunctionDeclaration' },
		],
		stats: {
			parsedModules: 2,
			reusedParsedModules: 0,
			checkedModules: 2,
			reusedCheckedModules: 0,
			emittedModules: 2,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	});
	const ordered = result('a', {
		...unordered,
		emittedModules: [...unordered.emittedModules].reverse(),
		dependencies: [...unordered.dependencies].reverse(),
		exportedSymbols: [...unordered.exportedSymbols].reverse(),
	});
	const left = stageArtifact('stage1', unordered);
	const right = stageArtifact('stage2', ordered);
	assert.equal(left.sha256, right.sha256);
	assert.deepEqual(left.modules.map(item => item.outputPath), ['dist/a.js', 'dist/z.js']);
	assert.deepEqual(left.exportedSymbols.map(item => item.name), ['a', 'z']);
	assert.deepEqual(compareStageArtifacts(left, right), []);
});

test('stage executor reports deterministic code and metadata differences', async () => {
	const execution = await executeBootstrapStages(
		compiler(result('export const value = 1;\n')),
		input,
		async () => compiler(result('export const value = 2;\n', {
			exportedSymbols: [{
				modulePath: input.entryPath,
				name: 'renamed',
				declarationKind: 'FunctionDeclaration',
			}],
		})),
	);
	assert.equal(execution.equivalent, false);
	assert.deepEqual(
		execution.differences.map(item => `${item.section}:${item.path}`),
		['exported-symbol:src/main.virune\0main\0FunctionDeclaration',
			'exported-symbol:src/main.virune\0renamed\0FunctionDeclaration',
			'module:dist/main.js'],
	);
});

test('stage artifact rejects failed, empty, or duplicate-output compilation', () => {
	assert.throws(
		() => stageArtifact('stage1', {
			...result(''),
			accepted: false,
			diagnostics: [{
				code: 'SHP2001',
				severity: 'error',
				message: 'not ready',
				sourcePath: null,
				span: {
					start: { offset: 0, line: 1, column: 1 },
					end: { offset: 0, line: 1, column: 1 },
				},
				notes: [],
			}],
			emittedModules: [],
			stats: { ...result('').stats, emittedModules: 0 },
		}),
		/Stage 1 project compilation was rejected \(SHP2001\)/u,
	);
	assert.throws(
		() => stageArtifact('stage2', {
			...result(''),
			emittedModules: [],
			stats: { ...result('').stats, emittedModules: 0 },
		}),
		/Stage 2 project compilation emitted no modules/u,
	);
	assert.throws(
		() => stageArtifact('stage1', {
			...result(''),
			emittedModules: [
				{ sourcePath: 'a.virune', outputPath: 'dist/main.js', code: 'a', sourceMap: '' },
				{ sourcePath: 'b.virune', outputPath: 'dist/main.js', code: 'b', sourceMap: '' },
			],
			stats: { ...result('').stats, emittedModules: 2 },
		}),
		/outputPath values must be unique/u,
	);
});

test('module comparison includes added and removed outputs in path order', () => {
	assert.deepEqual(compareStageModules(
		[{ sourcePath: 'a.virune', outputPath: 'z.js', code: 'z', sourceMap: '' }],
		[{ sourcePath: 'b.virune', outputPath: 'a.js', code: 'a', sourceMap: '' }],
	).map(item => `${item.section}:${item.path}`), ['module:a.js', 'module:z.js']);
});
