import assert from 'node:assert/strict';
import test from 'node:test';
import {
	parsePromotionHistoryLedgerV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryLedgerInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';

test('a rerun cannot freeze its own logical run by moving the boundary timestamp forward', () => {
	const runId = '100';
	const executionCommit = '1'.repeat(40);
	const value: PromotionHistoryLedgerInputV2 = {
		version: 2,
		stage: 'required-selfhost',
		generation: 1,
		parentLedgerSha256: null,
		migration: promotionHistoryMigrationV2(),
		runs: [{
			runId,
			sequenceAt: '2026-08-01T18:47:00.000Z',
			executionCommit,
			freezeBoundary: {
				runId,
				sequenceAt: '2026-08-02T18:47:00.000Z',
				executionCommit,
			},
			promotionEffectiveAttemptCount: 1,
			attempts: [{
				attempt: 1,
				startedAt: '2026-08-01T18:47:01.000Z',
				completedAt: '2026-08-01T18:50:00.000Z',
				providerConclusion: 'failure',
				artifactState: 'missing',
				artifact: null,
			}],
		}],
	};

	assert.throws(
		() => parsePromotionHistoryLedgerV2(value),
		/freeze boundary must identify a different logical run/u,
	);
});
