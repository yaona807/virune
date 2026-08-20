import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const workflowUrl = new URL('../.github/workflows/repository-metadata-audit.yml', import.meta.url);

test('repository metadata audit runs only from read-only daily/manual workflow triggers', async () => {
	const source = await readFile(workflowUrl, 'utf8');
	assert.match(source, /^  schedule:\n    - cron: '[0-5]?\d (?:[01]?\d|2[0-3]) \* \* \*'$/mu);
	assert.match(source, /^  workflow_dispatch:$/mu);
	assert.doesNotMatch(source, /^  pull_request(?:_target)?:/mu);
	assert.match(source, /^permissions:\n  contents: read\n  issues: read\n  pull-requests: read$/mu);
	assert.doesNotMatch(source, /^  [a-z][a-z0-9-]*: write$/mu);
	assert.match(source, /^          persist-credentials: false$/mu);
	assert.match(source, /^          node-version: 24$/mu);
	assert.match(source, /^        run: node --test scripts\/audit-work-item-metadata\.test\.mjs scripts\/audit-work-item-metadata-adversarial\.test\.mjs scripts\/audit-work-item-metadata-policy\.test\.mjs scripts\/audit-work-item-metadata-taxonomy\.test\.mjs scripts\/audit-work-item-metadata-workflow\.test\.mjs$/mu);
	assert.match(source, /^        run: node scripts\/audit-work-item-metadata\.mjs --repository "\$\{\{ github\.repository \}\}"$/mu);
});
