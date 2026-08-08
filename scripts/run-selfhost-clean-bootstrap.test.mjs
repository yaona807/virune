import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createCleanBootstrapInput,
	executeOfflineInstall,
	main,
	parseArguments,
	prepareEnvironment,
	runCleanBootstrap,
	wrapCleanBootstrapEvidence,
} from './run-selfhost-clean-bootstrap.mjs';

const COMMIT = '1'.repeat(40);
const SEED = 'a'.repeat(64);
const STAGE1 = '6'.repeat(64);
const STAGE = 'b'.repeat(64);
const MANIFEST = 'c'.repeat(64);
const LOCK = 'd'.repeat(64);
const baselineEnvironment = {
	profile: 'baseline',
	timezone: 'UTC',
	locale: 'C.UTF-8',
	homeVariant: 'host-default',
	tempVariant: 'host-default',
};

function execution(status, stdout = '', stderr = '') { return { status, stdout, stderr }; }
function command(name) { return { name, exitCode: 0, stdoutSha256: 'e'.repeat(64), stderrSha256: 'f'.repeat(64) }; }
function fixedPointEvidence() {
	return {
		status: 'match',
		seed: { artifactSha256: SEED },
		stage1: { sha256: STAGE1 },
		stage2: { sha256: STAGE },
		stage3: { sha256: STAGE },
		fixedPoint: { equivalent: true, differenceCount: 0 },
	};
}

async function writeSourceFixture(root) {
	await mkdir(join(root, '.github/self-hosting'), { recursive: true });
	await writeFile(join(root, '.github/self-hosting/stage0-seed.json'), JSON.stringify({ artifact: { sha256: SEED } }), 'utf8');
	await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
	await mkdir(join(root, '.cache'), { recursive: true });
	await writeFile(join(root, '.cache/seed.tgz'), 'seed', 'utf8');
}

test('clean bootstrap input binds verified Seed, exact commit and Stage 2/3 fixed-point candidate', () => {
	const input = createCleanBootstrapInput({
		repositoryCommit: COMMIT,
		checkedAt: '2026-08-07T00:00:00.000Z',
		workingTreeClean: true,
		lockfileSha256: LOCK,
		manifestSha256: MANIFEST,
		artifactSha256: SEED,
		seedExecution: execution(0, JSON.stringify({ passed: true, sha256: SEED })),
		bootstrapExecution: execution(0, JSON.stringify(fixedPointEvidence())),
		environment: baselineEnvironment,
		commands: [command('install'), command('seed-verify'), command('bootstrap')],
	});
	assert.equal(input.version, 2);
	assert.equal(input.dependencyMode, 'offline');
	assert.equal(input.seed.verified, true);
	assert.notEqual(input.bootstrap.stage1Sha256, input.bootstrap.stage2Sha256);
	assert.equal(input.bootstrap.stage2Sha256, input.bootstrap.stage3Sha256);
	assert.equal(input.bootstrap.fixedPointEquivalent, true);
	assert.equal(input.bootstrap.fixedPointDifferenceCount, 0);
	assert.equal(input.candidateSha256, STAGE);
	assert.equal(input.repositoryCommit, COMMIT);
});

test('blocked or incomplete Stage 3 evidence fails closed in the evaluator input', () => {
	const input = createCleanBootstrapInput({
		repositoryCommit: COMMIT,
		checkedAt: '2026-08-07T00:00:00.000Z',
		workingTreeClean: true,
		lockfileSha256: LOCK,
		manifestSha256: MANIFEST,
		artifactSha256: SEED,
		seedExecution: execution(0, JSON.stringify({ passed: true, sha256: SEED })),
		bootstrapExecution: execution(1, JSON.stringify({
			status: 'blocked', seed: { artifactSha256: SEED }, stage1: { sha256: STAGE1 }, stage2: { sha256: STAGE }, stage3: null,
		})),
		environment: baselineEnvironment,
		commands: [command('install'), command('seed-verify'), command('bootstrap')],
	});
	assert.equal(input.candidateSha256, '0'.repeat(64));
	assert.equal(input.bootstrap.stage3Sha256, '0'.repeat(64));
	assert.equal(input.bootstrap.fixedPointEquivalent, false);
	assert.equal(input.bootstrap.fixedPointDifferenceCount, Number.MAX_SAFE_INTEGER);
});

test('wrapper preserves deterministic evaluator failures, environment evidence and non-promotable boundary', () => {
	const wrapped = wrapCleanBootstrapEvidence({
		report: {
			status: 'fail', candidateSha256: STAGE, repositoryCommit: COMMIT, checkedAt: '2026-08-07T00:00:00.000Z',
			workingTreeClean: false, dependencyMode: 'offline', environment: baselineEnvironment, lockfileSha256: LOCK,
			seed: { manifestSha256: MANIFEST, artifactSha256: SEED, verified: true },
			bootstrap: {
				seedSha256: SEED,
				stage1Sha256: STAGE1,
				stage2Sha256: STAGE,
				stage3Sha256: STAGE,
				fixedPointEquivalent: true,
				fixedPointDifferenceCount: 0,
			},
			commands: [command('install'), command('seed-verify'), command('bootstrap')],
			failures: [{ code: 'DIRTY_WORKTREE', path: '$.workingTreeClean', message: 'dirty' }],
		},
		sha256: '9'.repeat(64),
	});
	assert.equal(wrapped.claim, 'selfhost-clean-bootstrap-fixed-point');
	assert.equal(wrapped.productionEligible, false);
	assert.equal(wrapped.status, 'fail');
	assert.equal(wrapped.dependencyMode, 'offline');
	assert.deepEqual(wrapped.environment, baselineEnvironment);
	assert.equal(wrapped.failures[0].code, 'DIRTY_WORKTREE');
});

test('offline install runs npm ci before build and propagates offline environment', () => {
	const calls = [];
	const result = executeOfflineInstall('/clone', (cmd, cwd, env) => {
		calls.push({ cmd, cwd, env });
		return execution(0, `${cmd.join(' ')}\n`);
	});
	assert.equal(result.status, 0);
	assert.deepEqual(calls.map(value => value.cmd), [
		['npm', 'ci', '--offline', '--ignore-scripts'],
		['npm', 'run', 'build'],
	]);
	assert.equal(calls[0].env.npm_config_offline, 'true');
	assert.equal(calls[1].env.npm_config_offline, 'true');
});

test('perturbed profile varies HOME, temp root, timezone and locale without claiming network isolation', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-clean-bootstrap-env-'));
	try {
		const baseline = await prepareEnvironment('baseline', root);
		const perturbed = await prepareEnvironment('perturbed', root);
		assert.deepEqual(baseline.evidence, baselineEnvironment);
		assert.equal(baseline.variables.TZ, 'UTC');
		assert.equal(perturbed.evidence.profile, 'perturbed');
		assert.equal(perturbed.variables.TZ, 'Asia/Tokyo');
		assert.equal(perturbed.variables.LANG, 'C');
		assert.notEqual(perturbed.variables.HOME, process.env.HOME);
		assert.equal(perturbed.variables.TMPDIR, perturbed.variables.TMP);
		assert.equal(perturbed.variables.TMP, perturbed.variables.TEMP);
		assert.equal(perturbed.variables.npm_config_offline, 'true');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('runner proves a clean local clone with dependency-offline commands and fixed-Seed Stage 2/3 evidence', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-clean-bootstrap-'));
	try {
		await writeSourceFixture(root);
		const calls = [];
		const execute = (cmd, cwd, env = {}) => {
			calls.push({ cmd, cwd, env });
			const joined = cmd.join(' ');
			if (joined === 'git rev-parse HEAD') return execution(0, `${COMMIT}\n`);
			if (cmd[0] === 'git' && cmd[1] === 'status') return execution(0, '');
			if (cmd[0] === 'node' && cmd[1] === 'scripts/verify-selfhost-seed.mjs') return execution(0, JSON.stringify({ passed: true, sha256: SEED }));
			if (cmd[0] === 'node' && cmd[1] === 'scripts/run-selfhost-fixed-seed-bootstrap.mjs') return execution(0, JSON.stringify(fixedPointEvidence()));
			return execution(0, '');
		};
		const evidence = await runCleanBootstrap({
			repositoryRoot: root,
			artifactPath: join(root, '.cache/seed.tgz'),
			workingRoot: join(root, '.cache/clean'),
			environmentProfile: 'perturbed',
			now: () => new Date('2026-08-07T00:00:00.000Z'),
			execute,
			seedVerifier: async () => ({ passed: true, sha256: SEED, artifact: join(root, '.cache/seed.tgz') }),
			evaluatorLoader: async () => input => ({
				report: {
					...input,
					status: 'pass',
					failures: [],
				},
				sha256: '9'.repeat(64),
			}),
		});
		assert.equal(evidence.status, 'pass');
		assert.equal(evidence.workingTreeClean, true);
		assert.equal(evidence.dependencyMode, 'offline');
		assert.equal(evidence.environment.profile, 'perturbed');
		assert.equal(evidence.bootstrap.stage2Sha256, evidence.bootstrap.stage3Sha256);
		assert.equal(evidence.candidateSha256, STAGE);
		assert.ok(calls.some(call => call.cmd[0] === 'git' && call.cmd[1] === 'clone'));
		assert.ok(calls.filter(call => call.cmd[0] === 'npm').every(call => call.env.npm_config_offline === 'true'));
		assert.ok(calls.filter(call => call.cmd[0] === 'node').every(call => call.env.TZ === 'Asia/Tokyo'));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('CLI parsing is bounded and environment profile is explicit', () => {
	assert.deepEqual(parseArguments(['--json', '--working-root=.cache/x', '--environment-profile=perturbed']), {
		help: false,
		json: true,
		artifact: null,
		output: '.cache/selfhost/clean-bootstrap.json',
		workingRoot: '.cache/x',
		environmentProfile: 'perturbed',
	});
	assert.equal(parseArguments([]).environmentProfile, 'baseline');
	assert.throws(() => parseArguments(['--environment-profile=unknown']), /baseline or perturbed/u);
	assert.throws(() => parseArguments(['--wat']), /Unknown argument/u);
	assert.throws(() => parseArguments(['--json', '--json']), /Duplicate option/u);
});

test('main writes fail evidence before throwing', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-clean-bootstrap-main-'));
	try {
		await writeSourceFixture(root);
		await assert.rejects(() => main(['--output=.cache/report.json'], {
			repositoryRoot: root,
			execute: cmd => {
				if (cmd.join(' ') === 'git rev-parse HEAD') return execution(0, `${COMMIT}\n`);
				throw new Error(`Unexpected command: ${cmd.join(' ')}`);
			},
			seedVerifier: async () => { throw new Error('seed unavailable'); },
		}), /did not pass/u);
		const evidence = JSON.parse(await readFile(join(root, '.cache/report.json'), 'utf8'));
		assert.equal(evidence.claim, 'selfhost-clean-bootstrap-fixed-point');
		assert.equal(evidence.status, 'fail');
		assert.match(evidence.error, /seed unavailable/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
