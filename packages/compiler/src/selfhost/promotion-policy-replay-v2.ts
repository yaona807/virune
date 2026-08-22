import {
	createPromotionShadowHistoryV2,
	type PromotionShadowHistoryInputV2,
} from './promotion-shadow-history-v2.js';
import type { PromotionSubjectStage } from './promotion-subject.js';

export const PROMOTION_POLICY_REPLAY_VERSION = 2 as const;

const requiredEvidenceFloorByStage: Readonly<Record<PromotionSubjectStage, readonly string[]>> = {
	'required-selfhost': [
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
	],
	'required-compiler': [
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
		'compiler-api-compatibility',
		'interop-abi-compatibility',
		'runtime-abi-compatibility',
	],
	'production-default': [
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
		'compiler-api-compatibility',
		'interop-abi-compatibility',
		'runtime-abi-compatibility',
		'release-reproducibility',
		'stable-release-cycle',
	],
};

const promotionRequirementFloorByStage: Readonly<Record<PromotionSubjectStage, {
	readonly minimumConsecutiveSuccessfulRuns: number;
	readonly minimumObservationDays: number;
	readonly rollbackEvidenceRequired: boolean;
	readonly minimumStableReleaseCycles: number;
}>> = {
	'required-selfhost': {
		minimumConsecutiveSuccessfulRuns: 14,
		minimumObservationDays: 14,
		rollbackEvidenceRequired: false,
		minimumStableReleaseCycles: 0,
	},
	'required-compiler': {
		minimumConsecutiveSuccessfulRuns: 28,
		minimumObservationDays: 28,
		rollbackEvidenceRequired: false,
		minimumStableReleaseCycles: 0,
	},
	'production-default': {
		minimumConsecutiveSuccessfulRuns: 30,
		minimumObservationDays: 30,
		rollbackEvidenceRequired: true,
		minimumStableReleaseCycles: 1,
	},
};

export interface PromotionObservationSourceV2 {
	readonly repository: string;
	readonly workflow: string;
	readonly ref: string;
	readonly eventName: string;
	readonly fork: boolean;
}

export interface TrustedPromotionObservationSourceV2 {
	readonly repository: string;
	readonly workflow: string;
	readonly ref: string;
	readonly eventName: string;
}

export interface PromotionObservationSourceEvaluationV2 {
	readonly countable: boolean;
	readonly reasons: readonly string[];
}

export interface PromotionPolicyReplayExcludedRunV2 {
	readonly runId: string;
	readonly missingEvidence: readonly string[];
	readonly failedEvidence: readonly string[];
	readonly reasons: readonly string[];
}

export interface PromotionPolicyReplayV2 {
	readonly version: typeof PROMOTION_POLICY_REPLAY_VERSION;
	readonly stage: PromotionSubjectStage;
	readonly promotionSubjectId: string;
	readonly requiredEvidence: readonly string[];
	readonly successfulRuns: number;
	readonly observationDays: number;
	readonly firstSuccessfulAt: string | null;
	readonly productInvalidated: boolean;
	readonly unexplainedDifferentials: number;
	readonly minimumConsecutiveSuccessfulRuns: number;
	readonly minimumObservationDays: number;
	readonly maximumUnexplainedDifferentials: number;
	readonly manualApprovalRequired: boolean;
	readonly rollbackEvidenceRequired: boolean;
	readonly minimumStableReleaseCycles: number;
	readonly historyThresholdsSatisfied: boolean;
	readonly qualifyingRunIds: readonly string[];
	readonly excludedRuns: readonly PromotionPolicyReplayExcludedRunV2[];
}

export class PromotionPolicyReplayError extends Error {
	public override readonly name = 'PromotionPolicyReplayError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

export function evaluatePromotionObservationSourceV2(
	sourceValue: unknown,
	trustedValue: unknown,
): PromotionObservationSourceEvaluationV2 {
	const source = parseSource(sourceValue, '$.source');
	const trusted = parseTrustedSource(trustedValue, '$.trusted');
	const reasons: string[] = [];
	if (source.repository !== trusted.repository) reasons.push('repository-mismatch');
	if (source.workflow !== trusted.workflow) reasons.push('workflow-mismatch');
	if (source.ref !== trusted.ref) reasons.push('ref-mismatch');
	if (source.eventName !== trusted.eventName) reasons.push('event-mismatch');
	if (source.fork) reasons.push('fork-source');
	return { countable: reasons.length === 0, reasons };
}

export function replayPromotionHistoryAgainstPolicyV2(
	policyValue: unknown,
	stage: PromotionSubjectStage,
	historyValue: PromotionShadowHistoryInputV2 | unknown,
): PromotionPolicyReplayV2 {
	const policyStage = parsePolicyStage(policyValue, stage);
	const canonicalHistory = createPromotionShadowHistoryV2(historyValue).history;
	if (canonicalHistory.stage !== stage) {
		throw new PromotionPolicyReplayError('history.stage', `expected ${stage}, received ${canonicalHistory.stage}`);
	}

	const currentSubjectId = canonicalHistory.promotionSubjectId;
	const formalEntries = canonicalHistory.entries.filter(entry => entry.countsTowardPromotion);
	const currentSegment = formalEntries.length === 0
		? []
		: trailingSubjectSegment(formalEntries, currentSubjectId);
	const excludedRuns: PromotionPolicyReplayExcludedRunV2[] = [];
	const disposition = currentSegment.map(entry => {
		const evidence = new Map(entry.evidence.map(item => [item.id, item.status]));
		const missingEvidence = policyStage.requiredEvidence.filter(id => !evidence.has(id));
		const failedEvidence = policyStage.requiredEvidence.filter(id => evidence.get(id) === 'failed');
		const evidenceQualifies = missingEvidence.length === 0 && failedEvidence.length === 0;
		if (entry.countsTowardPromotion && entry.outcome === 'passed' && !evidenceQualifies) {
			const reasons: string[] = [];
			if (missingEvidence.length > 0) reasons.push('missing-current-required-evidence');
			if (failedEvidence.length > 0) reasons.push('failed-current-required-evidence');
			excludedRuns.push({ runId: entry.runId, missingEvidence, failedEvidence, reasons });
		}
		return { entry, evidenceQualifies };
	});
	const successful = canonicalHistory.productInvalidated ? [] : trailingPolicySuccesses(disposition);
	const qualifyingRunIds = successful.map(item => item.entry.runId);
	const successfulRuns = successful.length;
	const observationDays = new Set(successful.map(item => item.entry.completedAt.slice(0, 10))).size;
	const firstSuccessfulAt = successful[0]?.entry.completedAt ?? null;
	const productInvalidated = canonicalHistory.productInvalidated;
	const unexplainedDifferentials = canonicalHistory.unexplainedDifferentials;
	const historyThresholdsSatisfied = !productInvalidated
		&& successfulRuns >= policyStage.minimumConsecutiveSuccessfulRuns
		&& observationDays >= policyStage.minimumObservationDays
		&& unexplainedDifferentials <= policyStage.maximumUnexplainedDifferentials;
	return {
		version: PROMOTION_POLICY_REPLAY_VERSION,
		stage,
		promotionSubjectId: currentSubjectId,
		requiredEvidence: policyStage.requiredEvidence,
		successfulRuns,
		observationDays,
		firstSuccessfulAt,
		productInvalidated,
		unexplainedDifferentials,
		minimumConsecutiveSuccessfulRuns: policyStage.minimumConsecutiveSuccessfulRuns,
		minimumObservationDays: policyStage.minimumObservationDays,
		maximumUnexplainedDifferentials: policyStage.maximumUnexplainedDifferentials,
		manualApprovalRequired: policyStage.manualApprovalRequired,
		rollbackEvidenceRequired: policyStage.rollbackEvidenceRequired,
		minimumStableReleaseCycles: policyStage.minimumStableReleaseCycles,
		historyThresholdsSatisfied,
		qualifyingRunIds,
		excludedRuns,
	};
}

function trailingSubjectSegment<T extends { readonly promotionSubjectId: string }>(entries: readonly T[], promotionSubjectId: string): readonly T[] {
	let first = entries.length - 1;
	for (let index = entries.length - 2; index >= 0; index -= 1) {
		if (entries[index]!.promotionSubjectId !== promotionSubjectId) break;
		first = index;
	}
	return entries.slice(first);
}

function trailingPolicySuccesses<T extends { readonly entry: { readonly countsTowardPromotion: boolean; readonly outcome: string }; readonly evidenceQualifies: boolean }>(entries: readonly T[]): readonly T[] {
	const formal = entries.filter(item => item.entry.countsTowardPromotion);
	if (formal.length === 0) return [];
	let first = formal.length;
	for (let index = formal.length - 1; index >= 0; index -= 1) {
		const item = formal[index]!;
		if (item.entry.outcome !== 'passed' || !item.evidenceQualifies) break;
		first = index;
	}
	return formal.slice(first);
}

interface ParsedPolicyStage {
	readonly requiredEvidence: readonly string[];
	readonly minimumConsecutiveSuccessfulRuns: number;
	readonly minimumObservationDays: number;
	readonly maximumUnexplainedDifferentials: number;
	readonly manualApprovalRequired: boolean;
	readonly rollbackEvidenceRequired: boolean;
	readonly minimumStableReleaseCycles: number;
}

function parsePolicyStage(value: unknown, stageId: PromotionSubjectStage): ParsedPolicyStage {
	const policy = record(value, 'policy');
	exactKeys(policy, ['schemaVersion', 'automaticPromotionAllowed', 'stages'], 'policy');
	if (policy.schemaVersion !== 1) throw new PromotionPolicyReplayError('policy.schemaVersion', 'expected 1');
	if (policy.automaticPromotionAllowed !== false) {
		throw new PromotionPolicyReplayError('policy.automaticPromotionAllowed', 'automatic promotion must remain disabled');
	}
	const stages = array(policy.stages, 'policy.stages');
	const matches = stages.filter(item => recordOrNull(item)?.id === stageId);
	if (matches.length !== 1) throw new PromotionPolicyReplayError('policy.stages', `expected exactly one ${stageId} stage`);
	const stagePath = `policy.stage.${stageId}`;
	const stage = record(matches[0], stagePath);
	exactKeys(stage, ['id', 'blocking', 'scope', 'productionDefault', 'requiredEvidence', 'promotionRequirements'], stagePath);
	const expectedScope = stageId === 'required-selfhost' ? 'selfhost-related' : stageId === 'required-compiler' ? 'compiler-changes' : 'production';
	if (stage.blocking !== true || stage.scope !== expectedScope || stage.productionDefault !== (stageId === 'production-default')) {
		throw new PromotionPolicyReplayError(stagePath, 'stage blocking/scope/productionDefault contract is invalid');
	}
	const requiredEvidence = uniqueStrings(stage.requiredEvidence, `${stagePath}.requiredEvidence`).sort(compareText);
	const missingEvidenceFloor = requiredEvidenceFloorByStage[stageId].filter(id => !requiredEvidence.includes(id));
	if (missingEvidenceFloor.length > 0) {
		throw new PromotionPolicyReplayError(
			`${stagePath}.requiredEvidence`,
			`required evidence is below the canonical safety floor: ${missingEvidenceFloor.join(', ')}`,
		);
	}
	const requirementsPath = `${stagePath}.promotionRequirements`;
	const requirements = record(stage.promotionRequirements, requirementsPath);
	exactKeys(requirements, [
		'minimumConsecutiveSuccessfulRuns',
		'minimumObservationDays',
		'maximumUnexplainedDifferentials',
		'manualApprovalRequired',
		'rollbackEvidenceRequired',
		'minimumStableReleaseCycles',
	], requirementsPath);
	const minimumConsecutiveSuccessfulRuns = nonNegativeInteger(requirements.minimumConsecutiveSuccessfulRuns, 'minimumConsecutiveSuccessfulRuns');
	const minimumObservationDays = nonNegativeInteger(requirements.minimumObservationDays, 'minimumObservationDays');
	const maximumUnexplainedDifferentials = nonNegativeInteger(requirements.maximumUnexplainedDifferentials, 'maximumUnexplainedDifferentials');
	const manualApprovalRequired = bool(requirements.manualApprovalRequired, 'manualApprovalRequired');
	const rollbackEvidenceRequired = bool(requirements.rollbackEvidenceRequired, 'rollbackEvidenceRequired');
	const minimumStableReleaseCycles = nonNegativeInteger(requirements.minimumStableReleaseCycles, 'minimumStableReleaseCycles');
	const floor = promotionRequirementFloorByStage[stageId];
	if (minimumConsecutiveSuccessfulRuns < floor.minimumConsecutiveSuccessfulRuns) {
		throw new PromotionPolicyReplayError('minimumConsecutiveSuccessfulRuns', `must be at least ${floor.minimumConsecutiveSuccessfulRuns} for ${stageId}`);
	}
	if (minimumObservationDays < floor.minimumObservationDays) {
		throw new PromotionPolicyReplayError('minimumObservationDays', `must be at least ${floor.minimumObservationDays} for ${stageId}`);
	}
	if (maximumUnexplainedDifferentials !== 0) {
		throw new PromotionPolicyReplayError('maximumUnexplainedDifferentials', 'must remain 0 for blocking promotion stages');
	}
	if (!manualApprovalRequired) throw new PromotionPolicyReplayError('manualApprovalRequired', 'blocking promotion stages must require manual approval');
	if (floor.rollbackEvidenceRequired && !rollbackEvidenceRequired) {
		throw new PromotionPolicyReplayError('rollbackEvidenceRequired', `${stageId} must require rollback evidence`);
	}
	if (minimumStableReleaseCycles < floor.minimumStableReleaseCycles) {
		throw new PromotionPolicyReplayError('minimumStableReleaseCycles', `must be at least ${floor.minimumStableReleaseCycles} for ${stageId}`);
	}
	return {
		requiredEvidence,
		minimumConsecutiveSuccessfulRuns,
		minimumObservationDays,
		maximumUnexplainedDifferentials,
		manualApprovalRequired,
		rollbackEvidenceRequired,
		minimumStableReleaseCycles,
	};
}

function parseSource(value: unknown, path: string): PromotionObservationSourceV2 {
	const source = record(value, path);
	exactKeys(source, ['repository', 'workflow', 'ref', 'eventName', 'fork'], path);
	return {
		repository: text(source.repository, `${path}.repository`),
		workflow: text(source.workflow, `${path}.workflow`),
		ref: text(source.ref, `${path}.ref`),
		eventName: text(source.eventName, `${path}.eventName`),
		fork: bool(source.fork, `${path}.fork`),
	};
}

function parseTrustedSource(value: unknown, path: string): TrustedPromotionObservationSourceV2 {
	const source = record(value, path);
	exactKeys(source, ['repository', 'workflow', 'ref', 'eventName'], path);
	const eventName = text(source.eventName, `${path}.eventName`);
	if (eventName !== 'schedule') {
		throw new PromotionPolicyReplayError(`${path}.eventName`, 'trusted event must be schedule');
	}
	return {
		repository: text(source.repository, `${path}.repository`),
		workflow: text(source.workflow, `${path}.workflow`),
		ref: text(source.ref, `${path}.ref`),
		eventName,
	};
}

function uniqueStrings(value: unknown, path: string): string[] {
	const values = array(value, path).map((item, index) => text(item, `${path}[${index}]`));
	if (new Set(values).size !== values.length) throw new PromotionPolicyReplayError(path, 'duplicate values are not allowed');
	return values;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PromotionPolicyReplayError(path, 'expected object');
	return value as Record<string, unknown>;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new PromotionPolicyReplayError(path, 'expected array');
	return value;
}

function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new PromotionPolicyReplayError(path, 'expected non-empty canonical string');
	return value;
}

function bool(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new PromotionPolicyReplayError(path, 'expected boolean');
	return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new PromotionPolicyReplayError(path, 'expected non-negative safe integer');
	return value as number;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new PromotionPolicyReplayError(path, `expected exactly keys ${wanted.join(', ')}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
