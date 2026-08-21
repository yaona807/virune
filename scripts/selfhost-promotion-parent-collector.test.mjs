import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromotionParentCandidates } from './selfhost-promotion-parent-collector.mjs';

function inventory() {
	return [
		{
			runId: '900', runAttempt: 2, createdAt: '2026-08-20T19:00:00.000Z', status: 'completed', conclusion: 'success', executionCommit: '1'.repeat(40),
			attempts: [
				{ attempt: 1, conclusion: 'success' },
				{ attempt: 2, conclusion: 'success' },
			],
			artifacts: [
				{ id: 1, name: 'selfhost-promotion-history-report-900-1', expired: false, digest: `sha256:${'a'.repeat(64)}`, sizeInBytes: 1 },
				{ id: 2, name: 'selfhost-promotion-history-ledger-900-1', expired: false, digest: `sha256:${'b'.repeat(64)}`, sizeInBytes: 1 },
				{ id: 3, name: 'selfhost-promotion-history-report-900-2', expired: false, digest: `sha256:${'c'.repeat(64)}`, sizeInBytes: 1 },
			],
		},
		{
			runId: '901', runAttempt: 1, createdAt: '2026-08-20T20:00:00.000Z', status: 'completed', conclusion: 'failure', executionCommit: '2'.repeat(40),
			attempts: [{ attempt: 1, conclusion: 'failure' }], artifacts: [],
		},
	];
}

test('collects successful attempt artifacts newest-first and ignores failed partial evidence', async () => {
	const downloaded = [];
	const reader = {
		async downloadCanonicalJsonArtifact({ artifact, expectedFileName }) {
			downloaded.push([artifact.id, expectedFileName]);
			return { value: { artifact: artifact.id } };
		},
	};
	const candidates = await createPromotionParentCandidates({ reader, inventory: inventory(), currentAggregationRunId: '999', currentAggregationAttempt: 1 });
	assert.deepEqual(candidates.map(item => `${item.runId}/${item.attempt}`), ['901/1', '900/2', '900/1']);
	assert.equal(candidates[0].report, null);
	assert.equal(candidates[0].ledger, null);
	assert.deepEqual(candidates[1].report, { artifact: 3 });
	assert.equal(candidates[1].ledger, null);
	assert.deepEqual(candidates[2].report, { artifact: 1 });
	assert.deepEqual(candidates[2].ledger, { artifact: 2 });
	assert.deepEqual(downloaded, [
		[1, 'aggregation-report.json'], [2, 'promotion-history-ledger.json'], [3, 'aggregation-report.json'],
	]);
});

test('current aggregation attempt is excluded but an earlier attempt of the same run remains a parent candidate', async () => {
	const candidates = await createPromotionParentCandidates({
		reader: { async downloadCanonicalJsonArtifact({ artifact }) { return { value: { artifact: artifact.id } }; } },
		inventory: [inventory()[0]],
		currentAggregationRunId: '900',
		currentAggregationAttempt: 2,
	});
	assert.deepEqual(candidates.map(item => `${item.runId}/${item.attempt}`), ['900/1']);
	assert.deepEqual(candidates[0].report, { artifact: 1 });
	assert.deepEqual(candidates[0].ledger, { artifact: 2 });
});

test('current aggregation attempt one excludes the whole current run from parent candidates', async () => {
	const candidates = await createPromotionParentCandidates({
		reader: { async downloadCanonicalJsonArtifact() { throw new Error('must not download current run'); } },
		inventory: [inventory()[0]],
		currentAggregationRunId: '900',
		currentAggregationAttempt: 1,
	});
	assert.deepEqual(candidates, []);
});

test('expired report remains explicitly unavailable for fail-closed parent discovery', async () => {
	const value = inventory()[0];
	value.artifacts[0] = { ...value.artifacts[0], expired: true };
	const candidates = await createPromotionParentCandidates({
		reader: { async downloadCanonicalJsonArtifact({ artifact }) { return { value: { artifact: artifact.id } }; } },
		inventory: [value],
		currentAggregationRunId: '999',
		currentAggregationAttempt: 1,
	});
	const attempt1 = candidates.find(item => item.attempt === 1);
	assert.equal(attempt1.report, null);
	assert.deepEqual(attempt1.ledger, { artifact: 2 });
});
