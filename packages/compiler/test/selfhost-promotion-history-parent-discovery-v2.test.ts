import assert from 'node:assert/strict';
import test from 'node:test';
import { orchestratePromotionHistoryV2 } from '../src/selfhost/promotion-history-orchestrator-v2.js';
import { discoverPromotionHistoryParentV2 } from '../src/selfhost/promotion-history-parent-discovery-v2.js';
import type { PromotionAggregationRunSnapshotV2 } from '../src/selfhost/promotion-history-aggregation-v2.js';
import type { PromotionHistoryLedgerV2 } from '../src/selfhost/promotion-history-ledger-v2.js';

const executionCommit = '1'.repeat(40);
const promotionSubjectId = 'a'.repeat(64);
const requiredEvidence = [
	'bootstrap-smoke', 'differential-smoke', 'format-check', 'performance-smoke', 'type-check', 'unit-tests',
	'binding-corpus', 'browser-integration', 'clean-bootstrap', 'cross-evidence-generation-binding',
	'environment-perturbation', 'exact-head-evidence-binding', 'fixed-seed-verification', 'full-conformance',
	'full-differential', 'fuzz-regression', 'independent-runner-reproducibility', 'legacy-rollback',
	'performance-budget', 'stage1-stage2-transition', 'stage2-stage3-fixed-point',
] as const;

function policy() {
	return {
		schemaVersion: 1,
		automaticPromotionAllowed: false,
		stages: [{
			id: 'required-selfhost', blocking: true, scope: 'selfhost-related', productionDefault: false,
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

function passingRun(): PromotionAggregationRunSnapshotV2 {
	return {
		runId: '100',
		sequenceAt: '2026-08-20T18:17:00.000Z',
		executionCommit,
		status: 'completed',
		runAttempt: 1,
		attempts: [{
			attempt: 1,
			startedAt: '2026-08-20T18:17:01.000Z',
			completedAt: '2026-08-20T18:30:00.000Z',
			conclusion: 'success',
			gapReason: null,
			artifact: {
				archiveSha256: 'b'.repeat(64),
				bytesSha256: 'c'.repeat(64),
				observation: {
					version: 2,
					runId: '100',
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

function publication(aggregationRunId = '900', aggregationAttempt = 1) {
	return orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: { aggregationRunId, aggregationAttempt, observationRunId: '100' },
		runs: [passingRun()],
	});
}

function noLedgerReport(aggregationRunId = '901', aggregationAttempt = 1) {
	return orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: { aggregationRunId, aggregationAttempt, observationRunId: '100' },
		runs: [],
	});
}

test('selects the newest canonical attempt-1 publishing ledger as parent', () => {
	const published = publication();
	const result = discoverPromotionHistoryParentV2({
		stage: 'required-selfhost',
		candidates: [{
			runId: '900', attempt: 1, createdAt: '2026-08-20T19:00:00.000Z', conclusion: 'success',
			report: published.report, ledger: published.ledger,
		}],
	});
	assert.equal(result.parent?.sha256, published.ledgerSha256);
	assert.equal(result.sourceRunId, '900');
	assert.equal(result.sourceAttempt, 1);
});

test('a newer no-op report traces through to the older publishing source', () => {
	const published = publication();
	const noop = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: { aggregationRunId: '901', aggregationAttempt: 1, observationRunId: '100' },
		parent: published.ledger as PromotionHistoryLedgerV2,
		runs: [passingRun()],
	});
	assert.equal(noop.report.publish, false);
	const result = discoverPromotionHistoryParentV2({
		stage: 'required-selfhost',
		candidates: [
			{ runId: '901', attempt: 1, createdAt: '2026-08-20T20:00:00.000Z', conclusion: 'success', report: noop.report, ledger: null },
			{ runId: '900', attempt: 1, createdAt: '2026-08-20T19:00:00.000Z', conclusion: 'success', report: published.report, ledger: published.ledger },
		],
	});
	assert.equal(result.parent?.sha256, published.ledgerSha256);
	assert.equal(result.sourceRunId, '900');
});

test('rerun report may retain a lineage hint but cannot itself publish canonical state', () => {
	const published = publication();
	const rerun = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: { aggregationRunId: '901', aggregationAttempt: 2, observationRunId: '100' },
		parent: published.ledger as PromotionHistoryLedgerV2,
		runs: [passingRun()],
	});
	const result = discoverPromotionHistoryParentV2({
		stage: 'required-selfhost',
		candidates: [
			{ runId: '901', attempt: 2, createdAt: '2026-08-20T20:00:00.000Z', conclusion: 'success', report: rerun.report, ledger: null },
			{ runId: '900', attempt: 1, createdAt: '2026-08-20T19:00:00.000Z', conclusion: 'success', report: published.report, ledger: published.ledger },
		],
	});
	assert.equal(result.parent?.sha256, published.ledgerSha256);
});

test('publishing report without its ledger artifact fails closed', () => {
	const published = publication();
	assert.throws(
		() => discoverPromotionHistoryParentV2({
			stage: 'required-selfhost',
			candidates: [{ runId: '900', attempt: 1, createdAt: '2026-08-20T19:00:00.000Z', conclusion: 'success', report: published.report, ledger: null }],
		}),
		/missing its canonical ledger artifact/u,
	);
});

test('a no-op current-ledger SHA cannot silently switch while searching backward', () => {
	const published = publication();
	const noop = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: { aggregationRunId: '901', aggregationAttempt: 1, observationRunId: '100' },
		parent: published.ledger as PromotionHistoryLedgerV2,
		runs: [passingRun()],
	});
	const corrupted = { ...published.report, currentLedgerSha256: 'f'.repeat(64), publishedLedgerSha256: 'f'.repeat(64) };
	assert.throws(
		() => discoverPromotionHistoryParentV2({
			stage: 'required-selfhost',
			candidates: [
				{ runId: '901', attempt: 1, createdAt: '2026-08-20T20:00:00.000Z', conclusion: 'success', report: noop.report, ledger: null },
				{ runId: '900', attempt: 1, createdAt: '2026-08-20T19:00:00.000Z', conclusion: 'success', report: corrupted, ledger: published.ledger },
			],
		}),
		/disagree about the current ledger/u,
	);
});

test('a non-publishing report must self-bind its parent and current ledger identity', () => {
	const published = publication();
	const noop = orchestratePromotionHistoryV2({
		stage: 'required-selfhost',
		policy: policy(),
		trigger: { aggregationRunId: '901', aggregationAttempt: 1, observationRunId: '100' },
		parent: published.ledger as PromotionHistoryLedgerV2,
		runs: [passingRun()],
	});
	const corrupted = { ...noop.report, parentLedgerSha256: 'f'.repeat(64) };
	assert.throws(
		() => discoverPromotionHistoryParentV2({
			stage: 'required-selfhost',
			candidates: [
				{ runId: '901', attempt: 1, createdAt: '2026-08-20T20:00:00.000Z', conclusion: 'success', report: corrupted, ledger: null },
				{ runId: '900', attempt: 1, createdAt: '2026-08-20T19:00:00.000Z', conclusion: 'success', report: published.report, ledger: published.ledger },
			],
		}),
		/non-publishing report must retain the current ledger as its parent/u,
	);
});

test('a newer successful report cannot drop a previously published ledger and restart from genesis', () => {
	const published = publication();
	const rollback = noLedgerReport();
	assert.equal(rollback.report.currentLedgerSha256, null);
	assert.throws(
		() => discoverPromotionHistoryParentV2({
			stage: 'required-selfhost',
			candidates: [
				{ runId: '901', attempt: 1, createdAt: '2026-08-20T20:00:00.000Z', conclusion: 'success', report: rollback.report, ledger: null },
				{ runId: '900', attempt: 1, createdAt: '2026-08-20T19:00:00.000Z', conclusion: 'success', report: published.report, ledger: published.ledger },
			],
		}),
		/dropped previously published ledger state/u,
	);
});
