import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
	seedSha256: 'e'.repeat(64),
};

type GeneratedCompiler = Awaited<ReturnType<typeof loadBootstrapCompilerCandidate>>;

type DifferentialCorpusFixture = {
	readonly id: string;
	readonly tags: readonly string[];
	readonly input: unknown;
	readonly expectedDivergences?: readonly unknown[];
};

type RuntimeCase = {
	readonly id: string;
	readonly expectedReturnValue: unknown;
	readonly expectedDependencies: readonly {
		readonly modulePath: string;
		readonly sourceKind: string;
		readonly specifier: string;
		readonly resolvedPath: string;
		readonly typeOnly: boolean;
		readonly public: boolean;
	}[];
};

const sourceHashes: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	'project-multimodule-alias-import': {
		'src/helper.virune': '771cf3cf9f8b61d03fbc97bfb5af4d9594393edeeeaa9d75010eea11aabbbb5c',
		'src/main.virune': '1eaf2555b48c742fd82bd0c37339cdceda504b45f4e0ea46226fb82c235f0b50',
	},
	'project-multimodule-type-only-import': {
		'src/domain.virune': '76e32ddb1aa5e5b4412cfd9b2e6891f85ab1639426938b03d73116d07723631e',
		'src/main.virune': '77c13f4a8a763e40382dd693e1621529eb7e277eeb697e2001ab42652a1534b4',
	},
	'project-multimodule-public-enum': {
		'src/domain.virune': 'aa0a4d53e29c71b2bb95901c36d435e0a612321b349d7f2e5c398e4bf47b8fd0',
		'src/main.virune': '2bfc29d15712be82be9818778846fa9c11bf049a78e4e5fdc271030be33d95c7',
	},
};

const runtimeCases: readonly RuntimeCase[] = [
	{
		id: 'project-multimodule-alias-import',
		expectedReturnValue: 42,
		expectedDependencies: [{
			modulePath: 'src/main.virune',
			sourceKind: 'virune',
			specifier: './helper.virune',
			resolvedPath: 'src/helper.virune',
			typeOnly: false,
			public: false,
		}],
	},
	{
		id: 'project-multimodule-type-only-import',
		expectedReturnValue: 7,
		expectedDependencies: [{
			modulePath: 'src/main.virune',
			sourceKind: 'virune',
			specifier: './domain.virune',
			resolvedPath: 'src/domain.virune',
			typeOnly: true,
			public: false,
		}],
	},
	{
		id: 'project-multimodule-public-enum',
		expectedReturnValue: { $tag: 'Pending', $values: [] },
		expectedDependencies: [{
			modulePath: 'src/main.virune',
			sourceKind: 'virune',
			specifier: './domain.virune',
			resolvedPath: 'src/domain.virune',
			typeOnly: false,
			public: false,
		}],
	},
];

function loadDifferentialCorpus(): { readonly fixtures: readonly DifferentialCorpusFixture[] } {
	return JSON.parse(readFileSync(
		new URL('../../../../.github/self-hosting/differential-corpus-v1.json', import.meta.url),
		'utf8',
	)) as { readonly fixtures: readonly DifferentialCorpusFixture[] };
}

async function withGeneratedCompiler<T>(
	run: (module: GeneratedCompiler) => T | Promise<T>,
): Promise<T> {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		return await run(await loadBootstrapCompilerCandidate(root, 'dist/main.js'));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function selectedFixtures(corpus: { readonly fixtures: readonly DifferentialCorpusFixture[] }): readonly DifferentialFixtureV1[] {
	return runtimeCases.map(runtimeCase => {
		const fixture = corpus.fixtures.find(item => item.id === runtimeCase.id);
		assert.ok(fixture, `missing multi-module runtime fixture ${runtimeCase.id}`);
		assert.deepEqual(fixture.expectedDivergences, [], `${runtimeCase.id}: unexplained differences must not be whitelisted`);
		return {
			id: fixture.id,
			tags: fixture.tags,
			input: validateKernelInput(fixture.input),
			expectedDivergences: [],
		};
	});
}

test('multi-module Project differential fixtures retain canonical source identity and strict v1 profiles', () => {
	const corpus = loadDifferentialCorpus();
	for (const [fixtureId, expectedHashes] of Object.entries(sourceHashes)) {
		const fixture = corpus.fixtures.find(item => item.id === fixtureId);
		assert.ok(fixture, `missing multi-module differential fixture ${fixtureId}`);
		assert.ok(fixture.tags.includes('project'), `${fixtureId}: project tag`);
		assert.ok(fixture.tags.includes('multi-module'), `${fixtureId}: multi-module tag`);
		assert.deepEqual(fixture.expectedDivergences, [], `${fixtureId}: unexplained differences must not be whitelisted`);
		const fixtureInput = validateKernelInput(fixture.input);
		assert.equal(fixtureInput.platform, 'node', `${fixtureId}: platform`);
		assert.equal(fixtureInput.entryPath, 'src/main.virune', `${fixtureId}: entry path`);
		assert.equal(fixtureInput.sources.length, 2, `${fixtureId}: source count`);
		assert.deepEqual(fixtureInput.interopManifest.modules, [], `${fixtureId}: Interop remains outside this slice`);
		assert.equal(fixtureInput.emit.sourceMap, false, `${fixtureId}: source maps`);
		assert.equal(fixtureInput.emit.sourcesContent, true, `${fixtureId}: sourcesContent`);
		assert.deepEqual(
			Object.fromEntries(fixtureInput.sources.map(source => [
				source.path,
				createHash('sha256').update(source.text, 'utf8').digest('hex'),
			])),
			expectedHashes,
			`${fixtureId}: canonical source identity`,
		);
	}
});

test('positive multi-module fixtures retain independently grounded Legacy dependency and runtime meaning', async t => {
	const corpus = loadDifferentialCorpus();
	for (const runtimeCase of runtimeCases) {
		await t.test(runtimeCase.id, async () => {
			const fixture = corpus.fixtures.find(item => item.id === runtimeCase.id);
			assert.ok(fixture, `missing multi-module runtime fixture ${runtimeCase.id}`);
			assert.ok(fixture.tags.includes('runtime'), `${runtimeCase.id}: runtime tag`);
			const fixtureInput = validateKernelInput(fixture.input);
			const output = await compileWithLegacyKernel(fixtureInput);
			assert.equal(output.accepted, true, `${runtimeCase.id}: Legacy compiler rejected canonical fixture`);
			assert.deepEqual(output.diagnostics, [], `${runtimeCase.id}: Legacy diagnostics`);
			assert.deepEqual(output.dependencies, runtimeCase.expectedDependencies, `${runtimeCase.id}: Legacy dependency baseline`);
			const execution = await executeKernelOutputWithNode(fixtureInput, output);
			assert.equal(execution.exitCode, 0, `${runtimeCase.id}: runtime exit code`);
			assert.equal(execution.signal, null, `${runtimeCase.id}: runtime signal`);
			assert.equal(execution.panic, null, `${runtimeCase.id}: runtime panic`);
			assert.deepEqual(execution.returnValue, runtimeCase.expectedReturnValue, `${runtimeCase.id}: runtime return value`);
		});
	}
});

test('positive multi-module fixtures match the actual generated Self-host Project Compiler', async () => {
	const corpus = loadDifferentialCorpus();
	const fixtures = selectedFixtures(corpus);
	await withGeneratedCompiler(async module => {
		const report = await runDifferentialCorpus({
			fixtures,
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
			assert.deepEqual(caseReport.unexplainedDifferences, [], `${caseReport.fixtureId}: unexplained Legacy/Self-host differences`);
			assert.deepEqual(caseReport.staleExpectedDivergences, [], `${caseReport.fixtureId}: stale expected divergences`);
			assert.equal(caseReport.status, 'match', `${caseReport.fixtureId}: differential status`);
			assert.equal(caseReport.passed, true, `${caseReport.fixtureId}: differential pass`);
		}
		assert.equal(report.passed, true);
		assert.deepEqual(report.totals, {
			fixtures: runtimeCases.length,
			matched: runtimeCases.length,
			expectedDivergence: 0,
			failed: 0,
		});
	});
});
