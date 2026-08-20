import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../.github/workflows/selfhost-promotion-observation.yml', import.meta.url);
const source = await readFile(workflowPath, 'utf8');

test('formal observation workflow has one daily schedule plus diagnostic manual dispatch only', () => {
	assert.match(source, /^name: Self-host promotion observation$/mu);
	assert.match(source, /schedule:\n\s+- cron: '47 18 \* \* \*'/u);
	assert.match(source, /workflow_dispatch:/u);
	assert.doesNotMatch(source, /\n\s+push:/u);
	assert.doesNotMatch(source, /\n\s+pull_request:/u);
});

test('each logical observation run has an independent non-cancelling concurrency group', () => {
	assert.match(source, /group: selfhost-promotion-observation-\$\{\{ github\.run_id \}\}/u);
	assert.doesNotMatch(source, /group: selfhost-promotion-observation-formal/u);
	assert.match(source, /cancel-in-progress: false/u);
});

test('baseline and perturbed clean bootstrap execute in independent jobs', () => {
	assert.match(source, /\n  baseline:\n/u);
	assert.match(source, /--environment-profile=baseline/u);
	assert.match(source, /\n  perturbed:\n/u);
	assert.match(source, /--environment-profile=perturbed/u);
	assert.match(source, /needs: \[baseline, perturbed\]/u);
});

test('workflow keeps only read permissions and checks out the exact execution commit', () => {
	assert.match(source, /permissions:\n  contents: read/u);
	assert.doesNotMatch(source, /contents: write/u);
	assert.doesNotMatch(source, /actions: write/u);
	assert.match(source, /ref: \$\{\{ github\.sha \}\}/u);
	assert.match(source, /persist-credentials: false/u);
});

test('browser quality evidence installs and exercises the same three managed engines as formal browser conformance', () => {
	assert.match(source, /npx playwright install --with-deps chromium firefox webkit/u);
	assert.match(source, /node scripts\/run-selfhost-promotion-quality\.mjs/u);
});

test('known quality or performance failure can still assemble a product-failed observation', () => {
	assert.match(source, /\(needs\.quality\.result == 'success' \|\| needs\.quality\.result == 'failure'\)/u);
	assert.match(source, /\(needs\.performance\.result == 'success' \|\| needs\.performance\.result == 'failure'\)/u);
	assert.match(source, /assemble-selfhost-promotion-observation\.mjs/u);
});

test('assembler receives canonical workflow ref and fork metadata for trusted-source classification', () => {
	assert.match(source, /SOURCE_WORKFLOW_REF: \$\{\{ github\.workflow_ref \}\}/u);
	assert.match(source, /SOURCE_FORK: \$\{\{ github\.event\.repository\.fork \}\}/u);
	assert.match(source, /--source-workflow-ref="\$SOURCE_WORKFLOW_REF"/u);
	assert.match(source, /--source-fork="\$SOURCE_FORK"/u);
	assert.doesNotMatch(source, /SOURCE_WORKFLOW: \$\{\{ github\.workflow \}\}/u);
});

test('canonical observation artifact matches the Promotion History collector contract exactly', () => {
	assert.match(source, /name: selfhost-promotion-observation-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(source, /path: \.cache\/selfhost-promotion-observation\/observation\.json/u);
	assert.match(source, /if-no-files-found: error/u);
});

test('product identity is derived from built artifacts and release-core evidence before assembly', () => {
	assert.match(source, /npm run build/u);
	assert.match(source, /create-selfhost-promotion-subject\.mjs/u);
	assert.match(source, /selfhost-promotion-release-core-/u);
	assert.match(source, /selfhost-promotion-subject-/u);
});
