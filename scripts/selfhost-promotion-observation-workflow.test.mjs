import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowPath = new URL('../.github/workflows/selfhost-promotion-observation.yml', import.meta.url);
const source = await readFile(workflowPath, 'utf8');

function jobBlock(jobId, nextJobId) {
	const marker = `\n  ${jobId}:\n`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `workflow job ${jobId} must exist`);
	const nextMarker = `\n  ${nextJobId}:\n`;
	const end = source.indexOf(nextMarker, start + marker.length);
	assert.notEqual(end, -1, `workflow job ${nextJobId} must follow ${jobId}`);
	return source.slice(start, end);
}

test('formal observation workflow has one daily schedule plus diagnostic manual dispatch only', () => {
	assert.match(source, /^name: Self-host promotion observation$/mu);
	const triggerStart = source.indexOf('on:\n');
	const permissionsStart = source.indexOf('\npermissions:');
	assert.notEqual(triggerStart, -1, 'workflow trigger block must exist');
	assert.ok(permissionsStart > triggerStart, 'workflow permissions must follow the trigger block');
	assert.equal(
		source.slice(triggerStart, permissionsStart),
		"on:\n  schedule:\n    - cron: '47 18 * * *'\n  workflow_dispatch:\n",
		'formal observation clock must contain exactly one daily schedule and diagnostic manual dispatch',
	);
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

test('workflow keeps only read permissions and every checkout pins the exact execution commit without credentials', () => {
	assert.match(source, /permissions:\n  contents: read/u);
	assert.doesNotMatch(source, /contents: write/u);
	assert.doesNotMatch(source, /actions: write/u);
	const checkoutUses = source.match(/      - uses: actions\/checkout@/gu) ?? [];
	const exactCheckoutBlocks = source.match(/      - uses: actions\/checkout@[^\n]+\n        with:\n          ref: \$\{\{ github\.sha \}\}\n          persist-credentials: false/gu) ?? [];
	assert.ok(checkoutUses.length > 0, 'workflow must contain at least one checkout');
	assert.equal(exactCheckoutBlocks.length, checkoutUses.length, 'every checkout must pin github.sha and disable persisted credentials');
});

test('every Promotion Observation artifact reference is isolated by run ID and rerun attempt', () => {
	const names = [...source.matchAll(/^\s+name: (selfhost-promotion-[^\n]+)$/gmu)].map(match => match[1]);
	assert.ok(names.length > 0, 'workflow must contain Promotion Observation artifact names');
	for (const name of names) {
		assert.match(name, /\$\{\{ github\.run_id \}\}/u, `${name} must include github.run_id`);
		assert.match(name, /\$\{\{ github\.run_attempt \}\}/u, `${name} must include github.run_attempt`);
	}
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

test('failed quality and performance jobs retain their canonical evidence artifacts for assembly', () => {
	const quality = jobBlock('quality', 'performance');
	assert.match(quality, /- name: Upload quality evidence\n\s+if: always\(\)\n/u);
	assert.match(quality, /name: selfhost-promotion-quality-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(quality, /if-no-files-found: error/u);

	const performance = jobBlock('performance', 'subject');
	assert.match(performance, /- name: Upload performance evidence\n\s+if: always\(\)\n/u);
	assert.match(performance, /name: selfhost-promotion-performance-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(performance, /if-no-files-found: error/u);
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
