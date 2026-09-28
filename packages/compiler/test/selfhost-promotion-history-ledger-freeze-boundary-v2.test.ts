import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPromotionHistoryLedgerV2,
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

test('a new freeze boundary cannot demote attempts already verified by an unfrozen parent', () => {
	const commitA = '1'.repeat(40);
	const parent = createPromotionHistoryLedgerV2({
		version: 2,
		stage: 'required-selfhost',
		generation: 1,
		parentLedgerSha256: null,
		migration: promotionHistoryMigrationV2(),
		runs: [{
			runId: '100',
			sequenceAt: '2026-08-01T18:47:00.000Z',
			executionCommit: commitA,
			freezeBoundary: null,
			promotionEffectiveAttemptCount: 1,
			attempts: [gapAttempt('2026-08-01T18:50:00.000Z', '2026-08-01T19:05:00.000Z')],
		}],
	});
	const child: PromotionHistoryLedgerInputV2 = {
		version: 2,
		stage: 'required-selfhost',
		generation: 2,
		parentLedgerSha256: parent.sha256,
		migration: promotionHistoryMigrationV2(),
		runs: [{
			...parent.ledger.runs[0]!,
			freezeBoundary: {
				runId: '200',
				sequenceAt: '2026-08-01T19:00:00.000Z',
				executionCommit: '2'.repeat(40),
			},
			promotionEffectiveAttemptCount: 0,
		}],
	};

	assert.throws(
		() => createPromotionHistoryLedgerV2(child, parent.ledger),
		/new freeze boundary cannot demote retained promotion-effective attempts/u,
	);
});
