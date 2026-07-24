import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluateNightlyRun, runStableReleaseGate } from './stable-release-gate.mjs';

test('accepts a successful recent Nightly run', () => {
	const now = Date.parse('2026-07-25T00:00:00Z');
	const result = evaluateNightlyRun({ id: 1, conclusion: 'success', updated_at: '2026-07-24T18:00:00Z' }, { maxAgeHours: 36 }, now);
	assert.equal(result.passed, true);
	assert.equal(result.ageHours, 6);
});

test('rejects failed and stale Nightly evidence', () => {
	const now = Date.parse('2026-07-25T12:00:00Z');
	assert.equal(evaluateNightlyRun({ conclusion: 'failure', updated_at: '2026-07-25T11:00:00Z' }, { maxAgeHours: 36 }, now).passed, false);
	assert.equal(evaluateNightlyRun({ conclusion: 'success', updated_at: '2026-07-23T00:00:00Z' }, { maxAgeHours: 36 }, now).passed, false);
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
		fetchLatestNightly: async () => ({ passed: true, conclusion: 'success' }),
	}), /Stable release gate failed/u);
	const report = JSON.parse(await readFile(output, 'utf8'));
	assert.equal(report.passed, false);
	assert.equal(report.requirements.find(item => item.id === 'release-required').passed, false);
});
