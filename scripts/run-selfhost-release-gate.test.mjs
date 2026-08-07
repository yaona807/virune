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
	runSelfhostReleaseGate,
	validateStepEvidence,
} from './run-selfhost-release-gate.mjs';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function evidence(id) {
	if (id === 'seed-verify') return { schemaVersion: 1, passed: true, sha256: A };
	if (id === 'fixed-seed-bootstrap') return {
		schemaVersion: 1,
		claim: 'fixed-seed-stage1-stage2-bootstrap',
		productionEligible: false,
		status: 'match',
		stage0Source: 'fixed-seed-artifact',
		seed: { verified: true, artifactSha256: B },
		stage1: { sha256: A },
		stage2: { sha256: A },
		equivalent: true,
	};
	if (id === 'clean-bootstrap') return {
		schemaVersion: 1,
		claim: 'selfhost-clean-bootstrap',
		status: 'pass',
		workingTreeClean: true,
		networkMode: 'offline',
		seed: { verified: true },
		bootstrap: { equivalent: true },
	};
	return {
		schemaVersion: 1,
		claim: 'selfhost-legacy-rollback-smoke',
		status: 'pass',
		workingTreeClean: true,
		selection: 'legacy',
		rollbackRequired: true,
		candidateAccessed: false,
	};
}

test('default step order keeps actual fixed Seed proof separate from generic Stage bootstrap', () => {
	assert.deepEqual(REQUIRED_SELFHOST_RELEASE_STEPS.map(step => step.id), [
		'seed-verify',
		'fixed-seed-bootstrap',
		'clean-bootstrap',
		'legacy-rollback',
	]);
	assert.equal(REQUIRED_SELFHOST_RELEASE_STEPS[1].command[1], 'scripts/run-selfhost-fixed-seed-bootstrap.mjs');
});

test('gate passes only when all four evidence contracts pass', async () => {
	const byCommand = new Map(REQUIRED_SELFHOST_RELEASE_STEPS.map(step => [step.command.join('\0'), step.id]));
	const report = await runSelfhostReleaseGate({
		repositoryRoot: '/repo',
		now: () => new Date('2026-08-07T00:00:00.000Z'),
		execute: async command => ({ status: 0, stdout: JSON.stringify(evidence(byCommand.get(command.join('\0')))), stderr: '' }),
	});
	assert.equal(report.passed, true);
	assert.deepEqual(report.steps.map(step => step.status), ['pass', 'pass', 'pass', 'pass']);
	assert.match(report.evidenceSha256, /^[0-9a-f]{64}$/u);
});

test('fixed-seed bootstrap rejects current-style evidence that only carries a Seed hash witness', () => {
	const result = validateStepEvidence('fixed-seed-bootstrap', {
		schemaVersion: 1,
		claim: 'stage1-stage2-bootstrap',
		status: 'match',
		seedSha256: B,
		stage1: { sha256: A },
		stage2: { sha256: A },
		equivalent: true,
	});
	assert.equal(result.passed, false);
	assert.match(result.reason, /fixed Seed artifact/u);
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
	assert.match(record.reason, /exactly one JSON/u);
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
		}), /Self-host stable release gate failed/u);
		const report = JSON.parse(await readFile(join(root, '.cache/release/report.json'), 'utf8'));
		assert.equal(report.passed, false);
		assert.equal(report.steps[0].status, 'fail');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
