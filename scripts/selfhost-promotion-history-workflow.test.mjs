import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = '.github/workflows/selfhost-promotion-history-aggregation.yml';
const policyPath = '.github/actions-policy.json';

async function source() {
	return readFile(workflowPath, 'utf8');
}

function stepBlock(text, name) {
	const marker = `      - name: ${name}\n`;
	const start = text.indexOf(marker);
	assert.notEqual(start, -1, `missing workflow step ${name}`);
	const next = text.indexOf('\n      - name: ', start + marker.length);
	return text.slice(start, next === -1 ? text.length : next);
}

test('aggregation is triggered only by completed Promotion Observation workflow runs', async () => {
	const text = await source();
	assert.match(text, /^name: Self-host promotion history aggregation$/mu);
	assert.match(text, /^  workflow_run:$/mu);
	assert.match(text, /^    workflows:\n      - Self-host promotion observation\n    types:\n      - completed$/mu);
	assert.doesNotMatch(text, /^  (?:push|pull_request|schedule|workflow_dispatch):/mu);
});

test('workflow uses read-only Actions and contents permissions with non-cancelling serialization', async () => {
	const text = await source();
	assert.match(text, /^permissions:\n  actions: read\n  contents: read$/mu);
	assert.match(text, /^concurrency:\n  group: selfhost-promotion-history-aggregation\n  cancel-in-progress: false$/mu);
	const policy = JSON.parse(await readFile(policyPath, 'utf8'));
	assert.deepEqual(policy.workflowPermissions.exceptions['selfhost-promotion-history-aggregation.yml'], {
		actions: 'read',
		contents: 'read',
	});
});

test('aggregation checks out the exact default-branch event SHA and never the triggering observation head', async () => {
	const text = await source();
	assert.match(text, /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
	assert.match(text, /with:\n          ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false/u);
	assert.doesNotMatch(text, /ref:\s*main/u);
	assert.doesNotMatch(text, /checkout[^\n]*\n(?:.*\n){0,6}.*workflow_run\.head_sha/u);
	assert.doesNotMatch(text, /ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha/u);
});

test('job admits only canonical repository main observations from schedule or manual diagnostics', async () => {
	const text = await source();
	assert.match(text, /github\.repository == 'yaona807\/virune'/u);
	assert.match(text, /github\.event\.workflow_run\.head_branch == 'main'/u);
	assert.match(text, /github\.event\.workflow_run\.event == 'schedule'/u);
	assert.match(text, /github\.event\.workflow_run\.event == 'workflow_dispatch'/u);
});

test('canonical report and ledger use 90-day retention while failure diagnostics remain shorter lived', async () => {
	const text = await source();
	const report = stepBlock(text, 'Upload canonical aggregation report');
	const ledger = stepBlock(text, 'Upload canonical promotion history ledger');
	const failure = stepBlock(text, 'Upload aggregation failure diagnostic');
	assert.match(report, /name: selfhost-promotion-history-report-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(report, /path: \.cache\/selfhost-promotion-history\/aggregation-report\.json/u);
	assert.match(report, /retention-days: 90/u);
	assert.doesNotMatch(report, /retention-days: (?!90\b)\d+/u);
	assert.match(ledger, /if: steps\.aggregate\.outcome == 'success' && steps\.aggregate\.outputs\.publish == 'true'/u);
	assert.match(ledger, /name: selfhost-promotion-history-ledger-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(ledger, /path: \.cache\/selfhost-promotion-history\/promotion-history-ledger\.json/u);
	assert.match(ledger, /retention-days: 90/u);
	assert.doesNotMatch(ledger, /retention-days: (?!90\b)\d+/u);
	assert.match(failure, /name: selfhost-promotion-history-failure-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(failure, /path: \.cache\/selfhost-promotion-history\/aggregation-failure\.json/u);
	assert.match(failure, /retention-days: 30/u);
});

test('aggregation failures are diagnostics and cannot masquerade as canonical reports', async () => {
	const text = await source();
	const failure = stepBlock(text, 'Upload aggregation failure diagnostic');
	assert.match(failure, /if: failure\(\)/u);
	assert.match(failure, /if-no-files-found: ignore/u);
	assert.doesNotMatch(failure, /aggregation-report\.json|promotion-history-ledger\.json/u);
});
