import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	executeBootstrapCompilerSelection,
	type BootstrapCompilerSelectionRequest,
} from '../src/selfhost/bootstrap-compiler-selection.js';
import { stageArtifact } from '../src/selfhost/bootstrap-stage-executor.js';
import {
	REQUIRED_ROLLBACK_GATES,
	type BootstrapRollbackDecisionInput,
	type RollbackGateName,
} from '../src/selfhost/bootstrap-rollback-decision.js';
import type { KernelInputV1, KernelOutputV1 } from '../src/selfhost/contract.js';
import type { ProjectCompilerResultV1 } from '../src/selfhost/project-compiler-adapter.js';

const candidateSha256 = 'a'.repeat(64);
const input: KernelInputV1 = {
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: 'pub fn main() -> Int {\n\treturn 0\n}\n' }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
};

function rollbackDecision(failedGate?: RollbackGateName): BootstrapRollbackDecisionInput {
	return {
		version: 1,
		candidateVersion: '1.0.0-stage2',
		candidateSha256,
		releaseVersion: '1.0.0',
		evaluatedAt: '2026-08-01T01:00:00.000Z',
		maximumEvidenceAgeSeconds: 7_200,
		gates: REQUIRED_ROLLBACK_GATES.map((name, index) => ({
			name,
			candidateSha256,
			checkedAt: '2026-08-01T00:00:00.000Z',
			status: name === failedGate ? 'fail' : 'pass',
			evidenceSha256: (index + 1).toString(16).repeat(64),
		})),
	};
}

function kernelOutput(marker: string): KernelOutputV1 {
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
			code: `export const compiler = ${JSON.stringify(marker)};\n`,
			sourceMap: '',
		}],
		dependencies: [],
		exportedSymbols: [],
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

function projectResult(code: string): ProjectCompilerResultV1 {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: input.entryPath,
		accepted: true,
		diagnostics: [],
		emittedModules: [{ sourcePath: input.entryPath, outputPath: 'dist/main.js', code, sourceMap: '' }],
		dependencies: [],
		exportedSymbols: [],
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
		exports: [],
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

test('Legacy rollback succeeds without reading or materializing a Self-host candidate', async () => {
	let legacyCalls = 0;
	const request = {
		rollbackDecision: rollbackDecision('performance'),
		input,
		get selfHostCandidate(): never {
			throw new Error('Self-host candidate must not be read during Legacy rollback');
		},
	} satisfies BootstrapCompilerSelectionRequest;
	const result = await executeBootstrapCompilerSelection(request, {
		legacyCompiler: () => {
			legacyCalls += 1;
			return kernelOutput('legacy');
		},
	});

	assert.equal(result.selection, 'legacy');
	assert.equal(result.rollback.decision.rollbackRequired, true);
	assert.deepEqual(result.rollback.decision.reasons, [{ gate: 'performance', code: 'FAILED' }]);
	assert.equal(result.materializedStageArtifactSha256, null);
	assert.equal(result.output.emittedModules[0]?.code, 'export const compiler = "legacy";\n');
	assert.equal(legacyCalls, 1);
});

test('Self-host selection fails closed when no Stage candidate is supplied', async () => {
	let legacyCalls = 0;
	await assert.rejects(
		executeBootstrapCompilerSelection({ rollbackDecision: rollbackDecision(), input }, {
			legacyCompiler: () => {
				legacyCalls += 1;
				return kernelOutput('legacy');
			},
		}),
		/request\.selfHostCandidate: Self-host selection requires a Stage compiler candidate/u,
	);
	assert.equal(legacyCalls, 0);
});

test('Self-host selection materializes the Stage candidate and disposes it after compilation', async () => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'virune-rollback-selection-test-'));
	const selfHostOutput = projectResult('export const compiler = "self-host";\n');
	const artifact = stageArtifact(
		'stage1',
		projectResult(compilerModuleSource(selfHostOutput)),
	);
	const result = await executeBootstrapCompilerSelection({
		rollbackDecision: rollbackDecision(),
		input,
		selfHostCandidate: { artifact, temporaryRoot },
	});

	assert.equal(result.selection, 'self-host');
	assert.equal(result.rollback.decision.rollbackRequired, false);
	assert.equal(result.materializedStageArtifactSha256, artifact.sha256);
	assert.equal(result.output.emittedModules[0]?.code, 'export const compiler = "self-host";\n');
	assert.deepEqual(await readdir(temporaryRoot), []);
	await rm(temporaryRoot, { recursive: true, force: true });
});

test('invalid rollback evidence fails before candidate lookup or compiler execution', async () => {
	let legacyCalls = 0;
	const request = {
		rollbackDecision: { ...rollbackDecision(), evaluatedAt: 'not-a-timestamp' },
		input,
		get selfHostCandidate(): never {
			throw new Error('candidate lookup must not occur');
		},
	} satisfies BootstrapCompilerSelectionRequest;
	await assert.rejects(
		executeBootstrapCompilerSelection(request, {
			legacyCompiler: () => {
				legacyCalls += 1;
				return kernelOutput('legacy');
			},
		}),
		/\$\.evaluatedAt must be a canonical UTC ISO timestamp/u,
	);
	assert.equal(legacyCalls, 0);
});
