import assert from 'node:assert/strict';
import test from 'node:test';
import {
	parsePromotionHistoryLedgerV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryLedgerInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';

function gapAttempt(startedAt: string, completedAt: string): PromotionHistoryAttemptInputV2 {
	return {
		attempt: 1,
		startedAt,
		completedAt,
		providerConclusion: 'failure',
		artifactState: 'missing',
		artifact: null,
	};
}

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
			attempts: [gapAttempt('2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z')],
		}],
	};

	assert.throws(
		() => parsePromotionHistoryLedgerV2(value),
		/freeze boundary must identify a new logical run/u,
	);
});

test('a later run cannot freeze against an earlier retained logical run ID', () => {
	const commitA = '1'.repeat(40);
	const commitB = '2'.repeat(40);
	const value: PromotionHistoryLedgerInputV2 = {
		version: 2,
		stage: 'required-selfhost',
		generation: 1,
		parentLedgerSha256: null,
		migration: promotionHistoryMigrationV2(),
		runs: [
			{
				runId: '100',
				sequenceAt: '2026-08-01T18:47:00.000Z',
				executionCommit: commitA,
				freezeBoundary: {
					runId: '200',
					sequenceAt: '2026-08-02T18:47:00.000Z',
					executionCommit: commitB,
				},
				promotionEffectiveAttemptCount: 1,
				attempts: [gapAttempt('2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z')],
			},
			{
				runId: '200',
				sequenceAt: '2026-08-02T18:47:00.000Z',
				executionCommit: commitB,
				freezeBoundary: {
					runId: '100',
					sequenceAt: '2026-08-03T18:47:00.000Z',
					executionCommit: commitA,
				},
				promotionEffectiveAttemptCount: 1,
				attempts: [gapAttempt('2026-08-02T18:47:01.000Z', '2026-08-02T18:50:00.000Z')],
			},
		],
	};

	assert.throws(
		() => parsePromotionHistoryLedgerV2(value),
		/freeze boundary must identify a new logical run/u,
	);
});
