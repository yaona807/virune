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
	runCleanBootstrap,
	wrapCleanBootstrapEvidence,
} from './run-selfhost-clean-bootstrap.mjs';

const COMMIT = '1'.repeat(40);
const SEED = 'a'.repeat(64);
const STAGE = 'b'.repeat(64);
const MANIFEST = 'c'.repeat(64);
const LOCK = 'd'.repeat(64);

function execution(status, stdout = '', stderr = '') { return { status, stdout, stderr }; }
function command(name) { return { name, exitCode: 0, stdoutSha256: 'e'.repeat(64), stderrSha256: 'f'.repeat(64) }; }

async function writeSourceFixture(root) {
	await mkdir(join(root, '.github/self-hosting'), { recursive: true });
	await writeFile(join(root, '.github/self-hosting/stage0-seed.json'), JSON.stringify({ artifact: { sha256: SEED } }), 'utf8');
	await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3}\n', 'utf8');
	await mkdir(join(root, '.cache'), { recursive: true });
	await writeFile(join(root, '.cache/seed.tgz'), 'seed', 'utf8');
}

test('clean bootstrap input binds verified Seed, offline mode, exact commit and Stage 2 candidate', () => {
	const input = createCleanBootstrapInput({
		repositoryCommit: COMMIT,
		checkedAt: '2026-08-07T00:00:00.000Z',
		workingTreeClean: true,
		lockfileSha256: LOCK,
		manifestSha256: MANIFEST,
		artifactSha256: SEED,
		seedExecution: execution(0, JSON.stringify({ passed: true, sha256: SEED })),
		bootstrapExecution: execution(0, JSON.stringify({
			status: 'match', equivalent: true, seed: { artifactSha256: SEED }, stage1: { sha256: STAGE }, stage2: { sha256: STAGE },
		})),
		commands: [command('install'), command('seed-verify'), command('bootstrap')],
	});
	assert.equal(input.networkMode, 'offline');
	assert.equal(input.seed.verified, true);
	assert.equal(input.bootstrap.equivalent, true);
	assert.equal(input.candidateSha256, STAGE);
	assert.equal(input.repositoryCommit, COMMIT);
});

test('wrapper preserves deterministic evaluator failures and non-promotable boundary', () => {
	const wrapped = wrapCleanBootstrapEvidence({
		report: {
			status: 'fail', candidateSha256: STAGE, repositoryCommit: COMMIT, checkedAt: '2026-08-07T00:00:00.000Z',
			workingTreeClean: false, networkMode: 'offline', lockfileSha256: LOCK,
			seed: { manifestSha256: MANIFEST, artifactSha256: SEED, verified: true },
			bootstrap: { seedSha256: SEED, stage1Sha256: STAGE, stage2Sha256: STAGE, equivalent: true },
			commands: [command('install'), command('seed-verify'), command('bootstrap')],
			failures: [{ code: 'DIRTY_WORKTREE', path: '$.workingTreeClean', message: 'dirty' }],
		},
		sha256: '9'.repeat(64),
	});
	assert.equal(wrapped.claim, 'selfhost-clean-bootstrap');
	assert.equal(wrapped.productionEligible, false);
	assert.equal(wrapped.status, 'fail');
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

test('runner proves a clean local clone with offline commands and fixed-Seed bootstrap evidence', async () => {
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
			if (cmd[0] === 'node' && cmd[1] === 'scripts/run-selfhost-fixed-seed-bootstrap.mjs') return execution(0, JSON.stringify({
				status: 'match', equivalent: true, seed: { artifactSha256: SEED }, stage1: { sha256: STAGE }, stage2: { sha256: STAGE },
			}));
			return execution(0, '');
		};
		const evidence = await runCleanBootstrap({
			repositoryRoot: root,
			artifactPath: join(root, '.cache/seed.tgz'),
			workingRoot: join(root, '.cache/clean'),
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
		assert.equal(evidence.networkMode, 'offline');
		assert.ok(calls.some(call => call.cmd[0] === 'git' && call.cmd[1] === 'clone'));
		assert.ok(calls.filter(call => call.cmd[0] === 'npm').every(call => call.env.npm_config_offline === 'true'));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('CLI parsing is bounded', () => {
	assert.deepEqual(parseArguments(['--json', '--working-root=.cache/x']), {
		help: false,
		json: true,
		artifact: null,
		output: '.cache/selfhost/clean-bootstrap.json',
		workingRoot: '.cache/x',
	});
	assert.throws(() => parseArguments(['--wat']), /Unknown argument/u);
	assert.throws(() => parseArguments(['--json', '--json']), /Duplicate option/u);
});

test('main writes fail evidence before throwing', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-clean-bootstrap-main-'));
	try {
		await writeSourceFixture(root);
		await assert.rejects(() => main(['--output=.cache/report.json'], {
			repositoryRoot: root,
			seedVerifier: async () => { throw new Error('seed unavailable'); },
		}), /did not pass/u);
		const evidence = JSON.parse(await readFile(join(root, '.cache/report.json'), 'utf8'));
		assert.equal(evidence.claim, 'selfhost-clean-bootstrap');
		assert.equal(evidence.status, 'fail');
		assert.match(evidence.error, /seed unavailable/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
