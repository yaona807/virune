import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyWorkflows } from './verify-workflows.mjs';

const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const UNKNOWN_SHA = '0000000000000000000000000000000000000000';

async function fixture(reference, { permissions = { contents: 'read' }, exception } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'virune-workflow-policy-'));
	await mkdir(join(root, '.github/workflows'), { recursive: true });
	await writeFile(join(root, '.github/actions-policy.json'), `${JSON.stringify({
		schemaVersion: 3,
		allowedReferences: { 'actions/checkout': [CHECKOUT_SHA] },
		workflowPermissions: {
			default: { contents: 'read' },
			exceptions: exception === undefined ? {} : { 'test.yml': exception },
		},
	}, null, '\t')}\n`);
	await writeWorkflow(root, reference, permissions);
	return root;
}

async function writeWorkflow(root, reference, permissions, comment = '') {
	const permissionBlock = permissions === null
		? ''
		: `\npermissions:\n${Object.entries(permissions).map(([scope, access]) => `  ${scope}: ${access}`).join('\n')}\n`;
	await writeFile(join(root, '.github/workflows/test.yml'), `name: Test\n\non:\n  workflow_dispatch:\n${permissionBlock}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${reference}${comment}\n`);
}

test('accepts a reviewed full-SHA action and least-privilege permissions', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.doesNotReject(verifyWorkflows(root));
});

test('accepts an informational version comment after the immutable SHA', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeWorkflow(root, CHECKOUT_SHA, { contents: 'read' }, ' # v7');
	await assert.doesNotReject(verifyWorkflows(root));
});

test('accepts an explicitly reviewed workflow permission exception', async t => {
	const permissions = { contents: 'read', 'security-events': 'write' };
	const root = await fixture(CHECKOUT_SHA, { permissions, exception: permissions });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.doesNotReject(verifyWorkflows(root));
});

test('rejects a mutable major-version action reference', async t => {
	const root = await fixture('v7');
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /must use a full 40-character commit SHA/u);
});

test('rejects an unreviewed full commit SHA', async t => {
	const root = await fixture(UNKNOWN_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /is not permitted/u);
});

test('rejects an external action without a ref', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, '.github/workflows/test.yml'), 'name: Test\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout\n');
	await assert.rejects(verifyWorkflows(root), /must include an explicit ref/u);
});

test('rejects a workflow without explicit permissions', async t => {
	const root = await fixture(CHECKOUT_SHA, { permissions: null });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /missing top-level permissions/u);
});

test('rejects an undeclared write scope', async t => {
	const root = await fixture(CHECKOUT_SHA, { permissions: { contents: 'write' } });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /do not match policy/u);
});

test('rejects job-level permission overrides', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, '.github/workflows/test.yml'), `name: Test\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    permissions:\n      contents: write\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${CHECKOUT_SHA}\n`);
	await assert.rejects(verifyWorkflows(root), /job-level permissions are not permitted/u);
});
