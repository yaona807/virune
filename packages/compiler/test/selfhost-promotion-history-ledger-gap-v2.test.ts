import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPromotionHistoryLedgerV2,
	effectivePromotionHistoryRunsV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';

function ledger(attempt: PromotionHistoryAttemptInputV2) {
	return {
		version: 2 as const,
		stage: 'required-selfhost' as const,
		generation: 1,
		parentLedgerSha256: null,
		migration: promotionHistoryMigrationV2(),
		runs: [{
			runId: '100',
			sequenceAt: '2026-08-20T18:17:00.000Z',
			executionCommit: '1'.repeat(40),
			frozen: false,
			attempts: [attempt],
		}],
	};
}

function gap(conclusion: string, gapReason: PromotionHistoryAttemptInputV2['gapReason']): PromotionHistoryAttemptInputV2 {
	return {
		attempt: 1,
		startedAt: '2026-08-20T18:17:01.000Z',
		completedAt: '2026-08-20T18:30:00.000Z',
		conclusion,
		artifact: null,
		gapReason,
	};
}

test('successful workflow with missing observation artifact remains an explicit evidence gap', () => {
	const result = createPromotionHistoryLedgerV2(ledger(gap('success', 'observation-artifact-missing')));
	assert.deepEqual(effectivePromotionHistoryRunsV2(result.ledger), [{
		kind: 'gap',
		runId: '100',
		sequenceAt: '2026-08-20T18:17:00.000Z',
		frozen: false,
		reason: 'observation-artifact-missing',
	}]);
	assert.equal(result.ledger.runs[0]?.attempts[0]?.conclusion, 'success');
});

test('successful provider conclusion cannot be relabeled as workflow infrastructure failure', () => {
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(gap('success', 'workflow-infrastructure-failed'))),
		/successful workflow attempt may only become an evidence-layer gap/u,
	);
});
