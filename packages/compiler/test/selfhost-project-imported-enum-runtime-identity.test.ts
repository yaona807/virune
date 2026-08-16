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
	seedSha256: 'f'.repeat(64),
};

const input = validateKernelInput({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [
		{
			path: 'src/domain.virune',
			text: `pub enum Status {
	Pending
	Failed(String)
}
`,
		},
		{
			path: 'src/main.virune',
			text: `import { Status as State } from "./domain.virune"

pub fn main() -> State {
	return State.Failed("boom")
}
`,
		},
	],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const functionOnlyInput = validateKernelInput({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [
		{
			path: 'src/domain.virune',
			text: `pub enum Status {
	Pending
}

pub fn answer() -> Int {
	return 42
}
`,
		},
		{
			path: 'src/main.virune',
			text: `import { answer } from "./domain.virune"

pub fn main() -> Int {
	return answer()
}
`,
		},
	],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

test('imported payload enum constructors preserve module runtime identity', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		const kernel = createSelfhostProjectKernel(module);
		const output = await kernel.compile(input);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);

		const domain = output.emittedModules.find(item => item.sourcePath === 'src/domain.virune');
		const main = output.emittedModules.find(item => item.sourcePath === 'src/main.virune');
		assert.ok(domain, 'expected emitted enum dependency module');
		assert.ok(main, 'expected emitted entry module');
		assert.ok(
			domain.code.includes('export function Failed($value0) { return makeVariant("Failed", [$value0], "project:src/domain.virune#Status"); }'),
			'payload constructor must preserve the canonical enum type id',
		);
		assert.ok(
			main.code.includes('import { Status as State } from "./domain.js";'),
			'import alias must remain a runtime enum namespace binding',
		);
		assert.ok(
			main.code.includes('return State.Failed("boom");'),
			'imported payload construction must call the dependency constructor without a task context argument',
		);
		assert.equal(
			main.code.includes('{$tag: "Failed"'),
			false,
			'imported payload construction must not erase nominal enum identity into an inline structural value',
		);

		const execution = await executeKernelOutputWithNode(input, output);
		assert.equal(execution.exitCode, 0);
		assert.equal(execution.signal, null);
		assert.equal(execution.panic, null);
		assert.deepEqual(execution.returnValue, { $tag: 'Failed', $values: ['boom'] });

		const functionOnlyOutput = await kernel.compile(functionOnlyInput);
		assert.equal(functionOnlyOutput.accepted, true, JSON.stringify(functionOnlyOutput.diagnostics, null, 2));
		assert.deepEqual(functionOnlyOutput.diagnostics, []);
		const functionOnlyDomain = functionOnlyOutput.emittedModules.find(item => item.sourcePath === 'src/domain.virune');
		assert.ok(functionOnlyDomain, 'expected emitted function dependency module');
		assert.match(functionOnlyDomain.code, /export function answer/u);
		assert.doesNotMatch(
			functionOnlyDomain.code,
			/\/\/ enum Status|export const Pending|export const Status/u,
			'function-only imports must not promote unrelated public enums into runtime output',
		);
		const functionOnlyExecution = await executeKernelOutputWithNode(functionOnlyInput, functionOnlyOutput);
		assert.equal(functionOnlyExecution.exitCode, 0);
		assert.equal(functionOnlyExecution.signal, null);
		assert.equal(functionOnlyExecution.panic, null);
		assert.equal(functionOnlyExecution.returnValue, 42);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
