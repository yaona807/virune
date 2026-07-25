import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyWorkflows } from './verify-workflows.mjs';

async function fixture(reference, { permissions = { contents: 'read' }, exception } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'virune-workflow-policy-'));
	await mkdir(join(root, '.github/workflows'), { recursive: true });
	await writeFile(join(root, '.github/actions-policy.json'), `${JSON.stringify({
		schemaVersion: 2,
		allowedReferences: { 'actions/checkout': ['v6'] },
		workflowPermissions: {
			default: { contents: 'read' },
			exceptions: exception === undefined ? {} : { 'test.yml': exception },
		},
	}, null, '\t')}\n`);
	await writeWorkflow(root, reference, permissions);
	return root;
}

async function writeWorkflow(root, reference, permissions) {
	const permissionBlock = permissions === null
		? ''
		: `\npermissions:\n${Object.entries(permissions).map(([scope, access]) => `  ${scope}: ${access}`).join('\n')}\n`;
	await writeFile(join(root, '.github/workflows/test.yml'), `name: Test\n\non:\n  workflow_dispatch:\n${permissionBlock}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${reference}\n`);
}

test('accepts action references and least-privilege permissions declared by policy', async t => {
	const root = await fixture('v6');
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.doesNotReject(verifyWorkflows(root));
});

test('accepts an explicitly reviewed workflow permission exception', async t => {
	const permissions = { contents: 'read', 'security-events': 'write' };
	const root = await fixture('v6', { permissions, exception: permissions });
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
	await writeFile(join(root, '.github/workflows/test.yml'), 'name: Test\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout\n');
	await assert.rejects(verifyWorkflows(root), /must include an explicit ref/u);
});

test('rejects a workflow without explicit permissions', async t => {
	const root = await fixture('v6', { permissions: null });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /missing top-level permissions/u);
});

test('rejects an undeclared write scope', async t => {
	const root = await fixture('v6', { permissions: { contents: 'write' } });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /do not match policy/u);
});

test('rejects job-level permission overrides', async t => {
	const root = await fixture('v6');
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, '.github/workflows/test.yml'), 'name: Test\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    permissions:\n      contents: write\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n');
	await assert.rejects(verifyWorkflows(root), /job-level permissions are not permitted/u);
});
