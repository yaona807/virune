import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePromotionHistoryAggregationReportV2 } from '../src/selfhost/promotion-history-aggregation-report-v2.js';
import { orchestratePromotionHistoryV2 } from '../src/selfhost/promotion-history-orchestrator-v2.js';
import type { PromotionAggregationRunSnapshotV2 } from '../src/selfhost/promotion-history-aggregation-v2.js';
import type { PromotionHistoryLedgerV2 } from '../src/selfhost/promotion-history-ledger-v2.js';

const executionCommit = '1'.repeat(40);
const promotionSubjectId = 'a'.repeat(64);
const archiveSha256 = 'b'.repeat(64);
const bytesSha256 = 'c'.repeat(64);
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

function passingRun(runId = '100', sequenceAt = '2026-08-20T18:17:00.000Z'): PromotionAggregationRunSnapshotV2 {
	return {
		runId,
		sequenceAt,
		executionCommit,
		status: 'completed',
		runAttempt: 1,
		attempts: [{
			attempt: 1,
			startedAt: sequenceAt,
			completedAt: '2026-08-20T18:30:00.000Z',
			conclusion: 'success',
			gapReason: null,
			artifact: {
				archiveSha256,
				bytesSha256,
				observation: {
					version: 2,
					runId,
					stage: 'required-selfhost',
					executionCommit,
					promotionSubjectId,
					completedAt: '2026-08-20T18:29:59.000Z',
					outcome: 'passed',
					countsTowardPromotion: true,
					unexplainedDifferentials: 0,
					evidence: requiredEvidence.map((id, index) => ({
						id,
						status: 'passed' as const,
						sha256: `${index.toString(16).padStart(2, '0')}${'d'.repeat(62)}`,
					})),
				},
			},
		}],
	};
}

function failedRun(runId = '101', sequenceAt = '2026-08-21T18:17:00.000Z'): PromotionAggregationRunSnapshotV2 {
	return {
		runId,
		sequenceAt,
		executionCommit: '2'.repeat(40),
		status: 'completed',
		runAttempt: 1,
		attempts: [{
			attempt: 1,
			startedAt: sequenceAt,
			completedAt: '2026-08-21T18:20:00.000Z',
			conclusion: 'failure',
			artifact: null,
			gapReason: 'workflow-infrastructure-failed',
		}],
	};
}

function trigger(observationRunId = '100', observationEvent: 'schedule' | 'workflow_dispatch' = 'schedule') {
	return { aggregationRunId: '900', aggregationAttempt: 1, observationRunId, observationEvent };
}

test('publishes a canonical genesis ledger and replays the current policy', () => {
	const result = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: trigger(),
		runs: [passingRun()],
	});
	assert.equal(result.report.publish, true);
	assert.equal(result.ledger?.generation, 1);
	assert.equal(result.report.currentProductKnown, true);
	assert.equal(result.report.policy?.promotionSubjectId, promotionSubjectId);
	assert.equal(result.report.policy?.successfulRuns, 1);
	assert.equal(result.report.policy?.observationDays, 1);
	assert.equal(result.report.policy?.historyThresholdsSatisfied, false);
	assert.equal(result.report.migration?.promotionCreditRuns, 0);
	assert.equal(result.report.migration?.promotionCreditDays, 0);
	assert.match(result.reportSha256, /^[0-9a-f]{64}$/u);
});

test('same provider snapshot against its parent is a deterministic no-op', () => {
	const first = orchestratePromotionHistoryV2({ stage: 'required-selfhost', policy: policy(), trigger: trigger(), runs: [passingRun()] });
	const parent = first.ledger as PromotionHistoryLedgerV2;
	const second = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: { aggregationRunId: '901', aggregationAttempt: 1, observationRunId: '100', observationEvent: 'schedule' },
		parent,
		runs: [passingRun()],
	});
	assert.equal(second.report.publish, false);
	assert.equal(second.ledger, null);
	assert.equal(second.report.currentLedgerGeneration, 1);
	assert.equal(second.report.currentLedgerSha256, first.ledgerSha256);
	assert.equal(second.report.policy?.successfulRuns, 1);
});

test('a latest gap breaks the streak and does not expose a synthetic subject as the current product', () => {
	const first = orchestratePromotionHistoryV2({ stage: 'required-selfhost', policy: policy(), trigger: trigger(), runs: [passingRun()] });
	const second = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: { aggregationRunId: '902', aggregationAttempt: 1, observationRunId: '101', observationEvent: 'schedule' },
		parent: first.ledger as PromotionHistoryLedgerV2,
		runs: [passingRun(), failedRun()],
	});
	assert.equal(second.report.publish, true);
	assert.equal(second.report.currentProductKnown, false);
	assert.equal(second.report.policy?.promotionSubjectId, null);
	assert.equal(second.report.policy?.successfulRuns, 0);
	assert.equal(second.report.policy?.historyThresholdsSatisfied, false);
});

test('manual observation trigger can inspect backlog but cannot publish canonical state', () => {
	const result = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: trigger('777', 'workflow_dispatch'),
		runs: [passingRun()],
	});
	assert.equal(result.report.trigger.observationEvent, 'workflow_dispatch');
	assert.equal(result.report.publish, false);
	assert.equal(result.report.currentLedgerSha256, null);
	assert.equal(result.report.currentLedgerGeneration, null);
	assert.equal(result.ledger, null);
	assert.equal(result.serializedLedger, null);
	assert.equal(result.ledgerSha256, null);
	assert.deepEqual(result.report.processedRunIds, ['100']);
	assert.doesNotThrow(() => parsePromotionHistoryAggregationReportV2(result.report));
});

test('identical inputs produce byte-identical reports and ledger hashes', () => {
	const input = { stage: 'required-selfhost' as const, policy: policy(), trigger: trigger(), runs: [passingRun()] };
	const first = orchestratePromotionHistoryV2(input);
	const second = orchestratePromotionHistoryV2(input);
	assert.equal(first.serializedReport, second.serializedReport);
	assert.equal(first.reportSha256, second.reportSha256);
	assert.equal(first.serializedLedger, second.serializedLedger);
	assert.equal(first.ledgerSha256, second.ledgerSha256);
});

test('report run-id serialization is canonical even when provider IDs are not monotonic by creation time', () => {
	const result = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: trigger('100'),
		runs: [
			passingRun('200', '2026-08-20T18:17:00.000Z'),
			passingRun('100', '2026-08-20T18:18:00.000Z'),
		],
	});
	assert.deepEqual(result.report.processedRunIds, ['100', '200']);
	assert.doesNotThrow(() => parsePromotionHistoryAggregationReportV2(result.report));
});

test('rejects malformed aggregation trigger identity', () => {
	assert.throws(
		() => orchestratePromotionHistoryV2({
			stage: 'required-selfhost',
			policy: policy(),
			trigger: { aggregationRunId: '0900', aggregationAttempt: 1, observationRunId: '100', observationEvent: 'schedule' },
			runs: [passingRun()],
		}),
		/canonical positive decimal run ID/u,
	);
	assert.throws(
		() => orchestratePromotionHistoryV2({
			stage: 'required-selfhost',
			policy: policy(),
			trigger: { aggregationRunId: '900', aggregationAttempt: 1, observationRunId: '100', observationEvent: 'push' as 'schedule' },
			runs: [passingRun()],
		}),
		/expected schedule or workflow_dispatch/u,
	);
});
