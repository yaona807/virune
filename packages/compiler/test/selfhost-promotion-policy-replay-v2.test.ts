import assert from 'node:assert/strict';
import test from 'node:test';
import {
	evaluatePromotionObservationSourceV2,
	replayPromotionHistoryAgainstPolicyV2,
} from '../src/selfhost/promotion-policy-replay-v2.js';
import type { PromotionShadowHistoryEntryInputV2 } from '../src/selfhost/promotion-shadow-history-v2.js';

const subject = 'a'.repeat(64);
const digest = (character: string): string => character.repeat(64);
const requiredSelfhostEvidence = [
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

function policy(extraRequiredEvidence: readonly string[], runs = 14, days = 14) {
	return {
		schemaVersion: 1,
		automaticPromotionAllowed: false,
		stages: [{
			id: 'required-selfhost',
			blocking: true,
			scope: 'selfhost-related',
			productionDefault: false,
			requiredEvidence: [...requiredSelfhostEvidence, ...extraRequiredEvidence],
			promotionRequirements: {
				minimumConsecutiveSuccessfulRuns: runs,
				minimumObservationDays: days,
				maximumUnexplainedDifferentials: 0,
				manualApprovalRequired: true,
				rollbackEvidenceRequired: false,
				minimumStableReleaseCycles: 0,
			},
		}],
	};
}

function entry(runId: string, completedAt: string, extraEvidenceIds: readonly string[], options: {
	readonly outcome?: 'passed' | 'product-failed' | 'infrastructure-failed' | 'cancelled';
	readonly countsTowardPromotion?: boolean;
	readonly unexplainedDifferentials?: number;
} = {}): PromotionShadowHistoryEntryInputV2 {
	const evidenceIds = [...requiredSelfhostEvidence, ...extraEvidenceIds];
	return {
		version: 2,
		runId,
		stage: 'required-selfhost',
		executionCommit: runId.endsWith('1') ? '1'.repeat(40) : runId.endsWith('2') ? '2'.repeat(40) : '3'.repeat(40),
		promotionSubjectId: subject,
		completedAt,
		outcome: options.outcome ?? 'passed',
		countsTowardPromotion: options.countsTowardPromotion ?? true,
		unexplainedDifferentials: options.unexplainedDifferentials ?? 0,
		evidence: evidenceIds.map((id, index) => ({ id, status: 'passed' as const, sha256: digest(String((index + 1) % 10)) })),
	};
}

function history(entries: readonly PromotionShadowHistoryEntryInputV2[]) {
	return { version: 2 as const, stage: 'required-selfhost' as const, entries };
}

test('trusted scheduled source counts while manual, push, PR, fork, and mismatched sources do not', () => {
	const trusted = {
		repository: 'yaona807/virune',
		workflow: '.github/workflows/selfhost-promotion-observation.yml',
		ref: 'refs/heads/main',
		eventName: 'schedule',
	};
	const canonical = { ...trusted, fork: false };
	assert.equal(evaluatePromotionObservationSourceV2(canonical, trusted).countable, true);
	for (const source of [
		{ ...canonical, eventName: 'workflow_dispatch' },
		{ ...canonical, eventName: 'push' },
		{ ...canonical, eventName: 'pull_request' },
		{ ...canonical, fork: true },
		{ ...canonical, repository: 'fork/virune' },
		{ ...canonical, workflow: '.github/workflows/nightly.yml' },
		{ ...canonical, ref: 'refs/heads/feature' },
	]) assert.equal(evaluatePromotionObservationSourceV2(source, trusted).countable, false);
	assert.deepEqual(
		evaluatePromotionObservationSourceV2({
			...canonical,
			repository: 'fork/virune',
			workflow: '.github/workflows/nightly.yml',
			ref: 'refs/heads/feature',
			eventName: 'workflow_dispatch',
			fork: true,
		}, trusted),
		{
			countable: false,
			reasons: ['repository-mismatch', 'workflow-mismatch', 'ref-mismatch', 'event-mismatch', 'fork-source'],
		},
	);
	assert.throws(
		() => evaluatePromotionObservationSourceV2(canonical, { ...trusted, eventName: 'workflow_dispatch' }),
		/trusted event must be schedule/u,
	);
});

test('policy replay excludes old successes missing newly required evidence without invalidating the product', () => {
	const result = replayPromotionHistoryAgainstPolicyV2(policy(['a', 'b']), 'required-selfhost', history([
		entry('run-1', '2026-08-18T01:00:00.000Z', ['a']),
		entry('run-2', '2026-08-19T01:00:00.000Z', ['a', 'b']),
		entry('run-3', '2026-08-20T01:00:00.000Z', ['a', 'b']),
	]));
	assert.deepEqual(result.qualifyingRunIds, ['run-2', 'run-3']);
	assert.equal(result.successfulRuns, 2);
	assert.equal(result.observationDays, 2);
	assert.equal(result.productInvalidated, false);
	assert.deepEqual(result.excludedRuns[0]?.missingEvidence, ['b']);
	assert.deepEqual(result.excludedRuns[0]?.reasons, ['missing-current-required-evidence']);
	assert.equal(result.historyThresholdsSatisfied, false);
});

test('a current-policy evidence gap breaks the consecutive streak without invalidating the product', () => {
	const result = replayPromotionHistoryAgainstPolicyV2(policy(['a', 'b']), 'required-selfhost', history([
		entry('run-1', '2026-08-18T01:00:00.000Z', ['a', 'b']),
		entry('run-2', '2026-08-19T01:00:00.000Z', ['a']),
		entry('run-3', '2026-08-20T01:00:00.000Z', ['a', 'b']),
	]));
	assert.deepEqual(result.qualifyingRunIds, ['run-3']);
	assert.equal(result.successfulRuns, 1);
	assert.equal(result.productInvalidated, false);
});

test('historical runs that already carried newly required evidence remain countable', () => {
	const result = replayPromotionHistoryAgainstPolicyV2(policy(['a', 'b']), 'required-selfhost', history([
		entry('run-1', '2026-08-19T01:00:00.000Z', ['b', 'a']),
		entry('run-2', '2026-08-20T01:00:00.000Z', ['a', 'b']),
	]));
	assert.equal(result.successfulRuns, 2);
	assert.equal(result.observationDays, 2);
	assert.equal(result.historyThresholdsSatisfied, false);
});

test('recorded product failure remains invalidating under a stronger later policy', () => {
	const failed = entry('run-1', '2026-08-18T01:00:00.000Z', ['a'], { outcome: 'product-failed', unexplainedDifferentials: 1 });
	const result = replayPromotionHistoryAgainstPolicyV2(policy(['a', 'b']), 'required-selfhost', history([
		failed,
		entry('run-2', '2026-08-19T01:00:00.000Z', ['a', 'b']),
		entry('run-3', '2026-08-20T01:00:00.000Z', ['a', 'b']),
	]));
	assert.equal(result.productInvalidated, true);
	assert.equal(result.successfulRuns, 0);
	assert.equal(result.historyThresholdsSatisfied, false);
});

test('counting infrastructure failure remains a streak reset even when current policy requires more evidence', () => {
	const result = replayPromotionHistoryAgainstPolicyV2(policy(['a', 'b']), 'required-selfhost', history([
		entry('run-1', '2026-08-18T01:00:00.000Z', ['a', 'b']),
		entry('run-2', '2026-08-19T01:00:00.000Z', ['a'], { outcome: 'infrastructure-failed' }),
		entry('run-3', '2026-08-20T01:00:00.000Z', ['a', 'b']),
	]));
	assert.equal(result.successfulRuns, 1);
	assert.equal(result.observationDays, 1);
	assert.equal(result.historyThresholdsSatisfied, false);
});

test('canonical 14-run and 14-day required-selfhost history satisfies the policy floor', () => {
	const entries = Array.from({ length: 14 }, (_, index) => entry(
		`run-${index + 1}`,
		`2026-08-${String(index + 1).padStart(2, '0')}T01:00:00.000Z`,
		[],
	));
	const result = replayPromotionHistoryAgainstPolicyV2(policy([]), 'required-selfhost', history(entries));
	assert.equal(result.successfulRuns, 14);
	assert.equal(result.observationDays, 14);
	assert.equal(result.historyThresholdsSatisfied, true);
});

test('policy replay rejects weakened safety floors as well as automatic promotion and duplicate evidence', () => {
	const validHistory = history([entry('run-1', '2026-08-20T01:00:00.000Z', ['a'])]);
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2({ ...policy(['a']), automaticPromotionAllowed: true }, 'required-selfhost', validHistory),
		/automatic promotion must remain disabled/u,
	);
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(policy(['a', 'a']), 'required-selfhost', validHistory),
		/duplicate values/u,
	);
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(policy(['a'], 13, 14), 'required-selfhost', validHistory),
		/must be at least 14 for required-selfhost/u,
	);
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(policy(['a'], 14, 13), 'required-selfhost', validHistory),
		/must be at least 14 for required-selfhost/u,
	);
	const missingFloor = policy(['a']);
	missingFloor.stages[0]!.requiredEvidence = missingFloor.stages[0]!.requiredEvidence.filter(id => id !== 'clean-bootstrap');
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(missingFloor, 'required-selfhost', validHistory),
		/required evidence is below the canonical safety floor: clean-bootstrap/u,
	);
	const nonZeroDifferentials = policy(['a']);
	nonZeroDifferentials.stages[0]!.promotionRequirements.maximumUnexplainedDifferentials = 1;
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(nonZeroDifferentials, 'required-selfhost', validHistory),
		/must remain 0 for blocking promotion stages/u,
	);
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(policy(['a']), 'required-compiler', validHistory),
		/expected exactly one required-compiler stage/u,
	);
});

test('required-compiler and production-default keep their stage-specific safety floors', () => {
	const requiredCompilerEvidence = [
		...requiredSelfhostEvidence,
		'compiler-api-compatibility',
		'interop-abi-compatibility',
		'runtime-abi-compatibility',
	];
	const productionDefaultEvidence = [
		...requiredCompilerEvidence,
		'release-reproducibility',
		'stable-release-cycle',
	];
	const stageEntry = (stage: 'required-compiler' | 'production-default', evidenceIds: readonly string[]) => ({
		...entry(`run-${stage}`, '2026-08-20T01:00:00.000Z', []),
		stage,
		evidence: evidenceIds.map((id, index) => ({ id, status: 'passed' as const, sha256: digest(String((index + 1) % 10)) })),
	});
	const stagePolicy = (
		stage: 'required-compiler' | 'production-default',
		requiredEvidence: readonly string[],
		requirements: {
			readonly minimumConsecutiveSuccessfulRuns: number;
			readonly minimumObservationDays: number;
			readonly rollbackEvidenceRequired: boolean;
			readonly minimumStableReleaseCycles: number;
		},
	) => ({
		schemaVersion: 1,
		automaticPromotionAllowed: false,
		stages: [{
			id: stage,
			blocking: true,
			scope: stage === 'required-compiler' ? 'compiler-changes' : 'production',
			productionDefault: stage === 'production-default',
			requiredEvidence: [...requiredEvidence],
			promotionRequirements: {
				minimumConsecutiveSuccessfulRuns: requirements.minimumConsecutiveSuccessfulRuns,
				minimumObservationDays: requirements.minimumObservationDays,
				maximumUnexplainedDifferentials: 0,
				manualApprovalRequired: true,
				rollbackEvidenceRequired: requirements.rollbackEvidenceRequired,
				minimumStableReleaseCycles: requirements.minimumStableReleaseCycles,
			},
		}],
	});

	const compilerRequirements = {
		minimumConsecutiveSuccessfulRuns: 28,
		minimumObservationDays: 28,
		rollbackEvidenceRequired: false,
		minimumStableReleaseCycles: 0,
	};
	const compilerPolicy = stagePolicy('required-compiler', requiredCompilerEvidence, compilerRequirements);
	const compilerHistory = { version: 2, stage: 'required-compiler', entries: [stageEntry('required-compiler', requiredCompilerEvidence)] };
	const compiler = replayPromotionHistoryAgainstPolicyV2(compilerPolicy, 'required-compiler', compilerHistory);
	assert.equal(compiler.minimumConsecutiveSuccessfulRuns, 28);
	assert.equal(compiler.minimumObservationDays, 28);
	assert.equal(compiler.historyThresholdsSatisfied, false);
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			stagePolicy('required-compiler', requiredCompilerEvidence, { ...compilerRequirements, minimumConsecutiveSuccessfulRuns: 27 }),
			'required-compiler',
			compilerHistory,
		),
		/must be at least 28 for required-compiler/u,
	);

	const productionRequirements = {
		minimumConsecutiveSuccessfulRuns: 30,
		minimumObservationDays: 30,
		rollbackEvidenceRequired: true,
		minimumStableReleaseCycles: 1,
	};
	const productionPolicy = stagePolicy('production-default', productionDefaultEvidence, productionRequirements);
	const productionHistory = { version: 2, stage: 'production-default', entries: [stageEntry('production-default', productionDefaultEvidence)] };
	const production = replayPromotionHistoryAgainstPolicyV2(productionPolicy, 'production-default', productionHistory);
	assert.equal(production.minimumConsecutiveSuccessfulRuns, 30);
	assert.equal(production.minimumObservationDays, 30);
	assert.equal(production.rollbackEvidenceRequired, true);
	assert.equal(production.minimumStableReleaseCycles, 1);
	assert.equal(production.historyThresholdsSatisfied, false);

	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			stagePolicy('production-default', productionDefaultEvidence, { ...productionRequirements, rollbackEvidenceRequired: false }),
			'production-default',
			productionHistory,
		),
		/production-default must require rollback evidence/u,
	);
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			stagePolicy('production-default', productionDefaultEvidence, { ...productionRequirements, minimumStableReleaseCycles: 0 }),
			'production-default',
			productionHistory,
		),
		/must be at least 1 for production-default/u,
	);
	assert.throws(
		() => replayPromotionHistoryAgainstPolicyV2(
			stagePolicy('production-default', productionDefaultEvidence.filter(id => id !== 'release-reproducibility'), productionRequirements),
			'production-default',
			productionHistory,
		),
		/required evidence is below the canonical safety floor: release-reproducibility/u,
	);
});
