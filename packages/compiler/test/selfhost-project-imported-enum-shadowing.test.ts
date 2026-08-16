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
import { validateKernelInput, type KernelInputV1 } from '../src/selfhost/contract.js';
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
	seedSha256: '6'.repeat(64),
};

type GeneratedCompiler = Awaited<ReturnType<typeof loadBootstrapCompilerCandidate>>;

async function withGeneratedCompiler<T>(run: (module: GeneratedCompiler) => T | Promise<T>): Promise<T> {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		return await run(await loadBootstrapCompilerCandidate(root, 'dist/main.js'));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function projectInput(main: string): KernelInputV1 {
	return validateKernelInput({
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: 'src/main.virune',
		sources: [
			{ path: 'src/domain.virune', text: 'pub enum Status {\n\tPending\n}\n' },
			{ path: 'src/main.virune', text: main },
		],
		interopManifest: { version: '1', modules: [] },
		emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
	});
}

const visibleAliasCases = [
	{
		name: 'let initializer resolves the imported alias before the local binding begins',
		input: projectInput(
			'import { Status as state } from "./domain.virune"\n\n'
				+ 'pub fn main() -> state {\n\tlet state = state.Pending\n\treturn state\n}\n',
		),
	},
	{
		name: 'for binder shadowing ends when the loop body ends',
		input: projectInput(
			'import { Status as state } from "./domain.virune"\n\n'
				+ 'pub fn main() -> state {\n\tfor state in [1] {\n\t\tdiscard state\n\t}\n\treturn state.Pending\n}\n',
		),
	},
	{
		name: 'match pattern binding shadowing ends when the arm body ends',
		input: projectInput(
			'import { Status as state } from "./domain.virune"\n\n'
				+ 'pub fn main() -> state {\n\tlet matched = match 1 {\n\t\tstate => state\n\t}\n\tdiscard matched\n\treturn state.Pending\n}\n',
		),
	},
] as const;

const shadowCases = [
	{
		name: 'function parameter shadows the imported enum alias',
		input: projectInput(
			'import { Status as state } from "./domain.virune"\n\n'
				+ 'fn bad(state: Int) -> state {\n\treturn state.Pending\n}\n\n'
				+ 'pub fn main() -> Int {\n\treturn 1\n}\n',
		),
	},
	{
		name: 'local let binding shadows the imported enum alias after its initializer',
		input: projectInput(
			'import { Status as state } from "./domain.virune"\n\n'
				+ 'fn bad() -> state {\n\tlet state = 1\n\treturn state.Pending\n}\n\n'
				+ 'pub fn main() -> Int {\n\treturn 1\n}\n',
		),
	},
	{
		name: 'for binder shadows the imported enum alias only inside the loop body',
		input: projectInput(
			'import { Status as state } from "./domain.virune"\n\n'
				+ 'fn bad() -> Int {\n\tfor state in [1] {\n\t\tdiscard state.Pending\n\t}\n\treturn 1\n}\n\n'
				+ 'pub fn main() -> Int {\n\treturn bad()\n}\n',
		),
	},
	{
		name: 'match pattern binding shadows the imported enum alias only inside its arm body',
		input: projectInput(
			'import { Status as state } from "./domain.virune"\n\n'
				+ 'fn bad(value: Int) -> state {\n\treturn match value {\n\t\tstate => state.Pending\n\t}\n}\n\n'
				+ 'pub fn main() -> Int {\n\treturn 1\n}\n',
		),
	},
] as const;

test('imported enum constructor lowering preserves lexical shadowing', async () => {
	for (const visibleCase of visibleAliasCases) {
		const legacy = await compileWithLegacyKernel(visibleCase.input);
		assert.equal(legacy.accepted, true, `${visibleCase.name}: ${JSON.stringify(legacy.diagnostics, null, 2)}`);
		assert.deepEqual(legacy.diagnostics, [], `${visibleCase.name}: Legacy diagnostics`);
		const execution = await executeKernelOutputWithNode(visibleCase.input, legacy);
		assert.equal(execution.exitCode, 0, `${visibleCase.name}: Legacy runtime exit code`);
		assert.equal(execution.signal, null, `${visibleCase.name}: Legacy runtime signal`);
		assert.equal(execution.panic, null, `${visibleCase.name}: Legacy runtime panic`);
		assert.deepEqual(execution.returnValue, { $tag: 'Pending', $values: [] }, `${visibleCase.name}: Legacy runtime value`);
	}

	for (const shadowCase of shadowCases) {
		const legacy = await compileWithLegacyKernel(shadowCase.input);
		assert.equal(legacy.accepted, false, `${shadowCase.name}: Legacy unexpectedly accepted the shadowed enum access`);
		assert.deepEqual(legacy.emittedModules, [], `${shadowCase.name}: Legacy emitted code for a rejected project`);
		assert.ok(
			legacy.diagnostics.some(item =>
				item.sourcePath === 'src/main.virune'
				&& item.code === 'L2014'
				&& item.message === 'Type Int has no field Pending'
			),
			`${shadowCase.name}: Legacy rejection must be caused by lexical shadowing`,
		);
	}

	await withGeneratedCompiler(async module => {
		const kernel = createSelfhostProjectKernel(module);
		for (const visibleCase of visibleAliasCases) {
			const output = await kernel.compile(visibleCase.input);
			assert.equal(output.accepted, true, `${visibleCase.name}: ${JSON.stringify(output.diagnostics, null, 2)}`);
			assert.deepEqual(output.diagnostics, [], `${visibleCase.name}: Self-host diagnostics`);
			const execution = await executeKernelOutputWithNode(visibleCase.input, output);
			assert.equal(execution.exitCode, 0, `${visibleCase.name}: Self-host runtime exit code`);
			assert.equal(execution.signal, null, `${visibleCase.name}: Self-host runtime signal`);
			assert.equal(execution.panic, null, `${visibleCase.name}: Self-host runtime panic`);
			assert.deepEqual(execution.returnValue, { $tag: 'Pending', $values: [] }, `${visibleCase.name}: Self-host runtime value`);
		}

		for (const shadowCase of shadowCases) {
			const output = await kernel.compile(shadowCase.input);
			assert.equal(output.accepted, false, `${shadowCase.name}: Self-host unexpectedly accepted the shadowed enum access`);
			assert.deepEqual(output.emittedModules, [], `${shadowCase.name}: Self-host emitted code for a rejected project`);
			assert.ok(
				output.diagnostics.some(item =>
					item.sourcePath === 'src/main.virune'
					&& item.code === 'L1010'
					&& item.message === 'Unknown name state.Pending'
				),
				`${shadowCase.name}: Self-host must not rewrite the shadowed name into imported enum metadata`,
			);
		}
	});
});
