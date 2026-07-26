import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { writeReleaseRepairAudit } from './write-release-repair-audit.mjs';

test('records deterministic before and after release asset digests', t => {
	const root = mkdtempSync(join(tmpdir(), 'virune-release-repair-audit-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const before = resolve(root, 'before');
	const after = resolve(root, 'after');
	mkdirSync(before);
	mkdirSync(after);
	writeFileSync(resolve(before, 'asset.tgz'), 'old');
	writeFileSync(resolve(before, 'removed.txt'), 'removed');
	writeFileSync(resolve(after, 'asset.tgz'), 'new');
	writeFileSync(resolve(after, 'added.txt'), 'added');
	const output = resolve(root, 'audit.json');
	const audit = writeReleaseRepairAudit({
		beforeDirectory: before,
		afterDirectory: after,
		output,
		tag: 'v1.0.0',
		reason: 'Correct a compromised upload',
		actor: 'maintainer',
		targetCommit: 'abc123',
		workflowRun: 'https://github.com/yaona807/virune/actions/runs/1',
		generatedAt: '2026-07-25T00:00:00.000Z',
	});
	assert.deepEqual(audit.changedFiles, ['added.txt', 'asset.tgz', 'removed.txt']);
	assert.equal(audit.before.length, 2);
	assert.equal(audit.after.length, 2);
	assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), audit);
});

test('rejects an audit without a reason', t => {
	const root = mkdtempSync(join(tmpdir(), 'virune-release-repair-audit-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(resolve(root, 'before'));
	mkdirSync(resolve(root, 'after'));
	assert.throws(() => writeReleaseRepairAudit({
		beforeDirectory: resolve(root, 'before'),
		afterDirectory: resolve(root, 'after'),
		output: resolve(root, 'audit.json'),
		tag: 'v1.0.0',
		reason: ' ',
		actor: 'maintainer',
		targetCommit: 'abc123',
		workflowRun: 'run',
	}), /requires reason/u);
});
