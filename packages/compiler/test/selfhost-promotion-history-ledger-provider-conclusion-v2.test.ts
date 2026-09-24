import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	effectivePromotionHistoryRunsV2,
	parsePromotionHistoryLedgerV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryLedgerInputV2,
	type PromotionHistoryProviderConclusionV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';

const runId = '100';
const executionCommit = '1'.repeat(40);
const promotionSubjectId = 'a'.repeat(64);
const evidenceSha256 = 'c'.repeat(64);
const archiveSha256 = 'd'.repeat(64);

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function attempt(
	attemptNumber: number,
	outcome: 'passed' | 'product-failed',
	providerConclusion: PromotionHistoryProviderConclusionV2,
	startedAt: string,
	completedAt: string,
): PromotionHistoryAttemptInputV2 {
	const observation = {
		version: 2 as const,
		runId,
		stage: 'required-selfhost' as const,
		executionCommit,
		promotionSubjectId,
		completedAt: new Date((Date.parse(startedAt) + Date.parse(completedAt)) / 2).toISOString(),
		outcome,
		countsTowardPromotion: true,
		unexplainedDifferentials: 0,
		evidence: [{
			id: 'unit-tests',
			status: outcome === 'passed' ? 'passed' as const : 'failed' as const,
			sha256: evidenceSha256,
		}],
	};
	const observationSerialized = JSON.stringify(observation);
	const bytesSha256 = sha256(JSON.stringify({
		schemaVersion: 1,
		claim: 'required-selfhost-promotion-observation',
		productionEligible: false,
		observationSha256: sha256(observationSerialized),
		observation,
	}));
	return {
		attempt: attemptNumber,
		startedAt,
		completedAt,
		providerConclusion,
		artifactState: 'valid',
		artifact: { archiveSha256, bytesSha256, observation },
	};
}

function ledger(attempts: readonly PromotionHistoryAttemptInputV2[]): PromotionHistoryLedgerInputV2 {
	return {
		version: 2,
		stage: 'required-selfhost',
		generation: 1,
		parentLedgerSha256: null,
		migration: promotionHistoryMigrationV2(),
		runs: [{
			runId,
			sequenceAt: '2026-08-01T18:47:00.000Z',
			executionCommit,
			freezeBoundary: null,
			promotionEffectiveAttemptCount: attempts.length,
			attempts,
		}],
	};
}

test('valid pass from a cancelled attempt remains a recoverable non-product gap', () => {
	const cancelled = attempt(
		1,
		'passed',
		'cancelled',
		'2026-08-01T18:47:01.000Z',
		'2026-08-01T18:50:00.000Z',
	);
	const gap = effectivePromotionHistoryRunsV2(parsePromotionHistoryLedgerV2(ledger([cancelled])).ledger)[0];
	assert.equal(gap?.kind, 'gap');
	if (gap?.kind === 'gap') {
		assert.equal(gap.reason, 'workflow-execution-non-successful');
		assert.equal(gap.providerConclusion, 'cancelled');
		assert.equal(gap.artifactState, 'valid');
	}

	const recovered = attempt(
		2,
		'passed',
		'success',
		'2026-08-01T19:00:00.000Z',
		'2026-08-01T19:05:00.000Z',
	);
	const effective = effectivePromotionHistoryRunsV2(parsePromotionHistoryLedgerV2(ledger([cancelled, recovered])).ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'passed');
});

test('valid product failure remains sticky even when the workflow attempt was cancelled', () => {
	const cancelledFailure = attempt(
		1,
		'product-failed',
		'cancelled',
		'2026-08-01T18:47:01.000Z',
		'2026-08-01T18:50:00.000Z',
	);
	const laterPass = attempt(
		2,
		'passed',
		'success',
		'2026-08-01T19:00:00.000Z',
		'2026-08-01T19:05:00.000Z',
	);
	const effective = effectivePromotionHistoryRunsV2(parsePromotionHistoryLedgerV2(ledger([cancelledFailure, laterPass])).ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'product-failed');
});
