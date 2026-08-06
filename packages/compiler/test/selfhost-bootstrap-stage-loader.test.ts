import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { KernelInputV1 } from '../src/selfhost/contract.js';
import {
	executeBootstrapStagesWithArtifactLoader,
	materializeBootstrapStageCompiler,
} from '../src/selfhost/bootstrap-stage-loader.js';
import {
	stageArtifact,
	type BootstrapStageArtifact,
	type BootstrapStageCompiler,
} from '../src/selfhost/bootstrap-stage-executor.js';
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
		emittedModules: [{ sourcePath: input.entryPath, outputPath: 'dist/main.js', code, sourceMap: '' }],
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

function compilerModuleSource(output: ProjectCompilerResultV1): string {
	const capability = {
		contractVersion: '1',
		ready: true,
		requestSchema: 'virune.selfhost.project-compiler.request.v1',
		resultSchema: 'virune.selfhost.project-compiler.result.v2',
		blockers: [],
	};
	const compilation = {
		accepted: true,
		diagnostics: [],
		codeBody: 'export const value = 1;',
		exports: [{ name: 'value', declarationKind: 'VariableDeclaration' }],
	};
	return [
		`const output = ${JSON.stringify(output)};`,
		`const capability = ${JSON.stringify(capability)};`,
		`const compilation = ${JSON.stringify(compilation)};`,
		"export const compileMvp = () => ({ $tag: 'Ok', $values: [JSON.stringify(compilation)] });",
		"export const projectCompilerCapability = () => ({ $tag: 'Ok', $values: [JSON.stringify(capability)] });",
		"export const compileProjectMvp = () => ({ $tag: 'Ok', $values: [JSON.stringify(output)] });",
		'',
	].join('\n');
}

function withArtifactIntegrity(value: BootstrapStageArtifact): BootstrapStageArtifact {
	const serializedPayload = JSON.stringify({
		metadata: value.metadata,
		entryPath: value.entryPath,
		modules: value.modules,
		dependencies: value.dependencies,
		exportedSymbols: value.exportedSymbols,
	});
	return {
		...value,
		serializedPayload,
		sha256: createHash('sha256').update(serializedPayload, 'utf8').digest('hex'),
	};
}

function artifact(code: string, overrides: Partial<BootstrapStageArtifact> = {}): BootstrapStageArtifact {
	return withArtifactIntegrity({ ...stageArtifact('stage1', result(code)), ...overrides });
}

test('materializes and imports a real Stage 1 project compiler candidate', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-stage-loader-test-'));
	const stage2Result = result('export const stage = 2;\n');
	const candidate = await materializeBootstrapStageCompiler(
		artifact(compilerModuleSource(stage2Result)),
		root,
	);
	try {
		assert.equal(candidate.entryModulePath, 'dist/main.js');
		assert.deepEqual(candidate.compiler.compile(input), stage2Result);
	} finally {
		await candidate.dispose();
		await candidate.dispose();
	}
	assert.deepEqual(await readdir(root), []);
	await rm(root, { recursive: true, force: true });
});

test('rejects artifacts whose payload or digest does not match their fields', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-stage-integrity-test-'));
	const valid = artifact(compilerModuleSource(result('export const stage = 2;\n')));
	await assert.rejects(
		materializeBootstrapStageCompiler({
			...valid,
			modules: valid.modules.map((module, index) => index === 0
				? { ...module, code: `${module.code}\n// tampered\n` }
				: module),
		}, root),
		/serialized payload does not match its fields/u,
	);
	await assert.rejects(
		materializeBootstrapStageCompiler({ ...valid, sha256: '0'.repeat(64) }, root),
		/SHA-256 does not match its serialized payload/u,
	);
	assert.deepEqual(await readdir(root), []);
	await rm(root, { recursive: true, force: true });
});

test('executes Stage 2 through the materialized compiler and removes the candidate root', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-stage-execution-test-'));
	const stage2Result = result('export const stage = 2;\n');
	const stage0: BootstrapStageCompiler = {
		compile: () => result(compilerModuleSource(stage2Result)),
	};
	const execution = await executeBootstrapStagesWithArtifactLoader(stage0, input, root);
	assert.equal(execution.stage2.modules[0]?.code, 'export const stage = 2;\n');
	assert.equal(execution.equivalent, false);
	assert.deepEqual(await readdir(root).catch(() => [] as string[]), []);
	await rm(root, { recursive: true, force: true });
});

test('fails closed when the entry source is absent or duplicated', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-stage-entry-test-'));
	const source = compilerModuleSource(result('export const stage = 2;\n'));
	const valid = artifact(source);
	await assert.rejects(
		materializeBootstrapStageCompiler(artifact(source, { entryPath: 'src/missing.virune' }), root),
		/must resolve to exactly one emitted module; found 0/u,
	);
	await assert.rejects(
		materializeBootstrapStageCompiler(artifact(source, {
			modules: [...valid.modules, { ...valid.modules[0]!, outputPath: 'dist/duplicate.js' }],
		}), root),
		/must resolve to exactly one emitted module; found 2/u,
	);
	await rm(root, { recursive: true, force: true });
});

test('rejects path traversal and non-JavaScript stage outputs', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-stage-path-test-'));
	const source = compilerModuleSource(result('export const stage = 2;\n'));
	const valid = artifact(source);
	await assert.rejects(
		materializeBootstrapStageCompiler(artifact(source, {
			modules: [{ ...valid.modules[0]!, outputPath: '../escape.js' }],
		}), root),
		/path must not escape the project root/u,
	);
	await assert.rejects(
		materializeBootstrapStageCompiler(artifact(source, {
			modules: [{ ...valid.modules[0]!, outputPath: 'dist/main.mjs' }],
		}), root),
		/must be JavaScript/u,
	);
	await rm(root, { recursive: true, force: true });
});

test('rejects candidates without the complete project compiler boundary', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-stage-exports-test-'));
	const incomplete = [
		"export const compileMvp = () => ({ $tag: 'Ok', $values: ['{}'] });",
		'',
	].join('\n');
	await assert.rejects(
		materializeBootstrapStageCompiler(artifact(incomplete), root),
		/must export compileMvp, projectCompilerCapability, and compileProjectMvp/u,
	);
	await rm(root, { recursive: true, force: true });
});
