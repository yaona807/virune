import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyWorkflows } from './verify-workflows.mjs';

async function fixture(reference) {
	const root = await mkdtemp(join(tmpdir(), 'virune-workflow-policy-'));
	await mkdir(join(root, '.github/workflows'), { recursive: true });
	await writeFile(join(root, '.github/actions-policy.json'), `${JSON.stringify({
		schemaVersion: 1,
		allowedReferences: { 'actions/checkout': ['v6'] },
	}, null, '\t')}\n`);
	await writeFile(join(root, '.github/workflows/test.yml'), `name: Test\n\non:\n  workflow_dispatch:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${reference}\n`);
	return root;
}

test('accepts action references declared by policy', async t => {
	const root = await fixture('v6');
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.doesNotReject(verifyWorkflows(root));
});

test('rejects undeclared or nonexistent action major references', async t => {
	const root = await fixture('v999');
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /actions\/checkout@v999 is not permitted/u);
});

test('rejects unpinned external actions', async t => {
	const root = await fixture('v6');
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, '.github/workflows/test.yml'), 'name: Test\n\non:\n  workflow_dispatch:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout\n');
	await assert.rejects(verifyWorkflows(root), /must include an explicit ref/u);
});
