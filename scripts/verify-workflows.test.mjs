import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyWorkflows } from './verify-workflows.mjs';

const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const UNKNOWN_SHA = '0000000000000000000000000000000000000000';
const DEPENDENCY_REVIEW_SHA = 'a1d282b36b6f3519aa1f3fc636f609c47dddb294';
const REQUIRED_DRAFT_TRANSITIONS = ['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft'];

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

async function writeDraftGatedWorkflow(root, types, {
	style = 'inline',
	ifStyle = 'inline',
	itemComments = false,
} = {}) {
	let typesSource;
	if (style === 'inline') {
		typesSource = `    types: [${types.join(', ')}]\n`;
	} else if (style === 'block') {
		typesSource = `    types:\n${types.map(type => `      - ${type}${itemComments ? ' # required lifecycle event' : ''}`).join('\n')}\n`;
	} else if (style === 'unsupported-scalar') {
		typesSource = `    types: ${types[0] ?? ''}\n`;
	} else {
		throw new Error(`Unknown Draft workflow fixture style: ${style}`);
	}
	let ifSource;
	if (ifStyle === 'inline') {
		ifSource = '    if: github.event.pull_request.draft == false\n';
	} else if (ifStyle === 'block') {
		ifSource = '    if: >-\n      github.event.pull_request.draft == false\n';
	} else if (ifStyle === 'block-indented') {
		ifSource = '    if: >-2\n      github.event.pull_request.draft == false\n';
	} else {
		throw new Error(`Unknown Draft workflow if style: ${ifStyle}`);
	}
	await writeFile(join(root, '.github/workflows/test.yml'), `name: Test\n\non:\n  pull_request:\n${typesSource}\npermissions:\n  contents: read\n\njobs:\n  test:\n${ifSource}    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${CHECKOUT_SHA}\n`);
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

test('accepts a Draft-gated pull request workflow with an inline lifecycle list', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeDraftGatedWorkflow(root, REQUIRED_DRAFT_TRANSITIONS);
	await assert.doesNotReject(verifyWorkflows(root));
});

test('accepts block lifecycle lists, item comments, and block if expressions', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeDraftGatedWorkflow(root, REQUIRED_DRAFT_TRANSITIONS, {
		style: 'block',
		ifStyle: 'block',
		itemComments: true,
	});
	await assert.doesNotReject(verifyWorkflows(root));
});

test('accepts valid block scalar indentation indicators on Draft gates', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeDraftGatedWorkflow(root, REQUIRED_DRAFT_TRANSITIONS, { ifStyle: 'block-indented' });
	await assert.doesNotReject(verifyWorkflows(root));
});

test('does not treat an unrelated run string as a Draft gate', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, '.github/workflows/test.yml'), `name: Test\n\non:\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${CHECKOUT_SHA}\n      - run: echo github.event.pull_request.draft\n`);
	await assert.doesNotReject(verifyWorkflows(root));
});

test('rejects a Draft-gated workflow missing any required pull request lifecycle event', async t => {
	for (const missing of REQUIRED_DRAFT_TRANSITIONS) {
		await t.test(`missing ${missing}`, async () => {
			const root = await fixture(CHECKOUT_SHA);
			try {
				await writeDraftGatedWorkflow(root, REQUIRED_DRAFT_TRANSITIONS.filter(value => value !== missing));
				await assert.rejects(verifyWorkflows(root), new RegExp(`must subscribe to ${missing}`, 'u'));
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		});
	}
});

test('rejects unsupported scalar pull request lifecycle syntax instead of guessing', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeDraftGatedWorkflow(root, ['opened'], { style: 'unsupported-scalar' });
	await assert.rejects(verifyWorkflows(root), /must declare pull_request types explicitly/u);
});

test('rejects duplicate pull request triggers instead of depending on YAML duplicate-key behavior', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	const types = `[${REQUIRED_DRAFT_TRANSITIONS.join(', ')}]`;
	await writeFile(join(root, '.github/workflows/test.yml'), `name: Test\n\non:\n  pull_request:\n    types: ${types}\n  pull_request:\n    types: ${types}\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    if: github.event.pull_request.draft == false\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${CHECKOUT_SHA}\n`);
	await assert.rejects(verifyWorkflows(root), /duplicate pull_request triggers are not supported/u);
});

test('rejects duplicate pull request types declarations instead of choosing one', async t => {
	const root = await fixture(CHECKOUT_SHA);
	t.after(() => rm(root, { recursive: true, force: true }));
	const types = `[${REQUIRED_DRAFT_TRANSITIONS.join(', ')}]`;
	await writeFile(join(root, '.github/workflows/test.yml'), `name: Test\n\non:\n  pull_request:\n    types: ${types}\n    types: [opened]\n\npermissions:\n  contents: read\n\njobs:\n  test:\n    if: github.event.pull_request.draft == false\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${CHECKOUT_SHA}\n`);
	await assert.rejects(verifyWorkflows(root), /duplicate pull_request types declarations are not supported/u);
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
