import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { snapshotProjectBuild } from '../src/selfhost/bootstrap-artifact-snapshot.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from '../src/selfhost/bootstrap-execution-probe.js';
import { validateKernelInput } from '../src/selfhost/contract.js';
import { compileWithLegacyKernel } from '../src/selfhost/legacy-adapter.js';
import { executeKernelOutputWithNode } from '../src/selfhost/node-executor.js';
import { createSelfhostProjectKernel } from '../src/selfhost/project-differential-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: '5'.repeat(64),
};

const input = validateKernelInput({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [
		{
			path: 'src/domain.virune',
			text: 'pub enum Reason {\n\tBad\n}\n\npub enum Status {\n\tFailed(Reason)\n}\n',
		},
		{
			path: 'src/main.virune',
			text: 'import { Reason as Why, Status } from "./domain.virune"\n\n'
				+ 'pub fn main() -> Status {\n\treturn Status.Failed(Why.Bad)\n}\n',
		},
	],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

test('imported enum payload identity follows an explicit same-target type alias', async () => {
	const legacy = await compileWithLegacyKernel(input);
	assert.equal(legacy.accepted, true, JSON.stringify(legacy.diagnostics, null, 2));
	assert.deepEqual(legacy.diagnostics, []);
	const legacyExecution = await executeKernelOutputWithNode(input, legacy);
	assert.equal(legacyExecution.exitCode, 0);
	assert.equal(legacyExecution.signal, null);
	assert.equal(legacyExecution.panic, null);
	assert.deepEqual(legacyExecution.returnValue, {
		$tag: 'Failed',
		$values: [{ $tag: 'Bad', $values: [] }],
	});

	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		const output = await createSelfhostProjectKernel(module).compile(input);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const execution = await executeKernelOutputWithNode(input, output);
		assert.equal(execution.exitCode, 0);
		assert.equal(execution.signal, null);
		assert.equal(execution.panic, null);
		assert.deepEqual(execution.returnValue, legacyExecution.returnValue);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
