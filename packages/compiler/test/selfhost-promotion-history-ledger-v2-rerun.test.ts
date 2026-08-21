import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPromotionHistoryLedgerV2,
	effectivePromotionHistoryRunsV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';
import type { PromotionShadowHistoryEntryInputV2 } from '../src/selfhost/promotion-shadow-history-v2.js';

const executionCommit = '1'.repeat(40);
const subject = 'a'.repeat(64);

function observation(outcome: 'passed' | 'product-failed'): PromotionShadowHistoryEntryInputV2 {
	return {
		version: 2,
		runId: '100',
		stage: 'required-selfhost',
		executionCommit,
		promotionSubjectId: subject,
		completedAt: '2026-08-20T01:20:00.000Z',
		outcome,
		countsTowardPromotion: true,
		unexplainedDifferentials: outcome === 'product-failed' ? 1 : 0,
		evidence: [{ id: 'clean-bootstrap', status: 'passed', sha256: 'e'.repeat(64) }],
	};
}

function artifactAttempt(attempt: number, outcome: 'passed' | 'product-failed'): PromotionHistoryAttemptInputV2 {
	return {
		attempt,
		startedAt: `2026-08-20T0${attempt}:00:00.000Z`,
		completedAt: `2026-08-20T0${attempt}:20:00.000Z`,
		conclusion: outcome === 'passed' ? 'success' : 'failure',
		artifact: {
			archiveSha256: String(attempt).repeat(64),
			bytesSha256: String(attempt + 1).repeat(64),
			observation: observation(outcome),
		},
		gapReason: null,
	};
}

function gapAttempt(
	attempt: number,
	reason: 'workflow-infrastructure-failed' | 'workflow-cancelled' | 'observation-artifact-missing' | 'observation-artifact-invalid' = 'workflow-infrastructure-failed',
): PromotionHistoryAttemptInputV2 {
	return {
		attempt,
		startedAt: `2026-08-20T0${attempt}:00:00.000Z`,
		completedAt: `2026-08-20T0${attempt}:20:00.000Z`,
		conclusion: reason === 'workflow-cancelled' ? 'cancelled' : 'failure',
		artifact: null,
		gapReason: reason,
	};
}

function ledger(attempts: readonly PromotionHistoryAttemptInputV2[], generation = 1, parentLedgerSha256: string | null = null) {
	return {
		version: 2 as const,
		stage: 'required-selfhost' as const,
		generation,
		parentLedgerSha256,
		migration: promotionHistoryMigrationV2(),
		runs: [{
			runId: '100',
			sequenceAt: '2026-08-20T01:00:00.000Z',
			executionCommit,
			frozen: false,
			attempts,
		}],
	};
}

test('latest infrastructure-failed rerun replaces an older successful attempt', () => {
	const result = createPromotionHistoryLedgerV2(ledger([artifactAttempt(1, 'passed'), gapAttempt(2)]));
	assert.deepEqual(effectivePromotionHistoryRunsV2(result.ledger), [{
		kind: 'gap',
		runId: '100',
		sequenceAt: '2026-08-20T01:00:00.000Z',
		frozen: false,
		reason: 'workflow-infrastructure-failed',
	}]);
});

test('a later successful rerun can recover confirmed infrastructure failure before freeze', () => {
	const result = createPromotionHistoryLedgerV2(ledger([gapAttempt(1), artifactAttempt(2, 'passed')]));
	const effective = effectivePromotionHistoryRunsV2(result.ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'passed');
});

test('a later successful rerun can recover cancellation before freeze', () => {
	const result = createPromotionHistoryLedgerV2(ledger([gapAttempt(1, 'workflow-cancelled'), artifactAttempt(2, 'passed')]));
	const effective = effectivePromotionHistoryRunsV2(result.ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'passed');
});

test('missing or invalid evidence remains an unknown gap even when a later rerun passes', () => {
	for (const reason of ['observation-artifact-missing', 'observation-artifact-invalid'] as const) {
		const result = createPromotionHistoryLedgerV2(ledger([gapAttempt(1, reason), artifactAttempt(2, 'passed')]));
		assert.deepEqual(effectivePromotionHistoryRunsV2(result.ledger), [{
			kind: 'gap',
			runId: '100',
			sequenceAt: '2026-08-20T01:00:00.000Z',
			frozen: false,
			reason,
		}]);
	}
});

test('lineage cannot heal a retained unknown evidence gap with a later successful rerun', () => {
	const first = gapAttempt(1, 'observation-artifact-missing');
	const parent = createPromotionHistoryLedgerV2(ledger([first]));
	const child = ledger([first, artifactAttempt(2, 'passed')], 2, parent.sha256);
	assert.throws(
		() => createPromotionHistoryLedgerV2(child, parent.ledger),
		/unresolved evidence gap cannot be healed by rerun/u,
	);
});

test('lineage may strengthen a retained unknown gap to a confirmed product failure', () => {
	const first = gapAttempt(1, 'observation-artifact-missing');
	const parent = createPromotionHistoryLedgerV2(ledger([first]));
	const child = ledger([first, artifactAttempt(2, 'product-failed')], 2, parent.sha256);
	const result = createPromotionHistoryLedgerV2(child, parent.ledger);
	const effective = effectivePromotionHistoryRunsV2(result.ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'product-failed');
});

test('product failure remains effective even when the latest attempt passes', () => {
	const result = createPromotionHistoryLedgerV2(ledger([artifactAttempt(1, 'product-failed'), artifactAttempt(2, 'passed')]));
	const effective = effectivePromotionHistoryRunsV2(result.ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'product-failed');
});
