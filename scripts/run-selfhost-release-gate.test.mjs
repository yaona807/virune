import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	REQUIRED_SELFHOST_RELEASE_STEPS,
	createStepRecord,
	main,
	parseArguments,
	parseStepEvidence,
	runSelfhostReleaseGate,
	validateStepEvidence,
} from './run-selfhost-release-gate.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function evidence(id) {
	if (id === 'seed-verify') return { schemaVersion: 1, passed: true, sha256: A };
	if (id === 'fixed-seed-bootstrap') return {
		schemaVersion: 2,
		claim: 'fixed-seed-bootstrap-fixed-point',
		productionEligible: false,
		status: 'match',
		stage0Source: 'fixed-seed-artifact',
		seed: { verified: true, artifactSha256: A, manifestSha256: C },
		stage1: { sha256: A },
		stage2: { sha256: B },
		stage3: { sha256: B },
		transition: { from: 'stage1', to: 'stage2', equivalent: false, differenceCount: 467 },
		fixedPoint: { from: 'stage2', to: 'stage3', attempted: true, equivalent: true, differenceCount: 0, error: null },
		equivalent: true,
	};
	if (id === 'clean-bootstrap') return {
		schemaVersion: 2,
		claim: 'selfhost-clean-bootstrap-fixed-point',
		productionEligible: false,
		status: 'pass',
		passed: true,
		candidateSha256: B,
		workingTreeClean: true,
		dependencyMode: 'offline',
		environment: {
			profile: 'baseline',
			timezone: 'UTC',
			locale: 'C.UTF-8',
			homeVariant: 'host-default',
			tempVariant: 'host-default',
		},
		lockfileSha256: C,
		seed: { verified: true, manifestSha256: C, artifactSha256: A },
		bootstrap: {
			seedSha256: A,
			stage1Sha256: A,
			stage2Sha256: B,
			stage3Sha256: B,
			fixedPointEquivalent: true,
			fixedPointDifferenceCount: 0,
		},
	};
	return {
		schemaVersion: 1,
		claim: 'selfhost-legacy-rollback-smoke',
		productionEligible: false,
		status: 'pass',
		workingTreeClean: true,
		selection: 'legacy',
		rollbackRequired: true,
		candidateAccessed: false,
	};
}

test('default step order covers fixed Seed, fixed point, clean bootstrap, and rollback', () => {
	assert.deepEqual(REQUIRED_SELFHOST_RELEASE_STEPS.map(step => step.id), [
		'seed-verify',
		'fixed-seed-bootstrap',
		'clean-bootstrap',
		'legacy-rollback',
	]);
	assert.equal(REQUIRED_SELFHOST_RELEASE_STEPS[1].command[1], 'scripts/run-selfhost-fixed-seed-bootstrap.mjs');
});

test('gate passes current evidence while keeping production ineligible', async () => {
	const byCommand = new Map(REQUIRED_SELFHOST_RELEASE_STEPS.map(step => [step.command.join('\0'), step.id]));
	const report = await runSelfhostReleaseGate({
		repositoryRoot: '/repo',
		now: () => new Date('2026-08-08T00:00:00.000Z'),
		execute: async command => ({ status: 0, stdout: JSON.stringify(evidence(byCommand.get(command.join('\0')))), stderr: '' }),
	});
	assert.equal(report.schemaVersion, 2);
	assert.equal(report.claim, 'selfhost-stable-release-gate-core');
	assert.equal(report.passed, true);
	assert.equal(report.productionEligible, false);
	assert.equal(report.policy.productionDefaultChange, false);
	assert.deepEqual(report.steps.map(step => step.status), ['pass', 'pass', 'pass', 'pass']);
	assert.match(report.evidenceSha256, /^[0-9a-f]{64}$/u);
});

test('Stage 1 to Stage 2 differences are transition evidence, not fixed-point failure', () => {
	const value = evidence('fixed-seed-bootstrap');
	assert.notEqual(value.stage1.sha256, value.stage2.sha256);
	assert.equal(value.transition.differenceCount, 467);
	assert.equal(validateStepEvidence('fixed-seed-bootstrap', value).passed, true);
});

test('fixed Seed evidence fails unless Stage 2 and Stage 3 are the exact fixed point', () => {
	const mismatch = structuredClone(evidence('fixed-seed-bootstrap'));
	mismatch.stage3.sha256 = C;
	assert.equal(validateStepEvidence('fixed-seed-bootstrap', mismatch).passed, false);

	const oldModel = {
		schemaVersion: 1,
		claim: 'fixed-seed-stage1-stage2-bootstrap',
		productionEligible: false,
		status: 'match',
		stage0Source: 'fixed-seed-artifact',
		seed: { verified: true, artifactSha256: A },
		stage1: { sha256: B },
		stage2: { sha256: B },
		equivalent: true,
	};
	assert.equal(validateStepEvidence('fixed-seed-bootstrap', oldModel).passed, false);
});

test('clean bootstrap requires schema v2 dependency-offline Stage 2/3 evidence', () => {
	assert.equal(validateStepEvidence('clean-bootstrap', evidence('clean-bootstrap')).passed, true);
	const online = structuredClone(evidence('clean-bootstrap'));
	online.dependencyMode = 'online';
	assert.equal(validateStepEvidence('clean-bootstrap', online).passed, false);
	const oldModel = { schemaVersion: 1, claim: 'selfhost-clean-bootstrap', status: 'pass', workingTreeClean: true, networkMode: 'offline', seed: { verified: true }, bootstrap: { equivalent: true } };
	assert.equal(validateStepEvidence('clean-bootstrap', oldModel).passed, false);
});

test('fixed Seed progress framing accepts exactly one current evidence object', () => {
	const current = evidence('fixed-seed-bootstrap');
	const stdout = [
		'FIXED_SEED_PROGRESS phase=bootstrap-start elapsedMs=0',
		'FIXED_SEED_PROGRESS phase=stage3-complete elapsedMs=10',
		JSON.stringify(current),
	].join('\n');
	const result = parseStepEvidence('fixed-seed-bootstrap', stdout);
	assert.equal(result.passed, true);
	assert.deepEqual(result.evidence, current);
});

test('fixed Seed framing fails closed on unknown or multiple JSON evidence frames', () => {
	const current = JSON.stringify(evidence('fixed-seed-bootstrap'));
	assert.equal(parseStepEvidence('fixed-seed-bootstrap', `${current}\n${current}`).passed, false);
	assert.equal(parseStepEvidence('fixed-seed-bootstrap', `FIXED_SEED_PROGRESS phase=x elapsedMs=0\n${JSON.stringify({ schemaVersion: 9, claim: 'unknown' })}`).passed, false);
	assert.equal(parseStepEvidence('fixed-seed-bootstrap', 'arbitrary log line').passed, false);
});

test('first failed required step fail-closes and later steps are skipped', async () => {
	let calls = 0;
	const report = await runSelfhostReleaseGate({
		repositoryRoot: '/repo',
		execute: async () => {
			calls += 1;
			return { status: 1, stdout: '', stderr: 'boom' };
		},
	});
	assert.equal(calls, 1);
	assert.equal(report.passed, false);
	assert.equal(report.steps[0].status, 'fail');
	assert.deepEqual(report.steps.slice(1).map(step => step.status), ['skipped', 'skipped', 'skipped']);
});

test('successful exit with malformed JSON still fails', () => {
	const record = createStepRecord('seed-verify', { status: 0, stdout: 'not-json', stderr: '' });
	assert.equal(record.passed, false);
	assert.match(record.reason, /exactly one JSON|JSON evidence/u);
});

test('CLI parsing is bounded to json and a cache output path', () => {
	assert.deepEqual(parseArguments(['--json', '--output=.cache/x.json']), { help: false, json: true, output: '.cache/x.json' });
	assert.throws(() => parseArguments(['--wat']), /Unknown argument/u);
	assert.throws(() => parseArguments(['--json', '--json']), /Duplicate option/u);
});

test('main writes failed evidence before throwing', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-selfhost-release-gate-'));
	try {
		await assert.rejects(() => main(['--output=.cache/release/report.json'], {
			repositoryRoot: root,
			execute: async () => ({ status: 1, stdout: '', stderr: 'expected failure' }),
		}), /Self-host stable release gate core failed/u);
		const report = JSON.parse(await readFile(join(root, '.cache/release/report.json'), 'utf8'));
		assert.equal(report.passed, false);
		assert.equal(report.productionEligible, false);
		assert.equal(report.steps[0].status, 'fail');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
