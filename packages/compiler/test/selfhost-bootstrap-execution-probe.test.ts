import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	runBootstrapExecutionProbe,
	validateSelfhostMvpModule,
} from '../src/selfhost/bootstrap-execution-probe.js';
import type { KernelInputV1 } from '../src/selfhost/contract.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const seedSha256 = 'b'.repeat(64);

const input = (source: string): KernelInputV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: source }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const acceptedSource = 'pub fn main() -> Int {\n\treturn 42\n}\n';
const rejectedSource = 'pub fn main() -> Int {\n\treturn missing\n}\n';
const options = {
	temporaryRoot,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256,
};

test('Stage 0 compiler artifact executes deterministically as a non-promotable candidate', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	try {
		const first = await runBootstrapExecutionProbe(mvpRoot, input(acceptedSource), options);
		const second = await runBootstrapExecutionProbe(mvpRoot, input(acceptedSource), options);

		assert.equal(first.serialized, second.serialized);
		assert.equal(first.sha256, second.sha256);
		assert.equal(first.artifact.claim, 'stage0-compiler-execution-probe');
		assert.equal(first.artifact.productionEligible, false);
		assert.equal(first.artifact.compilerArtifactSha256, first.compilerArtifact.sha256);
		assert.equal(first.compilerArtifact.artifact.metadata.stage, 'stage0');
		assert.equal(first.output.accepted, true);
		assert.equal(first.artifact.accepted, true);
		assert.deepEqual(first.artifact.diagnosticCodes, []);
		assert.deepEqual(first.artifact.emittedModulePaths, ['.selfhost-output/src/main.js']);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('rejected candidate output remains deterministic evidence', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	try {
		const result = await runBootstrapExecutionProbe(mvpRoot, input(rejectedSource), options);
		assert.equal(result.output.accepted, false);
		assert.equal(result.artifact.accepted, false);
		assert.deepEqual(result.artifact.diagnosticCodes, ['L1010']);
		assert.deepEqual(result.artifact.emittedModulePaths, []);
		assert.match(result.artifact.inputSha256, /^[0-9a-f]{64}$/u);
		assert.match(result.artifact.outputSha256, /^[0-9a-f]{64}$/u);
		assert.match(result.sha256, /^[0-9a-f]{64}$/u);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('compiler candidate boundary rejects missing compileMvp export', () => {
	assert.throws(() => validateSelfhostMvpModule(null), /ES module object/u);
	assert.throws(() => validateSelfhostMvpModule({}), /export compileMvp/u);
	const module = { compileMvp: (_source: string) => ({ $tag: 'Ok', $values: ['{}'] }) };
	assert.equal(validateSelfhostMvpModule(module), module);
});
