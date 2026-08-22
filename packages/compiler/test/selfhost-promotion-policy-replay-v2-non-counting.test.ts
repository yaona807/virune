import assert from 'node:assert/strict';
import test from 'node:test';
import { replayPromotionHistoryAgainstPolicyV2 } from '../src/selfhost/promotion-policy-replay-v2.js';
import type { PromotionShadowHistoryEntryInputV2 } from '../src/selfhost/promotion-shadow-history-v2.js';

const subjectA = 'a'.repeat(64);
const subjectB = 'b'.repeat(64);
const requiredEvidence = [
	'bootstrap-smoke',
	'differential-smoke',
	'format-check',
	'performance-smoke',
	'type-check',
	'unit-tests',
	'binding-corpus',
	'browser-integration',
	'clean-bootstrap',
	'cross-evidence-generation-binding',
	'environment-perturbation',
	'exact-head-evidence-binding',
	'fixed-seed-verification',
	'full-conformance',
	'full-differential',
	'fuzz-regression',
	'independent-runner-reproducibility',
	'legacy-rollback',
	'performance-budget',
	'stage1-stage2-transition',
	'stage2-stage3-fixed-point',
] as const;

function policy() {
	return {
		schemaVersion: 1,
		automaticPromotionAllowed: false,
		stages: [{
			id: 'required-selfhost',
			blocking: true,
			scope: 'selfhost-related',
			productionDefault: false,
			requiredEvidence,
			promotionRequirements: {
				minimumConsecutiveSuccessfulRuns: 14,
				minimumObservationDays: 14,
				maximumUnexplainedDifferentials: 0,
				manualApprovalRequired: true,
				rollbackEvidenceRequired: false,
				minimumStableReleaseCycles: 0,
			},
		}],
	};
}

function entry(
	runId: string,
	completedAt: string,
	promotionSubjectId: string,
	options: {
		readonly outcome?: 'passed' | 'product-failed';
		readonly countsTowardPromotion?: boolean;
		readonly unexplainedDifferentials?: number;
	} = {},
): PromotionShadowHistoryEntryInputV2 {
	return {
		version: 2,
		runId,
		stage: 'required-selfhost',
		executionCommit: runId === 'run-1' ? '1'.repeat(40) : runId === 'run-2' ? '2'.repeat(40) : '3'.repeat(40),
		promotionSubjectId,
		completedAt,
		outcome: options.outcome ?? 'passed',
		countsTowardPromotion: options.countsTowardPromotion ?? true,
		unexplainedDifferentials: options.unexplainedDifferentials ?? 0,
		evidence: requiredEvidence.map((id, index) => ({
			id,
			status: 'passed' as const,
			sha256: `${index.toString(16).padStart(2, '0')}${'d'.repeat(62)}`,
		})),
	};
}

test('different-subject non-counting diagnostics do not split the current-policy formal streak', () => {
	const result = replayPromotionHistoryAgainstPolicyV2(
		policy(),
		'required-selfhost',
		{
			version: 2,
			stage: 'required-selfhost',
			entries: [
				entry('run-1', '2026-08-18T01:00:00.000Z', subjectA),
				entry('diag-1', '2026-08-19T01:00:00.000Z', subjectB, {
					outcome: 'product-failed',
					countsTowardPromotion: false,
					unexplainedDifferentials: 7,
				}),
				entry('run-2', '2026-08-20T01:00:00.000Z', subjectA),
			],
		},
	);
	assert.equal(result.promotionSubjectId, subjectA);
	assert.deepEqual(result.qualifyingRunIds, ['run-1', 'run-2']);
	assert.equal(result.successfulRuns, 2);
	assert.equal(result.observationDays, 2);
	assert.equal(result.productInvalidated, false);
	assert.equal(result.unexplainedDifferentials, 0);
	assert.equal(result.historyThresholdsSatisfied, false);
});
