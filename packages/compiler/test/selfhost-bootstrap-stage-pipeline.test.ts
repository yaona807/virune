import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	normalizeBootstrapArtifact,
	type NormalizedBootstrapArtifactResult,
} from '../src/selfhost/bootstrap-artifact-normalizer.js';
import {
	KERNEL_CONTRACT_VERSION,
	KERNEL_LANGUAGE_VERSION,
	type KernelInputV1,
} from '../src/selfhost/contract.js';
import {
	executeReadyBootstrapStages,
} from '../src/selfhost/bootstrap-stage-pipeline.js';
import type { BootstrapStageReadinessResult } from '../src/selfhost/bootstrap-stage-runner.js';
import type {
	ProjectCompilerCapabilityV1,
	ProjectCompilerResultV1,
} from '../src/selfhost/project-compiler-adapter.js';
import { createKernelSourceManifest } from '../src/selfhost/source-manifest.js';

const input: KernelInputV1 = {
	contractVersion: KERNEL_CONTRACT_VERSION,
	languageVersion: KERNEL_LANGUAGE_VERSION,
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
	};
}

function compilerModuleSource(output: ProjectCompilerResultV1): string {
	const capability: ProjectCompilerCapabilityV1 = {
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

function stage0Artifact(output: ProjectCompilerResultV1): NormalizedBootstrapArtifactResult {
	return normalizeBootstrapArtifact({
		policyVersion: 1,
		root: '/virtual/project',
		modules: [{
			path: '/virtual/project/dist/main.js',
			code: compilerModuleSource(output),
			sourceMap: null,
			exports: ['compileMvp', 'compileProjectMvp', 'projectCompilerCapability'],
		}],
		diagnosticsSchema: null,
		metadata: { compiler: 'synthetic-stage0' },
		checksumManifest: [],
	});
}

function readiness(output: ProjectCompilerResultV1): BootstrapStageReadinessResult {
	const stage0Compiler = stage0Artifact(output);
	const sourceManifest = createKernelSourceManifest(input);
	const capability: ProjectCompilerCapabilityV1 = {
		contractVersion: '1',
		ready: true,
		requestSchema: 'virune.selfhost.project-compiler.request.v1',
		resultSchema: 'virune.selfhost.project-compiler.result.v2',
		blockers: [],
	};
	const capabilitySerialized = JSON.stringify(capability);
	const evidence = {
		policyVersion: 3 as const,
		claim: 'stage1-stage2-bootstrap-readiness' as const,
		productionEligible: false as const,
		ready: true,
		compilerArtifactSha256: stage0Compiler.sha256,
		sourceManifestSha256: sourceManifest.sha256,
		sourceCount: input.sources.length,
		entryPath: input.entryPath,
		requiredExports: ['projectCompilerCapability', 'compileProjectMvp'] as const,
		capability,
		capabilitySha256: sha256(capabilitySerialized),
		capabilityReady: true,
		capabilityBlockers: [],
		blockers: [],
	};
	const serialized = JSON.stringify(evidence);
	return {
		stage0Compiler,
		sourceManifest,
		evidence,
		serialized,
		sha256: sha256(serialized),
	};
}

test('executes Stage 1 and Stage 2 from validated readiness evidence', async () => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'virune-stage-pipeline-test-'));
	const stage2Result = result('export const stage = 2;\n');
	const stage1Result = result(compilerModuleSource(stage2Result));
	const execution = await executeReadyBootstrapStages(
		readiness(stage1Result),
		input,
		{ temporaryRoot },
	);
	assert.equal(execution.stage1.modules[0]?.code, compilerModuleSource(stage2Result));
	assert.equal(execution.stage2.modules[0]?.code, 'export const stage = 2;\n');
	assert.equal(execution.equivalent, false);
	assert.deepEqual(await readdir(temporaryRoot), []);
	await rm(temporaryRoot, { recursive: true, force: true });
});

test('rejects non-ready evidence before materializing Stage 0', async () => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'virune-stage-pipeline-not-ready-'));
	const prepared = readiness(result('export const stage = 1;\n'));
	const blocked: BootstrapStageReadinessResult = {
		...prepared,
		evidence: {
			...prepared.evidence,
			ready: false,
			capabilityReady: false,
			capabilityBlockers: ['full-language-inventory-incomplete'],
			blockers: ['project-compiler-not-ready'],
		},
	};
	await assert.rejects(
		executeReadyBootstrapStages(blocked, input, { temporaryRoot }),
		/full-language-inventory-incomplete.*project-compiler-not-ready|project-compiler-not-ready.*full-language-inventory-incomplete/u,
	);
	assert.deepEqual(await readdir(temporaryRoot), []);
	await rm(temporaryRoot, { recursive: true, force: true });
});

test('rejects source-manifest and Stage 0 witness drift', async () => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'virune-stage-pipeline-witness-'));
	const prepared = readiness(result('export const stage = 1;\n'));
	await assert.rejects(
		executeReadyBootstrapStages({
			...prepared,
			evidence: { ...prepared.evidence, compilerArtifactSha256: '0'.repeat(64) },
		}, input, { temporaryRoot }),
		/compiler artifact witness/u,
	);
	await assert.rejects(
		executeReadyBootstrapStages(prepared, {
			...input,
			sources: [{ ...input.sources[0]!, text: 'pub fn main() -> Int {\n\treturn 1\n}\n' }],
		}, { temporaryRoot }),
		/source manifest does not match/u,
	);
	assert.deepEqual(await readdir(temporaryRoot), []);
	await rm(temporaryRoot, { recursive: true, force: true });
});

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
