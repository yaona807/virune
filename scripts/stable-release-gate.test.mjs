import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluateNightlyRun, resolveExpectedNightlySha, resolveNightlyBranch, runStableReleaseGate } from './stable-release-gate.mjs';

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
