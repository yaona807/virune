import assert from 'node:assert/strict';
import test from 'node:test';
import { orchestratePromotionHistoryV2 } from '../src/selfhost/promotion-history-orchestrator-v2.js';

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
				minimumConsecutiveSuccessfulRuns: 14, minimumObservationDays: 14,
				maximumUnexplainedDifferentials: 0, manualApprovalRequired: true,
				rollbackEvidenceRequired: false, minimumStableReleaseCycles: 0,
			},
		}],
	};
}

function run() {
	return {
		runId: '100', sequenceAt: '2026-08-20T18:17:00.000Z', executionCommit: '1'.repeat(40),
		status: 'completed' as const, runAttempt: 1,
		attempts: [{
			attempt: 1, startedAt: '2026-08-20T18:17:01.000Z', completedAt: '2026-08-20T18:30:00.000Z', conclusion: 'success', gapReason: null,
			artifact: {
				archiveSha256: 'a'.repeat(64), bytesSha256: 'b'.repeat(64),
				observation: {
					version: 2 as const, runId: '100', stage: 'required-selfhost' as const,
					executionCommit: '1'.repeat(40), promotionSubjectId: 'c'.repeat(64),
					completedAt: '2026-08-20T18:29:59.000Z', outcome: 'passed' as const,
					countsTowardPromotion: true, unexplainedDifferentials: 0,
					evidence: requiredEvidence.map((id, index) => ({ id, status: 'passed' as const, sha256: `${index.toString(16).padStart(2, '0')}${'d'.repeat(62)}` })),
				},
			},
		}],
	};
}

test('aggregation attempt greater than one can evaluate but never publish canonical ledger state', () => {
	const result = orchestratePromotionHistoryV2({
		stage: 'required-selfhost', policy: policy(),
		trigger: { aggregationRunId: '900', aggregationAttempt: 2, observationRunId: '100' },
		runs: [run()],
	});
	assert.equal(result.report.publish, false);
	assert.equal(result.report.publishedLedgerSha256, null);
	assert.equal(result.report.currentLedgerSha256, null);
	assert.equal(result.ledger, null);
	assert.equal(result.serializedLedger, null);
	assert.equal(result.ledgerSha256, null);
	assert.deepEqual(result.report.processedRunIds, ['100']);
});
