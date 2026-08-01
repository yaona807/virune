import assert from 'node:assert/strict';
import test from 'node:test';
import {
	compareStageModules,
	executeBootstrapStages,
	stageArtifact,
	type BootstrapStageCompiler,
} from '../src/selfhost/bootstrap-stage-executor.js';
import type { KernelInputV1 } from '../src/selfhost/contract.js';
import type { ProjectCompilerResultV1 } from '../src/selfhost/project-compiler-adapter.js';

const input: KernelInputV1 = {
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: 'pub fn main() -> Int {\n\treturn 0\n}\n' }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
};

function result(code: string): ProjectCompilerResultV1 {
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
		exportedSymbols: [{ modulePath: input.entryPath, name: 'main', declarationKind: 'FunctionDeclaration' }],
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 1,
			reusedCheckedModules: 0,
			emittedModules: 1,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
}

function compiler(code: string): BootstrapStageCompiler {
	return { compile: () => result(code) };
}

test('stage executor proves normalized Stage 1 and Stage 2 equality', async () => {
	const loaded: string[] = [];
	const execution = await executeBootstrapStages(
		compiler('export const value = 1;\r\n'),
		input,
		async artifact => {
			loaded.push(artifact.sha256);
			return compiler('export const value = 1;\n');
		},
	);
	assert.equal(execution.equivalent, true);
	assert.deepEqual(execution.differences, []);
	assert.equal(execution.stage1.sha256, execution.stage2.sha256);
	assert.deepEqual(loaded, [execution.stage1.sha256]);
});

test('stage executor reports deterministic per-module differences', async () => {
	const execution = await executeBootstrapStages(
		compiler('export const value = 1;\n'),
		input,
		async () => compiler('export const value = 2;\n'),
	);
	assert.equal(execution.equivalent, false);
	assert.deepEqual(execution.differences.map(item => item.outputPath), ['dist/main.js']);
	assert.notEqual(execution.differences[0]?.stage1Sha256, execution.differences[0]?.stage2Sha256);
});

test('stage artifact rejects failed or empty project compilation', () => {
	assert.throws(
		() => stageArtifact('stage1', { ...result(''), accepted: false, diagnostics: [{
			code: 'SHP2001',
			severity: 'error',
			message: 'not ready',
			sourcePath: null,
			span: {
				start: { offset: 0, line: 1, column: 1 },
				end: { offset: 0, line: 1, column: 1 },
			},
			notes: [],
		}], emittedModules: [], stats: { ...result('').stats, emittedModules: 0 } }),
		/Stage 1 project compilation was rejected \(SHP2001\)/u,
	);
	assert.throws(
		() => stageArtifact('stage2', { ...result(''), emittedModules: [], stats: { ...result('').stats, emittedModules: 0 } }),
		/Stage 2 project compilation emitted no modules/u,
	);
});

test('module comparison includes added and removed outputs in path order', () => {
	assert.deepEqual(compareStageModules(
		[{ sourcePath: 'a.virune', outputPath: 'z.js', code: 'z', sourceMap: '' }],
		[{ sourcePath: 'b.virune', outputPath: 'a.js', code: 'a', sourceMap: '' }],
	).map(item => item.outputPath), ['a.js', 'z.js']);
});
