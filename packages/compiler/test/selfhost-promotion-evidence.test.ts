import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	evaluatePromotionEvidence,
	type PromotionEvidenceItem,
	type PromotionEvidenceObservation,
} from '../src/selfhost/promotion-evidence.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const policyPath = resolve(repositoryRoot, '.github/self-hosting/promotion-policy-v1.json');
const candidateSha = 'a'.repeat(40);
const staleSha = 'b'.repeat(40);

interface TestPolicyStage {
	readonly id: string;
	readonly requiredEvidence: readonly string[];
	readonly promotionRequirements: {
		readonly minimumConsecutiveSuccessfulRuns: number;
		readonly minimumObservationDays: number;
		readonly maximumUnexplainedDifferentials: number;
		readonly manualApprovalRequired: boolean;
		readonly rollbackEvidenceRequired: boolean;
		readonly minimumStableReleaseCycles: number;
	};
}

interface TestPolicy {
	readonly schemaVersion: 1;
	readonly automaticPromotionAllowed: boolean;
	readonly stages: readonly TestPolicyStage[];
}

test('checked-in PR policy produces a manual-only eligible decision', async () => {
	const policy = await loadPolicy();
	const stage = stageById(policy, 'pr-informational');
	const observation = passingObservation(stage);
	const first = evaluatePromotionEvidence(policy, stage.id, observation);
	const second = evaluatePromotionEvidence(policy, stage.id, structuredClone(observation));

	assert.deepEqual(first, second);
	assert.equal(first.eligible, true);
	assert.equal(first.decision, 'manual');
	assert.equal(first.automaticPromotionAllowed, false);
	assert.deepEqual(first.reasons, []);
	assert.deepEqual(first.missingEvidence, []);
	assert.deepEqual(first.failedEvidence, []);
	assert.deepEqual(first.staleEvidence, []);
	assert.deepEqual(first.thresholds.successfulRuns, { actual: 0, required: 0 });
});

test('missing, failed, stale, and insufficient evidence blocks required self-host promotion', async () => {
	const policy = await loadPolicy();
	const stage = stageById(policy, 'required-selfhost');
	const evidence = evidenceFor(stage.requiredEvidence.slice(0, -1));
	evidence[0] = { ...evidence[0]!, status: 'failed' };
	evidence[1] = { ...evidence[1]!, candidateSha: staleSha };
	const observation: PromotionEvidenceObservation = {
		schemaVersion: 1,
		candidateSha,
		successfulRuns: stage.promotionRequirements.minimumConsecutiveSuccessfulRuns - 1,
		observationDays: stage.promotionRequirements.minimumObservationDays - 1,
		unexplainedDifferentials: stage.promotionRequirements.maximumUnexplainedDifferentials + 1,
		manualApproval: false,
		rollbackEvidence: false,
		stableReleaseCycles: 0,
		evidence,
	};
	const result = evaluatePromotionEvidence(policy, stage.id, observation);

	assert.equal(result.eligible, false);
	assert.equal(result.decision, 'blocked');
	assert.deepEqual(result.failedEvidence, [stage.requiredEvidence[0]]);
	assert.deepEqual(result.staleEvidence, [stage.requiredEvidence[1]]);
	assert.deepEqual(result.missingEvidence, [stage.requiredEvidence.at(-1)]);
	assert.deepEqual(result.reasons.map(reason => reason.code), [
		'FAILED_EVIDENCE',
		'STALE_EVIDENCE',
		'MISSING_EVIDENCE',
		'INSUFFICIENT_SUCCESSFUL_RUNS',
		'INSUFFICIENT_OBSERVATION_DAYS',
		'TOO_MANY_DIFFERENTIALS',
		'MANUAL_APPROVAL_REQUIRED',
	]);
});

test('fully satisfied required self-host evidence is eligible but still manual', async () => {
	const policy = await loadPolicy();
	const stage = stageById(policy, 'required-selfhost');
	const result = evaluatePromotionEvidence(policy, stage.id, passingObservation(stage));

	assert.equal(result.eligible, true);
	assert.equal(result.decision, 'manual');
	assert.equal(result.thresholds.successfulRuns.actual, 14);
	assert.equal(result.thresholds.observationDays.actual, 14);
	assert.equal(result.thresholds.unexplainedDifferentials.actual, 0);
});

test('production promotion enforces rollback evidence and stable release retention', async () => {
	const policy = await loadPolicy();
	const stage = stageById(policy, 'production-default');
	const observation = {
		...passingObservation(stage),
		rollbackEvidence: false,
		stableReleaseCycles: 0,
	};
	const result = evaluatePromotionEvidence(policy, stage.id, observation);

	assert.equal(result.eligible, false);
	assert.deepEqual(result.reasons.map(reason => reason.code), [
		'ROLLBACK_EVIDENCE_REQUIRED',
		'INSUFFICIENT_STABLE_RELEASE_CYCLES',
	]);
	assert.deepEqual(result.thresholds.stableReleaseCycles, { actual: 0, required: 1 });
});

test('promotion evidence timestamps require canonical UTC ISO representation', async () => {
	const policy = await loadPolicy();
	const stage = stageById(policy, 'pr-informational');
	for (const completedAt of [
		'2026-08-01T00:00:00Z',
		'2026-08-01T09:00:00.000+09:00',
	]) {
		const observation = passingObservation(stage);
		const result = evaluatePromotionEvidence(policy, stage.id, {
			...observation,
			evidence: observation.evidence.map((evidence, index) => index === 0
				? { ...evidence, completedAt }
				: evidence),
		});
		assert.equal(result.eligible, false);
		assert.ok(result.reasons.some(reason =>
			reason.code === 'INVALID_EVIDENCE_TIME'
			&& reason.path === 'observation.evidence[0].completedAt'));
	}
});

test('duplicate and malformed observations fail closed deterministically', async () => {
	const policy = await loadPolicy();
	const stage = stageById(policy, 'pr-informational');
	const evidence = evidenceFor(stage.requiredEvidence);
	const malformed = {
		...passingObservation(stage),
		candidateSha: 'not-a-sha',
		evidence: [evidence[0], evidence[0], { id: '', status: 'unknown', candidateSha, source: '', completedAt: 'never' }],
	};
	const first = evaluatePromotionEvidence(policy, stage.id, malformed);
	const second = evaluatePromotionEvidence(policy, stage.id, malformed);

	assert.deepEqual(first, second);
	assert.equal(first.eligible, false);
	assert.equal(first.decision, 'blocked');
	assert.ok(first.reasons.some(reason => reason.code === 'INVALID_CANDIDATE_SHA'));
	assert.ok(first.reasons.some(reason => reason.code === 'DUPLICATE_EVIDENCE'));
	assert.ok(first.reasons.some(reason => reason.code === 'INVALID_EVIDENCE_ID'));
	assert.ok(first.reasons.some(reason => reason.code === 'INVALID_EVIDENCE_STATUS'));
	assert.ok(first.reasons.some(reason => reason.code === 'INVALID_EVIDENCE_SOURCE'));
	assert.ok(first.reasons.some(reason => reason.code === 'INVALID_EVIDENCE_TIME'));
	assert.ok(first.reasons.some(reason => reason.code === 'MISSING_EVIDENCE'));
});

test('automatic decision is possible only when policy and stage both allow it', async () => {
	const policy = await loadPolicy();
	const stage = stageById(policy, 'pr-informational');
	const automaticPolicy: TestPolicy = { ...policy, automaticPromotionAllowed: true };
	const result = evaluatePromotionEvidence(automaticPolicy, stage.id, passingObservation(stage));

	assert.equal(result.eligible, true);
	assert.equal(result.decision, 'automatic');
});

test('unknown stages and structurally invalid policies remain blocked', async () => {
	const policy = await loadPolicy();
	const stage = stageById(policy, 'pr-informational');
	const unknown = evaluatePromotionEvidence(policy, 'missing-stage', passingObservation(stage));
	assert.equal(unknown.eligible, false);
	assert.deepEqual(unknown.reasons.map(reason => reason.code), ['UNKNOWN_STAGE']);

	const duplicatePolicy = { ...policy, stages: [policy.stages[0], policy.stages[0]] };
	const duplicate = evaluatePromotionEvidence(duplicatePolicy, 'pr-informational', passingObservation(stage));
	assert.equal(duplicate.eligible, false);
	assert.ok(duplicate.reasons.some(reason => reason.code === 'DUPLICATE_STAGE'));
});

async function loadPolicy(): Promise<TestPolicy> {
	return JSON.parse(await readFile(policyPath, 'utf8')) as TestPolicy;
}

function stageById(policy: TestPolicy, id: string): TestPolicyStage {
	const stage = policy.stages.find(value => value.id === id);
	assert.ok(stage, `missing policy stage ${id}`);
	return stage;
}

function passingObservation(stage: TestPolicyStage): PromotionEvidenceObservation {
	return {
		schemaVersion: 1,
		candidateSha,
		successfulRuns: stage.promotionRequirements.minimumConsecutiveSuccessfulRuns,
		observationDays: stage.promotionRequirements.minimumObservationDays,
		unexplainedDifferentials: stage.promotionRequirements.maximumUnexplainedDifferentials,
		manualApproval: true,
		rollbackEvidence: true,
		stableReleaseCycles: stage.promotionRequirements.minimumStableReleaseCycles,
		evidence: evidenceFor(stage.requiredEvidence),
	};
}

function evidenceFor(ids: readonly string[]): PromotionEvidenceItem[] {
	return ids.map(id => ({
		id,
		status: 'passed',
		candidateSha,
		source: `github-actions://${id}`,
		completedAt: '2026-08-01T00:00:00.000Z',
	}));
}
