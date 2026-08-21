import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromotionShadowHistoryV2 } from '../src/selfhost/promotion-shadow-history-v2.js';
import {
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryRunInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';
import { projectPromotionHistoryLedgerV2 } from '../src/selfhost/promotion-history-ledger-projection-v2.js';
import type { PromotionShadowHistoryEntryInputV2 } from '../src/selfhost/promotion-shadow-history-v2.js';

const subjectA = 'a'.repeat(64);
const digest = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

function observation(
	runId: string,
	executionCommit: string,
	completedAt: string,
	outcome: 'passed' | 'product-failed' = 'passed',
): PromotionShadowHistoryEntryInputV2 {
	return {
		version: 2,
		runId,
		stage: 'required-selfhost',
		executionCommit,
		promotionSubjectId: subjectA,
		completedAt,
		outcome,
		countsTowardPromotion: true,
		unexplainedDifferentials: outcome === 'product-failed' ? 1 : 0,
		evidence: [{ id: 'clean-bootstrap', status: 'passed', sha256: digest('e') }],
	};
}

function observationAttempt(
	runId: string,
	executionCommit: string,
	artifactCompletedAt: string,
	outcome: 'passed' | 'product-failed' = 'passed',
): PromotionHistoryAttemptInputV2 {
	return {
		attempt: 1,
		startedAt: artifactCompletedAt.replace(':20:', ':00:'),
		completedAt: artifactCompletedAt,
		conclusion: outcome === 'passed' ? 'success' : 'failure',
		artifact: {
			archiveSha256: digest(runId.endsWith('0') ? '1' : runId.endsWith('1') ? '2' : '3'),
			bytesSha256: digest(runId.endsWith('0') ? '4' : runId.endsWith('1') ? '5' : '6'),
			observation: observation(runId, executionCommit, artifactCompletedAt, outcome),
		},
		gapReason: null,
	};
}

function gapAttempt(completedAt: string, reason: 'workflow-infrastructure-failed' | 'workflow-cancelled' = 'workflow-infrastructure-failed'): PromotionHistoryAttemptInputV2 {
	return {
		attempt: 1,
		startedAt: completedAt.replace(':20:', ':00:'),
		completedAt,
		conclusion: reason === 'workflow-cancelled' ? 'cancelled' : 'failure',
		artifact: null,
		gapReason: reason,
	};
}

function ledger(runs: readonly PromotionHistoryRunInputV2[]) {
	return {
		version: 2 as const,
		stage: 'required-selfhost' as const,
		generation: 1,
		parentLedgerSha256: null,
		migration: promotionHistoryMigrationV2(),
		runs,
	};
}

test('projection uses GitHub sequence time while preserving artifact provenance in the ledger', () => {
	const run: PromotionHistoryRunInputV2 = {
		runId: '100',
		sequenceAt: '2026-08-20T00:59:00.000Z',
		executionCommit: commit('1'),
		frozen: false,
		attempts: [observationAttempt('100', commit('1'), '2026-08-20T01:20:00.000Z')],
	};
	const projection = projectPromotionHistoryLedgerV2(ledger([run]));
	assert.equal(projection.currentProductKnown, true);
	assert.equal(projection.historyInput.entries[0]?.completedAt, '2026-08-20T00:59:00.000Z');
	assert.equal(run.attempts[0]?.artifact?.observation.completedAt, '2026-08-20T01:20:00.000Z');
});

test('an explicit gap becomes a counting synthetic-subject streak break with exact execution provenance', () => {
	const projection = projectPromotionHistoryLedgerV2(ledger([{
		runId: '100',
		sequenceAt: '2026-08-20T01:00:00.000Z',
		executionCommit: commit('1'),
		frozen: false,
		attempts: [gapAttempt('2026-08-20T01:20:00.000Z')],
	}]));
	const entry = projection.historyInput.entries[0]!;
	assert.equal(projection.currentProductKnown, false);
	assert.equal(entry.executionCommit, commit('1'));
	assert.equal(entry.outcome, 'infrastructure-failed');
	assert.equal(entry.countsTowardPromotion, true);
	assert.equal(entry.completedAt, '2026-08-20T01:00:00.000Z');
	assert.equal(entry.evidence[0]?.id, 'promotion-history-ledger-gap');
	assert.equal(entry.evidence[0]?.status, 'failed');
	assert.match(entry.promotionSubjectId, /^[0-9a-f]{64}$/u);
});

test('A success, gap, A success cannot reconnect the pre-gap streak', () => {
	const runs: PromotionHistoryRunInputV2[] = [
		{
			runId: '100', sequenceAt: '2026-08-18T01:00:00.000Z', executionCommit: commit('1'), frozen: true,
			attempts: [observationAttempt('100', commit('1'), '2026-08-18T01:20:00.000Z')],
		},
		{
			runId: '101', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('2'), frozen: true,
			attempts: [gapAttempt('2026-08-19T01:20:00.000Z')],
		},
		{
			runId: '102', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('3'), frozen: false,
			attempts: [observationAttempt('102', commit('3'), '2026-08-20T01:20:00.000Z')],
		},
	];
	const projection = projectPromotionHistoryLedgerV2(ledger(runs));
	const history = createPromotionShadowHistoryV2(projection.historyInput).history;
	assert.equal(history.promotionSubjectId, subjectA);
	assert.equal(history.successfulRuns, 1);
	assert.equal(history.observationDays, 1);
});

test('a product failure before a gap still invalidates the same product when it reappears', () => {
	const runs: PromotionHistoryRunInputV2[] = [
		{
			runId: '100', sequenceAt: '2026-08-18T01:00:00.000Z', executionCommit: commit('1'), frozen: true,
			attempts: [observationAttempt('100', commit('1'), '2026-08-18T01:20:00.000Z', 'product-failed')],
		},
		{
			runId: '101', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('2'), frozen: true,
			attempts: [gapAttempt('2026-08-19T01:20:00.000Z')],
		},
		{
			runId: '102', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('3'), frozen: false,
			attempts: [observationAttempt('102', commit('3'), '2026-08-20T01:20:00.000Z')],
		},
	];
	const projection = projectPromotionHistoryLedgerV2(ledger(runs));
	const history = createPromotionShadowHistoryV2(projection.historyInput).history;
	assert.equal(history.promotionSubjectId, subjectA);
	assert.equal(history.productInvalidated, true);
	assert.equal(history.successfulRuns, 0);
});

test('cancelled gap projects as cancellation and distinct gaps get distinct synthetic subjects', () => {
	const runs: PromotionHistoryRunInputV2[] = [
		{
			runId: '100', sequenceAt: '2026-08-19T01:00:00.000Z', executionCommit: commit('1'), frozen: true,
			attempts: [gapAttempt('2026-08-19T01:20:00.000Z', 'workflow-cancelled')],
		},
		{
			runId: '101', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit('2'), frozen: false,
			attempts: [gapAttempt('2026-08-20T01:20:00.000Z')],
		},
	];
	const projection = projectPromotionHistoryLedgerV2(ledger(runs));
	assert.equal(projection.historyInput.entries[0]?.outcome, 'cancelled');
	assert.notEqual(
		projection.historyInput.entries[0]?.promotionSubjectId,
		projection.historyInput.entries[1]?.promotionSubjectId,
	);
});

test('empty ledger cannot be projected into a false history', () => {
	assert.throws(() => projectPromotionHistoryLedgerV2(ledger([])), /has no formal runs to project/u);
});
