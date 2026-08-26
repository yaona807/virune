import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyWorkflows } from './verify-workflows.mjs';

const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const UNKNOWN_SHA = '0000000000000000000000000000000000000000';
const DEPENDENCY_REVIEW_SHA = 'a1d282b36b6f3519aa1f3fc636f609c47dddb294';

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

async function dependencyReviewFixture({
	continueOnError = false,
	severity = 'moderate',
	auditCommand = 'npm audit --audit-level=moderate',
	reportFailure = continueOnError,
} = {}) {
	const root = await mkdtemp(join(tmpdir(), 'virune-dependency-review-policy-'));
	await mkdir(join(root, '.github/workflows'), { recursive: true });
	await writeFile(join(root, '.github/actions-policy.json'), `${JSON.stringify({
		schemaVersion: 3,
		allowedReferences: { 'actions/dependency-review-action': [DEPENDENCY_REVIEW_SHA] },
		workflowPermissions: {
			default: { contents: 'read' },
			exceptions: {},
		},
	}, null, '\t')}\n`);
	const reviewFallback = continueOnError
		? '        id: github_dependency_review\n        continue-on-error: true\n'
		: '';
	const failureReport = reportFailure
		? "\n      - name: Report unavailable review\n        if: steps.github_dependency_review.outcome == 'failure'\n        run: echo unavailable\n"
		: '';
	await writeFile(join(root, '.github/workflows/dependency-review.yml'), `name: Dependency review\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  dependency-review:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Review dependency changes\n${reviewFallback}        uses: actions/dependency-review-action@${DEPENDENCY_REVIEW_SHA}\n        with:\n          fail-on-severity: ${severity}\n\n      - name: Audit all locked dependencies\n        run: ${auditCommand}\n${failureReport}`);
	return root;
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

test('accepts a blocking dependency review with a complete locked-dependency audit', async t => {
	const root = await dependencyReviewFixture();
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.doesNotReject(verifyWorkflows(root));
});

test('accepts an explicit fallback when GitHub dependency review is unavailable', async t => {
	const root = await dependencyReviewFixture({ continueOnError: true });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.doesNotReject(verifyWorkflows(root));
});

test('rejects a dependency audit that omits development dependencies', async t => {
	const root = await dependencyReviewFixture({ auditCommand: 'npm audit --omit=dev --audit-level=moderate' });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /must block on a full locked-dependency npm audit/u);
});

test('rejects an unavailable GitHub review without an explicit report', async t => {
	const root = await dependencyReviewFixture({ continueOnError: true, reportFailure: false });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /must be reported explicitly/u);
});

test('rejects a dependency review threshold weaker than moderate', async t => {
	const root = await dependencyReviewFixture({ severity: 'high' });
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifyWorkflows(root), /must fail on moderate-or-higher findings/u);
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

test('requires semantic fuzz success for pull-request release artifacts', async () => {
	const source = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
	assert.match(
		source,
		/\(github\.event_name != 'pull_request' && needs\.semantic-fuzz\.result == 'skipped'\)/u,
	);
	assert.doesNotMatch(
		source,
		/needs\.semantic-fuzz\.result == 'success'\s*\|\|\s*needs\.semantic-fuzz\.result == 'skipped'/u,
	);
});
