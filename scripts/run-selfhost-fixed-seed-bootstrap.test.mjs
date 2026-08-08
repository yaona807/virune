import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createEvidence,
	legacyBuildModules,
	main,
	parseArguments,
	runFixedSeedBootstrap,
	summarizeDifferences,
} from './run-selfhost-fixed-seed-bootstrap.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const SEED = '69c9d54a925377a2331ba39a229ab5809d946eef54bc43a5f14601eafd87d7b4';
const input = {
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: 'fn main() -> Int { return 1 }' }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
};

async function writeSeedManifest(root) {
	const path = join(root, '.github/self-hosting/stage0-seed.json');
	await mkdir(join(root, '.github/self-hosting'), { recursive: true });
	await writeFile(path, JSON.stringify({
		viruneVersion: '1.0.0',
		artifact: { sha256: SEED },
		baselines: { runtimeAbi: '2', interopAbi: '2' },
	}), 'utf8');
}

function stage1Build() {
	return {
		root: '/repo/selfhost/mvp',
		config: { languageVersion: '1.0', platform: 'node', target: 'es2022', sourceMap: false, sourcesContent: true },
		diagnostics: [],
		modules: [{
			source: { path: '/repo/selfhost/mvp/src/main.virune', text: 'x' },
			diagnostics: [],
			outputPath: '/repo/selfhost/mvp/dist/main.js',
			output: { code: 'export function compileMvp() {}\n', map: '{}' },
		}],
	};
}

function stageResult(code = 'export function compileMvp() {}\n') {
	return {
		accepted: true,
		diagnostics: [],
		emittedModules: [{
			sourcePath: 'src/main.virune',
			outputPath: 'dist/main.js',
			code,
			sourceMap: '{}',
		}],
	};
}

function fakeNormalizer(value) {
	const modules = value.modules.map(module => ({ ...module, path: module.path.replace('/repo/selfhost/mvp/', '') }));
	const artifact = { modules };
	const serialized = JSON.stringify(artifact);
	return { artifact, serialized, sha256: createHash('sha256').update(serialized).digest('hex') };
}

function dependencies({
	transitionEqual = true,
	fixedPointEqual = true,
	stage3Error = null,
} = {}) {
	let diffCall = 0;
	return {
		kernelInputFromProjectBuild: () => input,
		normalizeBootstrapArtifact: fakeNormalizer,
		extractGeneratedModuleExports: () => ['compileMvp'],
		snapshotProjectBuild: () => ({ artifact: { modules: [{ path: 'dist/main.js', code: 'x' }] }, sha256: A }),
		materializeBootstrapCompilerCandidate: async () => '/repo/.cache/candidate',
		loadBootstrapCompilerCandidate: async () => ({ compileMvp() {}, projectCompilerCapability() {}, compileProjectMvp() {} }),
		hasSelfhostProjectCompilerExports: () => true,
		readProjectCompilerCapability: () => ({ contractVersion: '1', ready: true, requestSchema: 'x', resultSchema: 'y', blockers: [] }),
		compileWithProjectCompilerBoundary: () => stageResult(),
		diffBootstrapArtifacts: (left, right) => {
			diffCall += 1;
			const equal = diffCall === 1 ? transitionEqual : fixedPointEqual;
			return {
				equal,
				beforeSha256: left.sha256,
				afterSha256: right.sha256,
				changes: equal ? [] : [
					{ section: 'modules', path: 'modules[0].code', before: 'a', after: 'b' },
					{ section: 'moduleOrder', path: 'moduleOrder[0]', before: 'a', after: 'b' },
				],
			};
		},
		stageArtifact: () => ({ sha256: B }),
		materializeBootstrapStageCompiler: async () => ({
			compiler: {
				compile: () => {
					if (stage3Error !== null) throw new Error(stage3Error);
					return stageResult();
				},
			},
			dispose: async () => {},
		}),
	};
}

test('runner uses the verified artifact and proves the Stage 2/Stage 3 fixed point', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-fixed-seed-run-'));
	let disposed = false;
	const progress = [];
	try {
		await writeSeedManifest(root);
		const evidence = await runFixedSeedBootstrap({
			repositoryRoot: root,
			projectPath: '/repo/selfhost/mvp',
			artifactPath: join(root, '.cache/seed.tgz'),
			temporaryRoot: join(root, '.cache/fixed-seed'),
			dependencies: dependencies(),
			seedVerifier: async () => ({ passed: true, sha256: SEED, artifact: join(root, '.cache/seed.tgz') }),
			seedCompilerLoader: async () => ({
				module: { buildProject: async () => stage1Build() },
				dispose: async () => { disposed = true; },
			}),
			onProgress: async event => { progress.push(event.phase); },
		});
		assert.equal(disposed, true);
		assert.equal(evidence.stage0Source, 'fixed-seed-artifact');
		assert.equal(evidence.status, 'match');
		assert.equal(evidence.equivalent, true);
		assert.equal(evidence.fixedPoint.equivalent, true);
		assert.equal(evidence.seed.verified, true);
		assert.deepEqual(progress, [
			'seed-verification-start',
			'seed-verification-complete',
			'seed-load-start',
			'seed-load-complete',
			'stage1-start',
			'stage1-complete',
			'stage2-start',
			'stage2-complete',
			'stage3-start',
			'stage3-complete',
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('Seed transition mismatch is preserved without invalidating a converged fixed point', () => {
	const stage1 = { sha256: A, artifact: { modules: [{}] } };
	const stage2 = { sha256: B, artifact: { modules: [{}] } };
	const stage3 = { sha256: B, artifact: { modules: [{}] } };
	const evidence = createEvidence({
		seed: { artifactSha256: A, manifestSha256: C },
		stage1,
		stage2,
		stage3,
		transitionDiff: {
			equal: false,
			changes: [
				{ section: 'modules', path: 'modules[0].code', before: 'a', after: 'b' },
				{ section: 'moduleOrder', path: 'moduleOrder[0]', before: 'a', after: 'b' },
			],
		},
		fixedPointDiff: { equal: true, changes: [] },
		capability: { ready: true },
	});
	assert.equal(evidence.productionEligible, false);
	assert.equal(evidence.status, 'match');
	assert.equal(evidence.transition.equivalent, false);
	assert.equal(evidence.transition.differenceCount, 2);
	assert.deepEqual(evidence.transition.differenceSummary.byField, { code: 1, path: 1 });
	assert.equal(evidence.fixedPoint.equivalent, true);
});

test('Stage 2 execution failure is blocked while retaining transition evidence', () => {
	const evidence = createEvidence({
		seed: { artifactSha256: A, manifestSha256: C },
		stage1: { sha256: A, artifact: { modules: [{}] } },
		stage2: { sha256: B, artifact: { modules: [{}] } },
		transitionDiff: { equal: false, changes: [{ section: 'modules', path: 'modules[0].code', before: 'a', after: 'b' }] },
		capability: { ready: true },
		stage3Error: 'List is not defined',
	});
	assert.equal(evidence.status, 'blocked');
	assert.equal(evidence.fixedPoint.attempted, true);
	assert.match(evidence.fixedPoint.error, /List is not defined/u);
	assert.equal(evidence.transition.differenceCount, 1);
});

test('difference summaries classify every change instead of only stored samples', () => {
	const summary = summarizeDifferences([
		{ section: 'modules', path: 'modules[0].code' },
		{ section: 'modules', path: 'modules[0].sourceMap.sources[0]' },
		{ section: 'moduleOrder', path: 'moduleOrder[0]' },
		{ section: 'metadata', path: 'metadata.target' },
	]);
	assert.deepEqual(summary, {
		total: 4,
		bySection: { metadata: 1, moduleOrder: 1, modules: 2 },
		byField: { code: 1, metadata: 1, path: 1, sourceMap: 1 },
	});
});

test('fixed-point mismatch remains non-promotable', () => {
	const evidence = createEvidence({
		seed: { artifactSha256: A, manifestSha256: C },
		stage1: { sha256: A, artifact: { modules: [{}] } },
		stage2: { sha256: B, artifact: { modules: [{}] } },
		stage3: { sha256: C, artifact: { modules: [{}] } },
		transitionDiff: { equal: false, changes: [] },
		fixedPointDiff: { equal: false, changes: [{ section: 'modules', path: 'modules[0].code', before: 'a', after: 'b' }] },
		capability: { ready: true },
	});
	assert.equal(evidence.productionEligible, false);
	assert.equal(evidence.status, 'mismatch');
	assert.equal(evidence.fixedPoint.differenceCount, 1);
});

test('failed fixed Seed project build cannot be treated as Stage 1', () => {
	const build = stage1Build();
	build.diagnostics.push({ severity: 'error', code: 'E1' });
	assert.throws(() => legacyBuildModules(build), /Fixed Seed project build failed/u);
});

test('CLI parsing is bounded and rejects duplicate options', () => {
	assert.deepEqual(parseArguments(['--json', '--project=selfhost/mvp']), {
		help: false,
		json: true,
		artifact: null,
		output: '.cache/selfhost/fixed-seed-bootstrap.json',
		project: 'selfhost/mvp',
		temporaryRoot: '.cache/selfhost/fixed-seed-bootstrap',
	});
	assert.throws(() => parseArguments(['--json', '--json']), /Duplicate option/u);
	assert.throws(() => parseArguments(['--wat']), /Unknown argument/u);
});

test('main writes blocked fixed-point evidence and progress before failing', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-fixed-seed-bootstrap-'));
	try {
		await writeSeedManifest(root);
		await assert.rejects(() => main(['--output=.cache/report.json'], {
			repositoryRoot: root,
			dependencies: dependencies(),
			seedVerifier: async () => { throw new Error('seed unavailable'); },
		}), /fixed point/u);
		const report = JSON.parse(await readFile(join(root, '.cache/report.json'), 'utf8'));
		assert.equal(report.claim, 'fixed-seed-bootstrap-fixed-point');
		assert.equal(report.status, 'blocked');
		assert.match(report.error, /seed unavailable/u);
		const progress = JSON.parse(await readFile(join(root, '.cache/report.progress.json'), 'utf8'));
		assert.equal(progress.claim, 'fixed-seed-bootstrap-progress');
		assert.equal(progress.productionEligible, false);
		assert.equal(progress.status, 'blocked');
		assert.equal(progress.phase, 'bootstrap-complete');
		assert.deepEqual(progress.checkpoints.map(checkpoint => checkpoint.phase), [
			'bootstrap-start',
			'seed-verification-start',
			'bootstrap-complete',
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
