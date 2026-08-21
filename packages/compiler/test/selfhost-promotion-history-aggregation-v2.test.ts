import assert from 'node:assert/strict';
import test from 'node:test';
import {
	aggregatePromotionHistoryV2,
	type PromotionAggregationRunSnapshotV2,
} from '../src/selfhost/promotion-history-aggregation-v2.js';
import {
	createPromotionHistoryLedgerV2,
	effectivePromotionHistoryRunsV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryRunInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';
import type { PromotionShadowHistoryEntryInputV2 } from '../src/selfhost/promotion-shadow-history-v2.js';

const subject = 'a'.repeat(64);
const commit = (character: string): string => character.repeat(40);
const digest = (character: string): string => character.repeat(64);

function observation(runId: string, executionCommit: string, outcome: 'passed' | 'product-failed' = 'passed'): PromotionShadowHistoryEntryInputV2 {
	return {
		version: 2,
		runId,
		stage: 'required-selfhost',
		executionCommit,
		promotionSubjectId: subject,
		completedAt: '2026-08-20T01:20:00.000Z',
		outcome,
		countsTowardPromotion: true,
		unexplainedDifferentials: outcome === 'product-failed' ? 1 : 0,
		evidence: [{ id: 'clean-bootstrap', status: 'passed', sha256: digest('e') }],
	};
}

function attempt(runId: string, executionCommit: string, attemptNumber = 1, startHour = 1): PromotionHistoryAttemptInputV2 {
	return {
		attempt: attemptNumber,
		startedAt: `2026-08-20T${String(startHour).padStart(2, '0')}:00:00.000Z`,
		completedAt: `2026-08-20T${String(startHour).padStart(2, '0')}:20:00.000Z`,
		conclusion: 'success',
		artifact: {
			archiveSha256: digest(String(attemptNumber)),
			bytesSha256: digest(String(attemptNumber + 1)),
			observation: observation(runId, executionCommit),
		},
		gapReason: null,
	};
}

function productFailureAttempt(runId: string, executionCommit: string, attemptNumber = 2, startHour = 2): PromotionHistoryAttemptInputV2 {
	return {
		attempt: attemptNumber,
		startedAt: `2026-08-20T${String(startHour).padStart(2, '0')}:00:00.000Z`,
		completedAt: `2026-08-20T${String(startHour).padStart(2, '0')}:20:00.000Z`,
		conclusion: 'failure',
		artifact: {
			archiveSha256: digest('f'),
			bytesSha256: digest('d'),
			observation: observation(runId, executionCommit, 'product-failed'),
		},
		gapReason: null,
	};
}

function gapAttempt(attemptNumber = 1, startHour = 1): PromotionHistoryAttemptInputV2 {
	return {
		attempt: attemptNumber,
		startedAt: `2026-08-20T${String(startHour).padStart(2, '0')}:00:00.000Z`,
		completedAt: `2026-08-20T${String(startHour).padStart(2, '0')}:20:00.000Z`,
		conclusion: 'failure',
		artifact: null,
		gapReason: 'workflow-infrastructure-failed',
	};
}

function snapshot(options: {
	readonly runId: string;
	readonly sequenceAt: string;
	readonly executionCommit: string;
	readonly status?: 'completed' | 'in-progress' | 'queued';
	readonly runAttempt?: number;
	readonly attempts?: readonly PromotionHistoryAttemptInputV2[];
}): PromotionAggregationRunSnapshotV2 {
	return {
		runId: options.runId,
		sequenceAt: options.sequenceAt,
		executionCommit: options.executionCommit,
		status: options.status ?? 'completed',
		runAttempt: options.runAttempt ?? options.attempts?.length ?? 1,
		attempts: options.attempts ?? [attempt(options.runId, options.executionCommit)],
	};
}

function parentLedger(runs: readonly PromotionHistoryRunInputV2[]) {
	return createPromotionHistoryLedgerV2({
		version: 2,
		stage: 'required-selfhost',
		generation: 1,
		parentLedgerSha256: null,
		migration: promotionHistoryMigrationV2(),
		runs,
	}).ledger;
}

test('completed genesis run publishes a deterministic generation 1 ledger', () => {
	const run = snapshot({ runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('1') });
	const first = aggregatePromotionHistoryV2({ stage: 'required-selfhost', runs: [run] });
	const second = aggregatePromotionHistoryV2({ stage: 'required-selfhost', runs: [run] });
	assert.equal(first.publish, true);
	assert.equal(first.ledger?.ledger.generation, 1);
	assert.equal(first.ledger?.serialized, second.ledger?.serialized);
});

test('first in-progress run produces no genesis ledger', () => {
	const result = aggregatePromotionHistoryV2({
		stage: 'required-selfhost',
		runs: [snapshot({
			runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('1'), status: 'in-progress', runAttempt: 1, attempts: [],
		})],
	});
	assert.equal(result.publish, false);
	assert.equal(result.ledger, null);
	assert.equal(result.blockedByRunId, '100');
});

test('a later in-progress formal run freezes the retained mutable tail without appending the in-progress run', () => {
	const parent = parentLedger([{
		runId: '100', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('1'), frozen: false,
		attempts: [attempt('100', commit('1'))],
	}]);
	const result = aggregatePromotionHistoryV2({
		stage: 'required-selfhost',
		parent,
		runs: [snapshot({
			runId: '101', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('2'), status: 'in-progress', runAttempt: 1, attempts: [],
		})],
	});
	assert.equal(result.publish, true);
	assert.equal(result.ledger?.ledger.runs.length, 1);
	assert.equal(result.ledger?.ledger.runs[0]?.frozen, true);
	assert.equal(result.blockedByRunId, '101');
});

test('complete prefix stops at first in-progress run even when later snapshots are present', () => {
	const result = aggregatePromotionHistoryV2({
		stage: 'required-selfhost',
		runs: [
			snapshot({ runId: '100', sequenceAt: '2026-08-18T01:00:00.000Z', executionCommit: commit('1') }),
			snapshot({ runId: '101', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('2'), status: 'in-progress', attempts: [], runAttempt: 1 }),
			snapshot({ runId: '102', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('3') }),
		],
	});
	assert.deepEqual(result.processedRunIds, ['100']);
	assert.equal(result.blockedByRunId, '101');
	assert.deepEqual(result.ledger?.ledger.runs.map(run => run.runId), ['100']);
	assert.equal(result.ledger?.ledger.runs[0]?.frozen, true);
});

test('completed provider run must expose every attempt from 1 through runAttempt', () => {
	assert.throws(() => aggregatePromotionHistoryV2({
		stage: 'required-selfhost',
		runs: [snapshot({
			runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('1'), runAttempt: 2,
			attempts: [attempt('100', commit('1'), 1)],
		})],
	}), /attempt metadata is incomplete/u);
});

test('mutable retained tail may recover through a complete rerun before a later formal run exists', () => {
	const firstAttempt = gapAttempt();
	const parent = parentLedger([{
		runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('1'), frozen: false, attempts: [firstAttempt],
	}]);
	const secondAttempt = attempt('100', commit('1'), 2, 2);
	const result = aggregatePromotionHistoryV2({
		stage: 'required-selfhost',
		parent,
		runs: [snapshot({
			runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('1'), runAttempt: 2,
			attempts: [firstAttempt, secondAttempt],
		})],
	});
	assert.equal(result.publish, true);
	assert.equal(result.ledger?.ledger.runs[0]?.attempts.length, 2);
	assert.equal(result.ledger?.ledger.runs[0]?.promotionEffectiveAttemptCount, 2);
	assert.equal(result.ledger?.ledger.runs[0]?.frozen, false);
});

test('rerun that starts before but completes after the next formal run is audit-only', () => {
	const firstAttempt = attempt('100', commit('1'), 1, 1);
	const parent = parentLedger([{
		runId: '100', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('1'), frozen: false,
		attempts: [firstAttempt],
	}]);
	const lateAttempt: PromotionHistoryAttemptInputV2 = {
		...productFailureAttempt('100', commit('1'), 2, 1),
		startedAt: '2026-08-20T01:50:00.000Z',
		completedAt: '2026-08-20T02:10:00.000Z',
	};
	const result = aggregatePromotionHistoryV2({
		stage: 'required-selfhost',
		parent,
		runs: [
			snapshot({
				runId: '100', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('1'), runAttempt: 2,
				attempts: [firstAttempt, lateAttempt],
			}),
			snapshot({
				runId: '101', sequenceAt: '2026-08-20T02:00:00.000Z', executionCommit: commit('2'), status: 'in-progress', runAttempt: 1, attempts: [],
			}),
		],
	});
	assert.equal(result.publish, true);
	const retained = result.ledger?.ledger.runs[0];
	assert.equal(retained?.attempts.length, 2);
	assert.equal(retained?.promotionEffectiveAttemptCount, 1);
	assert.equal(retained?.frozen, true);
	const effective = effectivePromotionHistoryRunsV2(result.ledger!.ledger)[0];
	assert.equal(effective?.kind === 'observation' ? effective.observation.outcome : null, 'passed');
	assert.deepEqual(result.lateAttempts.map(item => [item.runId, item.attempt, item.reason]), [
		['100', 2, 'completed-at-or-after-next-formal-run'],
	]);
});

test('already frozen retained run appends later attempts only to the audit suffix', () => {
	const firstAttempt = attempt('100', commit('1'), 1, 1);
	const parent = parentLedger([{
		runId: '100', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('1'), frozen: true,
		promotionEffectiveAttemptCount: 1,
		attempts: [firstAttempt],
	}]);
	const lateAttempt = productFailureAttempt('100', commit('1'), 2, 2);
	const result = aggregatePromotionHistoryV2({
		stage: 'required-selfhost',
		parent,
		runs: [snapshot({
			runId: '100', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('1'), runAttempt: 2,
			attempts: [firstAttempt, lateAttempt],
		})],
	});
	assert.equal(result.publish, true);
	const retained = result.ledger?.ledger.runs[0];
	assert.equal(retained?.attempts.length, 2);
	assert.equal(retained?.promotionEffectiveAttemptCount, 1);
	assert.equal(retained?.frozen, true);
	const effective = effectivePromotionHistoryRunsV2(result.ledger!.ledger)[0];
	assert.equal(effective?.kind === 'observation' ? effective.observation.outcome : null, 'passed');
	assert.equal(result.lateAttempts[0]?.reason, 'run-already-frozen');
});

test('provider cannot rewrite a retained attempt or run identity', () => {
	const firstAttempt = gapAttempt();
	const parent = parentLedger([{
		runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('1'), frozen: false, attempts: [firstAttempt],
	}]);
	assert.throws(() => aggregatePromotionHistoryV2({
		stage: 'required-selfhost', parent,
		runs: [snapshot({
			runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('1'),
			attempts: [{ ...firstAttempt, conclusion: 'cancelled' }],
		})],
	}), /disagrees with retained ledger attempt/u);
	assert.throws(() => aggregatePromotionHistoryV2({
		stage: 'required-selfhost', parent,
		runs: [snapshot({ runId: '100', sequenceAt: '2026-08-20T01:00:01.000Z', executionCommit: commit('1'), attempts: [firstAttempt] })],
	}), /run identity disagrees/u);
});
