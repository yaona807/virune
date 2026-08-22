import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateNightlyRun, resolveExpectedNightlySha, resolveNightlyBranch, runStableReleaseGate, selectNightlyRun } from './stable-release-gate.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('accepts a successful recent Nightly run for the expected commit', () => {
	const now = Date.parse('2026-07-25T00:00:00Z');
	const result = evaluateNightlyRun({ id: 1, conclusion: 'success', head_sha: 'candidate', updated_at: '2026-07-24T18:00:00Z' }, { maxAgeHours: 36, branch: 'main', expectedSha: 'candidate' }, now);
	assert.equal(result.passed, true);
	assert.equal(result.ageHours, 6);
	assert.equal(result.branch, 'main');
	assert.equal(result.expectedSha, 'candidate');
});

test('rejects failed, stale, and mismatched Nightly evidence', () => {
	const now = Date.parse('2026-07-25T12:00:00Z');
	assert.equal(evaluateNightlyRun({ conclusion: 'failure', head_sha: 'candidate', updated_at: '2026-07-25T11:00:00Z' }, { maxAgeHours: 36, expectedSha: 'candidate' }, now).passed, false);
	assert.equal(evaluateNightlyRun({ conclusion: 'success', head_sha: 'candidate', updated_at: '2026-07-23T00:00:00Z' }, { maxAgeHours: 36, expectedSha: 'candidate' }, now).passed, false);
	const mismatched = evaluateNightlyRun({ conclusion: 'success', head_sha: 'previous', updated_at: '2026-07-25T11:00:00Z' }, { maxAgeHours: 36, expectedSha: 'candidate' }, now);
	assert.equal(mismatched.passed, false);
	assert.match(mismatched.reason, /does not match expected release commit/u);
});

test('ignores later cancelled or skipped Nightly runs for the same commit', () => {
	const selected = selectNightlyRun([
		{ id: 3, conclusion: 'cancelled', head_sha: 'candidate', created_at: '2026-07-25T03:00:00Z' },
		{ id: 2, conclusion: 'skipped', head_sha: 'candidate', created_at: '2026-07-25T02:00:00Z' },
		{ id: 1, conclusion: 'success', head_sha: 'candidate', created_at: '2026-07-25T01:00:00Z' },
	], { expectedSha: 'candidate' });
	assert.equal(selected?.id, 1);
});

test('does not hide a newer failed Nightly behind an older success', () => {
	const selected = selectNightlyRun([
		{ id: 1, conclusion: 'success', head_sha: 'candidate', created_at: '2026-07-25T01:00:00Z' },
		{ id: 2, conclusion: 'failure', head_sha: 'candidate', created_at: '2026-07-25T02:00:00Z' },
		{ id: 3, conclusion: 'cancelled', head_sha: 'candidate', created_at: '2026-07-25T03:00:00Z' },
		{ id: 4, conclusion: 'success', head_sha: 'other', created_at: '2026-07-25T04:00:00Z' },
	], { expectedSha: 'candidate' });
	assert.equal(selected?.id, 2);
});

test('returns no usable Nightly when all matching runs were cancelled or skipped', () => {
	const selected = selectNightlyRun([
		{ id: 1, conclusion: 'cancelled', head_sha: 'candidate', created_at: '2026-07-25T02:00:00Z' },
		{ id: 2, conclusion: 'skipped', head_sha: 'candidate', created_at: '2026-07-25T01:00:00Z' },
		{ id: 3, conclusion: 'success', head_sha: 'other', created_at: '2026-07-25T03:00:00Z' },
	], { expectedSha: 'candidate' });
	assert.equal(selected, undefined);
});

test('uses pull-request head Nightly evidence without weakening tag releases', () => {
	assert.equal(resolveNightlyBranch('main', { GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'agent/fix' }), 'agent/fix');
	assert.equal(resolveNightlyBranch('main', { GITHUB_EVENT_NAME: 'push', GITHUB_HEAD_REF: 'agent/fix' }), 'main');
	assert.equal(resolveNightlyBranch('main', { GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: '' }), 'main');
});

test('resolves the exact pull-request head SHA and falls back to GITHUB_SHA', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-release-event-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const eventPath = join(root, 'event.json');
	await writeFile(eventPath, '{"pull_request":{"head":{"sha":"pull-request-head"}}}\n');
	assert.equal(await resolveExpectedNightlySha({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, GITHUB_SHA: 'merge-commit' }), 'pull-request-head');
	assert.equal(await resolveExpectedNightlySha({ GITHUB_EVENT_NAME: 'push', GITHUB_SHA: 'tagged-commit' }), 'tagged-commit');
	assert.equal(await resolveExpectedNightlySha({ GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: join(root, 'missing.json'), GITHUB_SHA: 'fallback' }), 'fallback');
});

test('canonical stable gate requires the npm publication plan verifier', async () => {
	const policy = JSON.parse(await readFile(resolve(repositoryRoot, '.github/stable-release-gate.json'), 'utf8'));
	assert.deepEqual(
		policy.checks.filter(check => check.id === 'npm-publication-plan'),
		[{ id: 'npm-publication-plan', command: ['node', 'scripts/verify-npm-publication-plan.mjs'] }],
	);
	assert.deepEqual(
		policy.requirements.filter(requirement => requirement.id === 'npm-publication-plan'),
		[{ id: 'npm-publication-plan', evidence: ['npm-publication-plan'] }],
	);
});

test('failed npm publication plan evidence fails the stable release requirement', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-release-npm-plan-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, '.github'), { recursive: true });
	await writeFile(join(root, 'package.json'), '{"version":"1.0.0"}\n');
	await writeFile(join(root, '.github/stable-release-gate.json'), `${JSON.stringify({
		schemaVersion: 1,
		nightly: { workflow: 'nightly.yml', branch: 'main', maxAgeHours: 36 },
		checks: [{ id: 'npm-publication-plan', command: ['node', 'scripts/verify-npm-publication-plan.mjs'] }],
		requirements: [{ id: 'npm-publication-plan', evidence: ['npm-publication-plan'] }],
	}, null, '\t')}\n`);
	const output = join(root, 'evidence.json');
	await assert.rejects(runStableReleaseGate({
		root,
		output,
		execute: async () => ({ status: 1, outputTail: 'publication plan failed' }),
		fetchLatestNightly: async policy => ({ passed: true, conclusion: 'success', headSha: policy.expectedSha, expectedSha: policy.expectedSha }),
	}), /Stable release gate failed/u);
	const report = JSON.parse(await readFile(output, 'utf8'));
	assert.equal(report.requirements.find(item => item.id === 'npm-publication-plan').passed, false);
});

test('missing or renamed npm publication plan evidence fails closed', async t => {
	for (const checkId of [undefined, 'npm-publication-plan-renamed']) {
		const root = await mkdtemp(join(tmpdir(), 'virune-release-npm-plan-missing-'));
		t.after(() => rm(root, { recursive: true, force: true }));
		await mkdir(join(root, '.github'), { recursive: true });
		await writeFile(join(root, 'package.json'), '{"version":"1.0.0"}\n');
		await writeFile(join(root, '.github/stable-release-gate.json'), `${JSON.stringify({
			schemaVersion: 1,
			nightly: { workflow: 'nightly.yml', branch: 'main', maxAgeHours: 36 },
			checks: checkId === undefined ? [] : [{ id: checkId, command: ['node', 'scripts/verify-npm-publication-plan.mjs'] }],
			requirements: [{ id: 'npm-publication-plan', evidence: ['npm-publication-plan'] }],
		}, null, '\t')}\n`);
		await assert.rejects(
			runStableReleaseGate({
				root,
				output: join(root, 'evidence.json'),
				execute: async () => ({ status: 0 }),
				fetchLatestNightly: async () => ({ passed: true }),
			}),
			/Invalid stable release requirement: npm-publication-plan/u,
		);
	}
});

test('malformed or duplicate stable gate checks fail closed', async t => {
	for (const checks of [
		[{ id: 'npm-publication-plan', command: [] }],
		[
			{ id: 'npm-publication-plan', command: ['node', 'scripts/verify-npm-publication-plan.mjs'] },
			{ id: 'npm-publication-plan', command: ['node', 'scripts/verify-npm-publication-plan.mjs'] },
		],
	]) {
		const root = await mkdtemp(join(tmpdir(), 'virune-release-npm-plan-invalid-'));
		t.after(() => rm(root, { recursive: true, force: true }));
		await mkdir(join(root, '.github'), { recursive: true });
		await writeFile(join(root, 'package.json'), '{"version":"1.0.0"}\n');
		await writeFile(join(root, '.github/stable-release-gate.json'), `${JSON.stringify({
			schemaVersion: 1,
			nightly: { workflow: 'nightly.yml', branch: 'main', maxAgeHours: 36 },
			checks,
			requirements: [{ id: 'npm-publication-plan', evidence: ['npm-publication-plan'] }],
		}, null, '\t')}\n`);
		await assert.rejects(
			runStableReleaseGate({
				root,
				output: join(root, 'evidence.json'),
				execute: async () => ({ status: 0 }),
				fetchLatestNightly: async () => ({ passed: true }),
			}),
			/Invalid stable release check|Duplicate stable release check: npm-publication-plan/u,
		);
	}
});

test('writes evidence and rejects any failed requirement', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-release-gate-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, '.github'), { recursive: true });
	await writeFile(join(root, 'package.json'), '{"version":"1.0.0"}\n');
	await writeFile(join(root, '.github/stable-release-gate.json'), `${JSON.stringify({
		schemaVersion: 1,
		nightly: { workflow: 'nightly.yml', branch: 'main', maxAgeHours: 36 },
		checks: [{ id: 'quality', command: ['quality'] }, { id: 'release-artifacts', command: ['release'] }],
		requirements: [{ id: 'quality-required', evidence: ['quality'] }, { id: 'release-required', evidence: ['release-artifacts'] }, { id: 'nightly-required', evidence: ['nightly'] }],
	}, null, '\t')}\n`);
	const output = join(root, 'evidence.json');
	await assert.rejects(runStableReleaseGate({
		root,
		output,
		execute: async command => ({ status: command[0] === 'quality' ? 0 : 1 }),
		fetchLatestNightly: async policy => ({ passed: true, conclusion: 'success', headSha: policy.expectedSha, expectedSha: policy.expectedSha }),
	}), /Stable release gate failed/u);
	const report = JSON.parse(await readFile(output, 'utf8'));
	assert.equal(report.passed, false);
	assert.equal(report.requirements.find(item => item.id === 'release-required').passed, false);
});
