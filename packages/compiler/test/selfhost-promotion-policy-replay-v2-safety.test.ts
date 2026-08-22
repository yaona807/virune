import assert from 'node:assert/strict';
import test from 'node:test';
import { replayPromotionHistoryAgainstPolicyV2 } from '../src/selfhost/promotion-policy-replay-v2.js';

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

function policy(overrides: {
	readonly blocking?: boolean;
	readonly manualApprovalRequired?: boolean;
} = {}) {
	return {
		schemaVersion: 1,
		automaticPromotionAllowed: false,
		stages: [{
			id: 'required-selfhost',
			blocking: overrides.blocking ?? true,
			scope: 'selfhost-related',
			productionDefault: false,
			requiredEvidence,
			promotionRequirements: {
				minimumConsecutiveSuccessfulRuns: 14,
				minimumObservationDays: 14,
				maximumUnexplainedDifferentials: 0,
				manualApprovalRequired: overrides.manualApprovalRequired ?? true,
				rollbackEvidenceRequired: false,
				minimumStableReleaseCycles: 0,
			},
		}],
	};
}

const history = {
	version: 2,
	stage: 'required-selfhost',
	entries: [{
		version: 2,
		runId: 'run-1',
		stage: 'required-selfhost',
		executionCommit: '1'.repeat(40),
		promotionSubjectId: '2'.repeat(64),
		completedAt: '2026-08-20T01:00:00.000Z',
		outcome: 'passed',
		countsTowardPromotion: true,
		unexplainedDifferentials: 0,
		evidence: requiredEvidence.map(id => ({ id, status: 'passed', sha256: '3'.repeat(64) })),
	}],
};

test('blocking promotion replay rejects removal of manual approval', () => {
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			policy({ manualApprovalRequired: false }),
			'required-selfhost',
			history,
		),
		/blocking promotion stages must require manual approval/u,
	);
});

test('blocking promotion replay rejects a non-blocking stage contract', () => {
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			policy({ blocking: false }),
			'required-selfhost',
			history,
		),
		/stage blocking\/scope\/productionDefault contract is invalid/u,
	);
});

test('blocking promotion replay rejects unknown policy-root fields', () => {
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			{ ...policy(), futureBlockingSemantic: true },
			'required-selfhost',
			history,
		),
		/policy: expected exactly keys/u,
	);
});

test('blocking promotion replay rejects unknown selected-stage fields', () => {
	const base = policy();
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			{
				...base,
				stages: [{ ...base.stages[0]!, futureBlockingSemantic: true }],
			},
			'required-selfhost',
			history,
		),
		/policy\.stage\.required-selfhost: expected exactly keys/u,
	);
});

test('blocking promotion replay rejects unknown promotion-requirement fields', () => {
	const base = policy();
	const stage = base.stages[0]!;
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			{
				...base,
				stages: [{
					...stage,
					promotionRequirements: {
						...stage.promotionRequirements,
						futureApprovalRequired: true,
					},
				}],
			},
			'required-selfhost',
			history,
		),
		/policy\.stage\.required-selfhost\.promotionRequirements: expected exactly keys/u,
	);
});
