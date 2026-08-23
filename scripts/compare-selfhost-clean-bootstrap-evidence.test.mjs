import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	compareCleanBootstrapEvidence,
	main,
	parseArguments,
} from './compare-selfhost-clean-bootstrap-evidence.mjs';

const COMMIT = '1'.repeat(40);
const CANDIDATE = '2'.repeat(64);
const STAGE1 = '3'.repeat(64);
const LOCK = '4'.repeat(64);
const MANIFEST = '5'.repeat(64);
const SEED = '6'.repeat(64);
const CHECKED_AT = '2026-08-22T00:00:00.000Z';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function evidence(profile, overrides = {}) {
	const environment = profile === 'baseline'
		? { profile, timezone: 'UTC', locale: 'C.UTF-8', homeVariant: 'host-default', tempVariant: 'host-default' }
		: { profile, timezone: 'Asia/Tokyo', locale: 'C', homeVariant: 'isolated-home', tempVariant: 'isolated-temp' };
	const base = {
		schemaVersion: 2,
		claim: 'selfhost-clean-bootstrap-fixed-point',
		productionEligible: false,
		status: 'pass',
		passed: true,
		candidateSha256: CANDIDATE,
		repositoryCommit: COMMIT,
		checkedAt: CHECKED_AT,
		workingTreeClean: true,
		dependencyMode: 'offline',
		environment,
		lockfileSha256: LOCK,
		seed: { manifestSha256: MANIFEST, artifactSha256: SEED, verified: true },
		bootstrap: {
			seedSha256: SEED,
			stage1Sha256: STAGE1,
			stage2Sha256: CANDIDATE,
			stage3Sha256: CANDIDATE,
			fixedPointEquivalent: true,
			fixedPointDifferenceCount: 0,
		},
		commands: [
			{ name:'install', exitCode:0, stdoutSha256:'7'.repeat(64), stderrSha256:'8'.repeat(64) },
			{ name:'seed-verify', exitCode:0, stdoutSha256:'9'.repeat(64), stderrSha256:'a'.repeat(64) },
			{ name:'bootstrap', exitCode:0, stdoutSha256:'b'.repeat(64), stderrSha256:'c'.repeat(64) },
		],
		failures: [],
		...overrides,
	};
	return {
		...base,
		evidenceSha256: overrides.evidenceSha256 ?? cleanBootstrapEvidenceSha(base),
	};
}
function cleanBootstrapEvidenceSha(value) {
	const report = {
		version: 2,
		candidateSha256: value.candidateSha256,
		repositoryCommit: value.repositoryCommit,
		checkedAt: value.checkedAt,
		status: value.status,
		failures: value.failures,
		workingTreeClean: value.workingTreeClean,
		dependencyMode: value.dependencyMode,
		environment: value.environment,
		lockfileSha256: value.lockfileSha256,
		seed: value.seed,
		bootstrap: value.bootstrap,
		commands: value.commands,
	};
	return hash(JSON.stringify(report));
}

test('independent baseline and perturbed runs produce one reproducibility witness', () => {
	const result = compareCleanBootstrapEvidence([
		evidence('perturbed'),
		evidence('baseline'),
	]);
	assert.equal(result.status, 'match');
	assert.equal(result.equivalent, true);
	assert.equal(result.independentRunCount, 2);
	assert.equal(result.repositoryCommit, COMMIT);
	assert.equal(result.candidateSha256, CANDIDATE);
	assert.equal(result.bootstrap.stage1Sha256, STAGE1);
	assert.equal(result.bootstrap.stage2Sha256, CANDIDATE);
	assert.equal(result.bootstrap.stage3Sha256, CANDIDATE);
	assert.deepEqual(result.profiles.map(value => value.profile), ['baseline', 'perturbed']);
	assert.notEqual(result.profiles[0].evidenceSha256, result.profiles[1].evidenceSha256);
	assert.match(result.evidenceSha256, /^[0-9a-f]{64}$/u);
	assert.equal(result.productionEligible, false);
});

test('canonical producer command order is required and reordered evidence fails closed', () => {
	const reordered = evidence('perturbed');
	reordered.commands = [reordered.commands[2], reordered.commands[0], reordered.commands[1]];
	reordered.evidenceSha256 = cleanBootstrapEvidenceSha(reordered);
	assert.throws(
		() => compareCleanBootstrapEvidence([evidence('baseline'), reordered]),
		/commands\[0\]\.name must be install/u,
	);
});

test('cross-runner comparison fails closed on repository, Seed or any bootstrap-stage digest drift', () => {
	const fields = [
		['repositoryCommit', { repositoryCommit: '7'.repeat(40) }, /repositoryCommit mismatch/u],
		['candidate', { candidateSha256: '7'.repeat(64) }, /candidateSha256/u],
		['seed', { seed: { manifestSha256: MANIFEST, artifactSha256: '7'.repeat(64), verified: true } }, /Seed|seed/u],
		['stage1', { bootstrap: { ...evidence('perturbed').bootstrap, stage1Sha256: '7'.repeat(64) } }, /stage1Sha256 mismatch/u],
	];
	for (const [label, overrides, pattern] of fields) {
		assert.throws(
			() => compareCleanBootstrapEvidence([evidence('baseline'), evidence('perturbed', overrides)]),
			pattern,
			label,
		);
	}
});

test('each independent run must itself prove the exact Stage 2/3 fixed point', () => {
	assert.throws(
		() => compareCleanBootstrapEvidence([
			evidence('baseline'),
			evidence('perturbed', {
				bootstrap: { ...evidence('perturbed').bootstrap, fixedPointDifferenceCount: 1 },
			}),
		]),
		/exact Stage 2\/3 fixed point/u,
	);
	assert.throws(
		() => compareCleanBootstrapEvidence([
			evidence('baseline'),
			evidence('perturbed', {
				bootstrap: { ...evidence('perturbed').bootstrap, stage3Sha256: '7'.repeat(64) },
			}),
		]),
		/exact Stage 2\/3 fixed point/u,
	);
});

test('profiles must be distinct and exactly baseline plus perturbed', () => {
	assert.throws(
		() => compareCleanBootstrapEvidence([evidence('baseline'), evidence('baseline')]),
		/environment profiles/u,
	);
	assert.throws(
		() => compareCleanBootstrapEvidence([evidence('baseline')]),
		/Exactly two/u,
	);
});

test('perturbed profile must change at least one real environment dimension', () => {
	const baselineEnvironment = evidence('baseline').environment;
	assert.throws(
		() => compareCleanBootstrapEvidence([
			evidence('baseline'),
			evidence('perturbed', { environment: { ...baselineEnvironment, profile: 'perturbed' } }),
		]),
		/Environment perturbation dimensions did not actually differ/u,
	);
});

test('tampered environment metadata without a matching clean-bootstrap self-hash is rejected', () => {
	const tampered = evidence('perturbed');
	tampered.environment = { ...tampered.environment, timezone: 'UTC' };
	assert.throws(
		() => compareCleanBootstrapEvidence([evidence('baseline'), tampered]),
		/evidenceSha256 does not match canonical clean-bootstrap evidence/u,
	);
});

test('CLI parsing requires both evidence inputs and bounds output', () => {
	assert.deepEqual(parseArguments([
		'--baseline=.cache/a.json',
		'--perturbed=.cache/b.json',
		'--json',
	]), {
		baseline: '.cache/a.json',
		perturbed: '.cache/b.json',
		output: '.cache/selfhost/clean-bootstrap-reproducibility.json',
		json: true,
		help: false,
	});
	assert.throws(() => parseArguments(['--baseline=.cache/a.json']), /--baseline and --perturbed are required/u);
	assert.throws(() => parseArguments(['--wat']), /Unknown argument/u);
});

test('CLI persists mismatch evidence before rejecting', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-cross-runner-'));
	try {
		await assert.rejects(
			() => main([
				'--baseline=.cache/a.json',
				'--perturbed=.cache/b.json',
				'--output=.cache/result.json',
			], {
				repositoryRoot: root,
				evidence: [evidence('baseline'), evidence('perturbed', { candidateSha256: '7'.repeat(64) })],
			}),
			/did not match/u,
		);
		const result = JSON.parse(await readFile(join(root, '.cache/result.json'), 'utf8'));
		assert.equal(result.status, 'mismatch');
		assert.equal(result.equivalent, false);
		assert.match(result.error, /candidateSha256/u);
		assert.equal(result.productionEligible, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
