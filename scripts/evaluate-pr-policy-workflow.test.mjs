import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflowUrl = new URL('../.github/workflows/trusted-pr-policy.yml', import.meta.url);

test('trusted PR policy workflow never executes PR-head code and publishes only exact-head status', async () => {
	const source = await readFile(workflowUrl, 'utf8');
	assert.match(source, /^  pull_request_target:$/mu);
	assert.doesNotMatch(source, /^  pull_request:$/mu);
	assert.match(source, /^permissions:\n  contents: read\n  issues: read\n  pull-requests: read\n  statuses: write$/mu);
	assert.match(source, /^          ref: \$\{\{ github\.event\.repository\.default_branch \}\}$/mu);
	assert.match(source, /^          persist-credentials: false$/mu);
	assert.match(source, /^          node-version: 24$/mu);
	assert.match(source, /^        run: node scripts\/evaluate-pr-policy\.mjs$/mu);
	assert.doesNotMatch(source, /github\.event\.pull_request\.(?:body|title|head\.ref|head\.label)/u);
	assert.doesNotMatch(source, /secrets\./u);
	assert.doesNotMatch(source, /npm (?:ci|install)|yarn|pnpm|bun|git checkout .*head|refs\/pull/u);
	assert.doesNotMatch(source, /^    permissions:/mu);
});
