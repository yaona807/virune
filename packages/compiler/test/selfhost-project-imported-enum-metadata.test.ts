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
import {
	runDifferentialCorpus,
	type DifferentialFixtureV1,
} from '../src/selfhost/differential-harness.js';
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
	seedSha256: 'f'.repeat(64),
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

function projectInput(domain: string, main: string): KernelInputV1 {
	return validateKernelInput({
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: 'src/main.virune',
		sources: [
			{ path: 'src/domain.virune', text: domain },
			{ path: 'src/main.virune', text: main },
		],
		interopManifest: { version: '1', modules: [] },
		emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
	});
}

const zeroPayloadInput = projectInput(
	`pub enum Status {
	Pending
	Failed(String)
}
`,
	`import { Status } from "./domain.virune"

pub fn main() -> Status {
	return Status.Pending
}
`,
);

const payloadAliasInput = projectInput(
	`pub enum Status {
	Pending
	Failed(String)
}
`,
	`import { Status as State } from "./domain.virune"

pub fn main() -> State {
	return State.Failed("boom")
}
`,
);

const positiveFixtures: readonly DifferentialFixtureV1[] = [
	{
		id: 'imported-enum-zero-payload',
		tags: ['project', 'multi-module', 'runtime', 'enum'],
		input: zeroPayloadInput,
		expectedDivergences: [],
	},
	{
		id: 'imported-enum-payload-alias',
		tags: ['project', 'multi-module', 'runtime', 'enum', 'alias'],
		input: payloadAliasInput,
		expectedDivergences: [],
	},
];

const legacyRuntimeCases = [
	{
		id: 'imported-enum-zero-payload',
		input: zeroPayloadInput,
		expectedReturnValue: { $tag: 'Pending', $values: [] },
	},
	{
		id: 'imported-enum-payload-alias',
		input: payloadAliasInput,
		expectedReturnValue: { $tag: 'Failed', $values: ['boom'] },
	},
] as const;

test('imported public enum constructors retain independently grounded Legacy runtime meaning and Self-host parity', async () => {
	for (const runtimeCase of legacyRuntimeCases) {
		const output = await compileWithLegacyKernel(runtimeCase.input);
		assert.equal(output.accepted, true, `${runtimeCase.id}: Legacy compiler rejected fixture`);
		assert.deepEqual(output.diagnostics, [], `${runtimeCase.id}: Legacy diagnostics`);
		const execution = await executeKernelOutputWithNode(runtimeCase.input, output);
		assert.equal(execution.exitCode, 0, `${runtimeCase.id}: Legacy runtime exit code`);
		assert.equal(execution.signal, null, `${runtimeCase.id}: Legacy runtime signal`);
		assert.equal(execution.panic, null, `${runtimeCase.id}: Legacy runtime panic`);
		assert.deepEqual(execution.returnValue, runtimeCase.expectedReturnValue, `${runtimeCase.id}: Legacy runtime value`);
	}

	await withGeneratedCompiler(async module => {
		const report = await runDifferentialCorpus({
			fixtures: positiveFixtures,
			left: {
				name: 'legacy-project',
				compile: compileWithLegacyKernel,
				execute: executeKernelOutputWithNode,
			},
			right: {
				...createSelfhostProjectKernel(module),
				execute: executeKernelOutputWithNode,
			},
		});
		for (const caseReport of report.cases) {
			assert.deepEqual(caseReport.unexplainedDifferences, [], `${caseReport.fixtureId}: unexplained differences`);
			assert.deepEqual(caseReport.staleExpectedDivergences, [], `${caseReport.fixtureId}: stale expected divergences`);
			assert.equal(caseReport.status, 'match', `${caseReport.fixtureId}: differential status`);
			assert.equal(caseReport.passed, true, `${caseReport.fixtureId}: differential pass`);
		}
		assert.deepEqual(report.totals, {
			fixtures: 2,
			matched: 2,
			expectedDivergence: 0,
			failed: 0,
		});
	});
});

test('imported enum metadata remains fail-closed outside the supported public value-import boundary', async t => {
	await withGeneratedCompiler(async module => {
		const kernel = createSelfhostProjectKernel(module);

		await t.test('unknown variant', async () => {
			const output = await kernel.compile(projectInput(
				'pub enum Status {\n\tPending\n}\n',
				'import { Status } from "./domain.virune"\n\npub fn main() -> Status {\n\treturn Status.Missing\n}\n',
			));
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
			assert.ok(output.diagnostics.some(item =>
				item.sourcePath === 'src/main.virune'
				&& item.code === 'L1010'
				&& item.message === 'Unknown name Status.Missing'
			));
		});

		await t.test('private enum import never creates runtime constructor metadata', async () => {
			const input = projectInput(
				'enum Status {\n\tPending\n}\n',
				'import { Status } from "./domain.virune"\n\npub fn main() -> Status {\n\treturn Status.Pending\n}\n',
			);
			const legacy = await compileWithLegacyKernel(input);
			assert.equal(legacy.accepted, false, 'Legacy must reject importing a private enum');
			assert.deepEqual(legacy.emittedModules, []);
			const output = await kernel.compile(input);
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
		});

		await t.test('public enum from another module remains unavailable without an import binding', async () => {
			const input = projectInput(
				'pub enum Status {\n\tPending\n}\n',
				'fn bad() -> Int {\n\treturn Status.Pending\n}\n\npub fn main() -> Int {\n\treturn 1\n}\n',
			);
			const legacy = await compileWithLegacyKernel(input);
			assert.equal(legacy.accepted, false, 'Legacy must reject an unimported cross-module enum reference');
			assert.deepEqual(legacy.emittedModules, []);
			const output = await kernel.compile(input);
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
			assert.ok(output.diagnostics.some(item =>
				item.sourcePath === 'src/main.virune'
				&& item.code === 'L1010'
				&& item.message === 'Unknown name Status.Pending'
			));
		});

		await t.test('zero-payload enum variant remains a value rather than a zero-argument function', async () => {
			const input = projectInput(
				'pub enum Status {\n\tPending\n}\n',
				'import { Status } from "./domain.virune"\n\npub fn main() -> Status {\n\treturn Status.Pending()\n}\n',
			);
			const legacy = await compileWithLegacyKernel(input);
			assert.equal(legacy.accepted, false, 'Legacy must reject calling a zero-payload enum value');
			assert.deepEqual(legacy.emittedModules, []);
			const output = await kernel.compile(input);
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
			assert.ok(output.diagnostics.some(item =>
				item.sourcePath === 'src/main.virune'
				&& item.code === 'L1010'
				&& item.message === 'Unknown name Status.Pending'
			));
		});

		await t.test('payload type mismatch uses the declared payload type', async () => {
			const output = await kernel.compile(projectInput(
				'pub enum Status {\n\tFailed(String)\n}\n',
				'import { Status } from "./domain.virune"\n\npub fn main() -> Status {\n\treturn Status.Failed(7)\n}\n',
			));
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
			assert.ok(output.diagnostics.some(item =>
				item.sourcePath === 'src/main.virune'
				&& item.code === 'L2043'
				&& item.message === 'Int cannot be used as String'
			));
		});

		await t.test('type-only import remains fail-closed at the current #380 parser boundary', async () => {
			const input = projectInput(
				'pub enum Status {\n\tPending\n}\n',
				'import type { Status } from "./domain.virune"\n\npub fn main() -> Status {\n\treturn Status.Pending\n}\n',
			);
			const legacy = await compileWithLegacyKernel(input);
			assert.equal(legacy.accepted, false, 'Legacy must reject runtime use through import type');
			assert.deepEqual(legacy.emittedModules, []);
			const output = await kernel.compile(input);
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
			assert.ok(output.diagnostics.some(item =>
				item.sourcePath === 'src/main.virune'
				&& item.code === 'L0002'
				&& item.message === 'Expected { but found type'
			));
		});

		await t.test('duplicate local import aliases never select one external enum signature', async () => {
			const input = validateKernelInput({
				contractVersion: '1',
				languageVersion: '1.0',
				platform: 'node',
				entryPath: 'src/main.virune',
				sources: [
					{ path: 'src/a.virune', text: 'pub enum Status {\n\tPending\n}\n' },
					{ path: 'src/b.virune', text: 'pub enum Other {\n\tPending\n}\n' },
					{
						path: 'src/main.virune',
						text: 'import { Status as State } from "./a.virune"\n'
							+ 'import { Other as State } from "./b.virune"\n\n'
							+ 'pub fn main() -> State {\n\treturn State.Pending\n}\n',
					},
				],
				interopManifest: { version: '1', modules: [] },
				emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
			});
			const legacy = await compileWithLegacyKernel(input);
			assert.equal(legacy.accepted, false, 'Legacy must reject duplicate local import aliases');
			assert.deepEqual(legacy.emittedModules, []);
			const output = await kernel.compile(input);
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
		});

		await t.test('import alias colliding with a local declaration never creates enum metadata', async () => {
			const input = projectInput(
				'pub enum Status {\n\tPending\n}\n',
				'import { Status as State } from "./domain.virune"\n\nrecord State {\n\tid: Int\n}\n\nfn bad() -> State {\n\treturn State.Pending\n}\n\npub fn main() -> Int {\n\treturn 1\n}\n',
			);
			const legacy = await compileWithLegacyKernel(input);
			assert.equal(legacy.accepted, false, 'Legacy must reject an import alias that collides with a local declaration');
			assert.deepEqual(legacy.emittedModules, []);
			const output = await kernel.compile(input);
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
		});

		await t.test('user-defined payload identity is not guessed from an unqualified type name', async () => {
			const input = projectInput(
				'pub record User {\n\tname: String\n}\n\npub enum Status {\n\tFailed(User)\n}\n',
				'import { Status } from "./domain.virune"\n\nrecord User {\n\tid: Int\n}\n\nfn wrap(user: User) -> Status {\n\treturn Status.Failed(user)\n}\n\npub fn main() -> Int {\n\treturn 1\n}\n',
			);
			const legacy = await compileWithLegacyKernel(input);
			assert.equal(legacy.accepted, false, 'Legacy must preserve nominal payload identity across modules');
			assert.deepEqual(legacy.emittedModules, []);
			const output = await kernel.compile(input);
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
			assert.ok(output.diagnostics.some(item =>
				item.sourcePath === 'src/main.virune'
				&& item.code === 'L1010'
				&& item.message === 'Unknown name Status.Failed'
			));
		});

		await t.test('generic enum remains unsupported rather than monomorphically guessed', async () => {
			const output = await kernel.compile(projectInput(
				'pub enum Box<T> {\n\tFull(T)\n}\n',
				'import { Box } from "./domain.virune"\n\npub fn main() -> Box<Int> {\n\treturn Box.Full(1)\n}\n',
			));
			assert.equal(output.accepted, false);
			assert.deepEqual(output.emittedModules, []);
			assert.ok(output.diagnostics.some(item =>
				item.sourcePath === 'src/main.virune'
				&& item.code === 'L1010'
				&& item.message === 'Unknown name Box.Full'
			));
		});
	});
});
