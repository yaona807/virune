export type PromotionDecision = 'blocked' | 'manual' | 'automatic';
export type PromotionEvidenceStatus = 'passed' | 'failed';

export interface PromotionEvidenceItem {
	readonly id: string;
	readonly status: PromotionEvidenceStatus;
	readonly candidateSha: string;
	readonly source: string;
	readonly completedAt: string;
}

export interface PromotionEvidenceObservation {
	readonly schemaVersion: 1;
	readonly candidateSha: string;
	readonly successfulRuns: number;
	readonly observationDays: number;
	readonly unexplainedDifferentials: number;
	readonly manualApproval: boolean;
	readonly rollbackEvidence: boolean;
	readonly stableReleaseCycles: number;
	readonly evidence: readonly PromotionEvidenceItem[];
}

export interface PromotionEvaluationReason {
	readonly code: string;
	readonly path: string;
	readonly message: string;
}

export interface PromotionThresholdEvaluation {
	readonly successfulRuns: { readonly actual: number | null; readonly required: number | null };
	readonly observationDays: { readonly actual: number | null; readonly required: number | null };
	readonly unexplainedDifferentials: { readonly actual: number | null; readonly maximum: number | null };
	readonly stableReleaseCycles: { readonly actual: number | null; readonly required: number | null };
}

export interface PromotionEvaluation {
	readonly schemaVersion: 1;
	readonly stageId: string;
	readonly candidateSha: string | null;
	readonly eligible: boolean;
	readonly decision: PromotionDecision;
	readonly automaticPromotionAllowed: boolean | null;
	readonly missingEvidence: readonly string[];
	readonly failedEvidence: readonly string[];
	readonly staleEvidence: readonly string[];
	readonly thresholds: PromotionThresholdEvaluation;
	readonly reasons: readonly PromotionEvaluationReason[];
}

interface ParsedPromotionRequirements {
	readonly minimumConsecutiveSuccessfulRuns: number;
	readonly minimumObservationDays: number;
	readonly maximumUnexplainedDifferentials: number;
	readonly manualApprovalRequired: boolean;
	readonly rollbackEvidenceRequired: boolean;
	readonly minimumStableReleaseCycles: number;
}

interface ParsedPromotionStage {
	readonly id: string;
	readonly requiredEvidence: readonly string[];
	readonly promotionRequirements: ParsedPromotionRequirements;
}

interface ParsedObservation {
	readonly candidateSha: string | null;
	readonly successfulRuns: number | null;
	readonly observationDays: number | null;
	readonly unexplainedDifferentials: number | null;
	readonly manualApproval: boolean | null;
	readonly rollbackEvidence: boolean | null;
	readonly stableReleaseCycles: number | null;
	readonly evidence: readonly ParsedEvidence[];
}

interface ParsedEvidence {
	readonly id: string;
	readonly status: PromotionEvidenceStatus;
	readonly candidateSha: string;
}

/**
 * Apply a checked-in promotion policy to one candidate-bound evidence report.
 * This function is pure and fail closed: it never promotes or mutates state.
 */
export function evaluatePromotionEvidence(
	policyValue: unknown,
	stageId: string,
	observationValue: unknown,
): PromotionEvaluation {
	const reasons: PromotionEvaluationReason[] = [];
	const automaticPromotionAllowed = parsePolicyAutomaticFlag(policyValue, reasons);
	const stages = parsePolicyStages(policyValue, reasons);
	const stage = stages.find(value => value.id === stageId) ?? null;
	if (stageId.length === 0) {
		pushReason(reasons, 'INVALID_STAGE_ID', 'stageId', 'stageId must not be empty');
	} else if (stage === null && !hasRawStageId(policyValue, stageId)) {
		pushReason(reasons, 'UNKNOWN_STAGE', 'stageId', `Unknown promotion stage ${stageId}`);
	}

	const observation = parseObservation(observationValue, reasons);
	const missingEvidence: string[] = [];
	const failedEvidence: string[] = [];
	const staleEvidence: string[] = [];
	const evidenceById = new Map<string, ParsedEvidence>();
	for (const evidence of observation.evidence) {
		if (!evidenceById.has(evidence.id)) evidenceById.set(evidence.id, evidence);
		if (evidence.status === 'failed') {
			appendUnique(failedEvidence, evidence.id);
			pushReason(reasons, 'FAILED_EVIDENCE', `observation.evidence.${evidence.id}`, `Evidence ${evidence.id} failed`);
		}
		if (observation.candidateSha !== null && evidence.candidateSha !== observation.candidateSha) {
			appendUnique(staleEvidence, evidence.id);
			pushReason(
				reasons,
				'STALE_EVIDENCE',
				`observation.evidence.${evidence.id}.candidateSha`,
				`Evidence ${evidence.id} targets ${evidence.candidateSha}, not ${observation.candidateSha}`,
			);
		}
	}

	if (stage !== null) {
		for (const evidenceId of stage.requiredEvidence) {
			if (!evidenceById.has(evidenceId)) {
				missingEvidence.push(evidenceId);
				pushReason(
					reasons,
				'MISSING_EVIDENCE',
				`stage.${stage.id}.requiredEvidence.${evidenceId}`,
				`Required evidence ${evidenceId} is missing`,
				);
			}
		}
		applyThresholds(stage, observation, reasons);
	}

	const thresholds = thresholdEvaluation(stage, observation);
	const eligible = reasons.length === 0;
	const decision: PromotionDecision = !eligible
		? 'blocked'
		: automaticPromotionAllowed === true && stage?.promotionRequirements.manualApprovalRequired === false
			? 'automatic'
			: 'manual';
	return {
		schemaVersion: 1,
		stageId,
		candidateSha: observation.candidateSha,
		eligible,
		decision,
		automaticPromotionAllowed,
		missingEvidence,
		failedEvidence,
		staleEvidence,
		thresholds,
		reasons,
	};
}

function parsePolicyAutomaticFlag(
	value: unknown,
	reasons: PromotionEvaluationReason[],
): boolean | null {
	const policy = asRecord(value);
	if (policy === null) {
		pushReason(reasons, 'INVALID_POLICY', 'policy', 'Promotion policy must be an object');
		return null;
	}
	if (policy.schemaVersion !== 1) {
		pushReason(reasons, 'INVALID_POLICY_SCHEMA', 'policy.schemaVersion', 'Promotion policy schemaVersion must be 1');
	}
	if (typeof policy.automaticPromotionAllowed !== 'boolean') {
		pushReason(
			reasons,
			'INVALID_POLICY_AUTOMATION',
			'policy.automaticPromotionAllowed',
			'automaticPromotionAllowed must be a boolean',
		);
		return null;
	}
	return policy.automaticPromotionAllowed;
}

function parsePolicyStages(
	value: unknown,
	reasons: PromotionEvaluationReason[],
): readonly ParsedPromotionStage[] {
	const policy = asRecord(value);
	if (policy === null || !Array.isArray(policy.stages)) {
		if (policy !== null) pushReason(reasons, 'INVALID_POLICY_STAGES', 'policy.stages', 'Policy stages must be an array');
		return [];
	}
	const parsed: ParsedPromotionStage[] = [];
	const seen = new Set<string>();
	for (const [index, stageValue] of policy.stages.entries()) {
		const path = `policy.stages[${index}]`;
		const stage = asRecord(stageValue);
		if (stage === null) {
			pushReason(reasons, 'INVALID_POLICY_STAGE', path, 'Promotion stage must be an object');
			continue;
		}
		const id = readNonEmptyString(stage.id, `${path}.id`, reasons, 'INVALID_POLICY_STAGE_ID');
		if (id !== null) {
			if (seen.has(id)) {
				pushReason(reasons, 'DUPLICATE_STAGE', `${path}.id`, `Promotion stage ${id} is duplicated`);
			} else {
				seen.add(id);
			}
		}
		const requiredEvidence = readUniqueStringArray(
			stage.requiredEvidence,
			`${path}.requiredEvidence`,
			reasons,
			'INVALID_REQUIRED_EVIDENCE',
			'DUPLICATE_REQUIRED_EVIDENCE',
		);
		const requirements = parseRequirements(stage.promotionRequirements, `${path}.promotionRequirements`, reasons);
		if (id !== null && requiredEvidence !== null && requirements !== null) {
			parsed.push({ id, requiredEvidence, promotionRequirements: requirements });
		}
	}
	return parsed;
}

function parseRequirements(
	value: unknown,
	path: string,
	reasons: PromotionEvaluationReason[],
): ParsedPromotionRequirements | null {
	const requirements = asRecord(value);
	if (requirements === null) {
		pushReason(reasons, 'INVALID_PROMOTION_REQUIREMENTS', path, 'promotionRequirements must be an object');
		return null;
	}
	const minimumConsecutiveSuccessfulRuns = readNonNegativeInteger(
		requirements.minimumConsecutiveSuccessfulRuns,
		`${path}.minimumConsecutiveSuccessfulRuns`,
		reasons,
		'INVALID_SUCCESSFUL_RUN_THRESHOLD',
	);
	const minimumObservationDays = readNonNegativeInteger(
		requirements.minimumObservationDays,
		`${path}.minimumObservationDays`,
		reasons,
		'INVALID_OBSERVATION_DAY_THRESHOLD',
	);
	const maximumUnexplainedDifferentials = readNonNegativeInteger(
		requirements.maximumUnexplainedDifferentials,
		`${path}.maximumUnexplainedDifferentials`,
		reasons,
		'INVALID_DIFFERENTIAL_THRESHOLD',
	);
	const manualApprovalRequired = readBoolean(
		requirements.manualApprovalRequired,
		`${path}.manualApprovalRequired`,
		reasons,
		'INVALID_MANUAL_APPROVAL_POLICY',
	);
	const rollbackEvidenceRequired = readBoolean(
		requirements.rollbackEvidenceRequired,
		`${path}.rollbackEvidenceRequired`,
		reasons,
		'INVALID_ROLLBACK_POLICY',
	);
	const minimumStableReleaseCycles = readNonNegativeInteger(
		requirements.minimumStableReleaseCycles,
		`${path}.minimumStableReleaseCycles`,
		reasons,
		'INVALID_STABLE_RELEASE_THRESHOLD',
	);
	if (
		minimumConsecutiveSuccessfulRuns === null
		|| minimumObservationDays === null
		|| maximumUnexplainedDifferentials === null
		|| manualApprovalRequired === null
		|| rollbackEvidenceRequired === null
		|| minimumStableReleaseCycles === null
	) return null;
	return {
		minimumConsecutiveSuccessfulRuns,
		minimumObservationDays,
		maximumUnexplainedDifferentials,
		manualApprovalRequired,
		rollbackEvidenceRequired,
		minimumStableReleaseCycles,
	};
}

function parseObservation(
	value: unknown,
	reasons: PromotionEvaluationReason[],
): ParsedObservation {
	const observation = asRecord(value);
	if (observation === null) {
		pushReason(reasons, 'INVALID_OBSERVATION', 'observation', 'Promotion evidence observation must be an object');
		return emptyObservation();
	}
	if (observation.schemaVersion !== 1) {
		pushReason(reasons, 'INVALID_OBSERVATION_SCHEMA', 'observation.schemaVersion', 'Observation schemaVersion must be 1');
	}
	const candidateSha = readSha(observation.candidateSha, 'observation.candidateSha', reasons);
	const successfulRuns = readNonNegativeInteger(
		observation.successfulRuns,
		'observation.successfulRuns',
		reasons,
		'INVALID_SUCCESSFUL_RUN_COUNT',
	);
	const observationDays = readNonNegativeInteger(
		observation.observationDays,
		'observation.observationDays',
		reasons,
		'INVALID_OBSERVATION_DAY_COUNT',
	);
	const unexplainedDifferentials = readNonNegativeInteger(
		observation.unexplainedDifferentials,
		'observation.unexplainedDifferentials',
		reasons,
		'INVALID_DIFFERENTIAL_COUNT',
	);
	const manualApproval = readBoolean(
		observation.manualApproval,
		'observation.manualApproval',
		reasons,
		'INVALID_MANUAL_APPROVAL_EVIDENCE',
	);
	const rollbackEvidence = readBoolean(
		observation.rollbackEvidence,
		'observation.rollbackEvidence',
		reasons,
		'INVALID_ROLLBACK_EVIDENCE',
	);
	const stableReleaseCycles = readNonNegativeInteger(
		observation.stableReleaseCycles,
		'observation.stableReleaseCycles',
		reasons,
		'INVALID_STABLE_RELEASE_COUNT',
	);
	return {
		candidateSha,
		successfulRuns,
		observationDays,
		unexplainedDifferentials,
		manualApproval,
		rollbackEvidence,
		stableReleaseCycles,
		evidence: parseEvidence(observation.evidence, reasons),
	};
}

function parseEvidence(
	value: unknown,
	reasons: PromotionEvaluationReason[],
): readonly ParsedEvidence[] {
	if (!Array.isArray(value)) {
		pushReason(reasons, 'INVALID_EVIDENCE_LIST', 'observation.evidence', 'Evidence must be an array');
		return [];
	}
	const parsed: ParsedEvidence[] = [];
	const seen = new Set<string>();
	for (const [index, evidenceValue] of value.entries()) {
		const path = `observation.evidence[${index}]`;
		const evidence = asRecord(evidenceValue);
		if (evidence === null) {
			pushReason(reasons, 'INVALID_EVIDENCE', path, 'Evidence item must be an object');
			continue;
		}
		const id = readNonEmptyString(evidence.id, `${path}.id`, reasons, 'INVALID_EVIDENCE_ID');
		if (id !== null) {
			if (seen.has(id)) pushReason(reasons, 'DUPLICATE_EVIDENCE', `${path}.id`, `Evidence ${id} is duplicated`);
			else seen.add(id);
		}
		const status = evidence.status === 'passed' || evidence.status === 'failed' ? evidence.status : null;
		if (status === null) {
			pushReason(reasons, 'INVALID_EVIDENCE_STATUS', `${path}.status`, 'Evidence status must be passed or failed');
		}
		const candidateSha = readSha(evidence.candidateSha, `${path}.candidateSha`, reasons);
		readNonEmptyString(evidence.source, `${path}.source`, reasons, 'INVALID_EVIDENCE_SOURCE');
		const completedAt = typeof evidence.completedAt === 'string' ? evidence.completedAt : null;
		const parsedCompletedAt = completedAt === null ? null : new Date(completedAt);
		if (
			completedAt === null
			|| parsedCompletedAt === null
			|| Number.isNaN(parsedCompletedAt.getTime())
			|| parsedCompletedAt.toISOString() !== completedAt
		) {
			pushReason(
				reasons,
				'INVALID_EVIDENCE_TIME',
				`${path}.completedAt`,
				'Evidence completedAt must be a canonical UTC ISO timestamp',
			);
		}
		if (id !== null && status !== null && candidateSha !== null) parsed.push({ id, status, candidateSha });
	}
	return parsed;
}

function applyThresholds(
	stage: ParsedPromotionStage,
	observation: ParsedObservation,
	reasons: PromotionEvaluationReason[],
): void {
	const requirements = stage.promotionRequirements;
	if (
		observation.successfulRuns !== null
		&& observation.successfulRuns < requirements.minimumConsecutiveSuccessfulRuns
	) {
		pushReason(
			reasons,
			'INSUFFICIENT_SUCCESSFUL_RUNS',
			'observation.successfulRuns',
			`Successful runs ${observation.successfulRuns} are below required ${requirements.minimumConsecutiveSuccessfulRuns}`,
		);
	}
	if (observation.observationDays !== null && observation.observationDays < requirements.minimumObservationDays) {
		pushReason(
			reasons,
			'INSUFFICIENT_OBSERVATION_DAYS',
			'observation.observationDays',
			`Observation days ${observation.observationDays} are below required ${requirements.minimumObservationDays}`,
		);
	}
	if (
		observation.unexplainedDifferentials !== null
		&& observation.unexplainedDifferentials > requirements.maximumUnexplainedDifferentials
	) {
		pushReason(
			reasons,
			'TOO_MANY_DIFFERENTIALS',
			'observation.unexplainedDifferentials',
			`Unexplained differentials ${observation.unexplainedDifferentials} exceed maximum ${requirements.maximumUnexplainedDifferentials}`,
		);
	}
	if (requirements.manualApprovalRequired && observation.manualApproval === false) {
		pushReason(reasons, 'MANUAL_APPROVAL_REQUIRED', 'observation.manualApproval', 'Manual approval evidence is required');
	}
	if (requirements.rollbackEvidenceRequired && observation.rollbackEvidence === false) {
		pushReason(reasons, 'ROLLBACK_EVIDENCE_REQUIRED', 'observation.rollbackEvidence', 'Rollback evidence is required');
	}
	if (
		observation.stableReleaseCycles !== null
		&& observation.stableReleaseCycles < requirements.minimumStableReleaseCycles
	) {
		pushReason(
			reasons,
			'INSUFFICIENT_STABLE_RELEASE_CYCLES',
			'observation.stableReleaseCycles',
			`Stable release cycles ${observation.stableReleaseCycles} are below required ${requirements.minimumStableReleaseCycles}`,
		);
	}
}

function thresholdEvaluation(
	stage: ParsedPromotionStage | null,
	observation: ParsedObservation,
): PromotionThresholdEvaluation {
	return {
		successfulRuns: {
			actual: observation.successfulRuns,
			required: stage?.promotionRequirements.minimumConsecutiveSuccessfulRuns ?? null,
		},
		observationDays: {
			actual: observation.observationDays,
			required: stage?.promotionRequirements.minimumObservationDays ?? null,
		},
		unexplainedDifferentials: {
			actual: observation.unexplainedDifferentials,
			maximum: stage?.promotionRequirements.maximumUnexplainedDifferentials ?? null,
		},
		stableReleaseCycles: {
			actual: observation.stableReleaseCycles,
			required: stage?.promotionRequirements.minimumStableReleaseCycles ?? null,
		},
	};
}

function hasRawStageId(policyValue: unknown, stageId: string): boolean {
	const policy = asRecord(policyValue);
	return policy !== null
		&& Array.isArray(policy.stages)
		&& policy.stages.some(value => asRecord(value)?.id === stageId);
}

function emptyObservation(): ParsedObservation {
	return {
		candidateSha: null,
		successfulRuns: null,
		observationDays: null,
		unexplainedDifferentials: null,
		manualApproval: null,
		rollbackEvidence: null,
		stableReleaseCycles: null,
		evidence: [],
	};
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function readNonEmptyString(
	value: unknown,
	path: string,
	reasons: PromotionEvaluationReason[],
	code: string,
): string | null {
	if (typeof value !== 'string' || value.length === 0) {
		pushReason(reasons, code, path, `${path} must be a non-empty string`);
		return null;
	}
	return value;
}

function readUniqueStringArray(
	value: unknown,
	path: string,
	reasons: PromotionEvaluationReason[],
	invalidCode: string,
	duplicateCode: string,
): readonly string[] | null {
	if (!Array.isArray(value) || value.length === 0) {
		pushReason(reasons, invalidCode, path, `${path} must be a non-empty array`);
		return null;
	}
	const result: string[] = [];
	const seen = new Set<string>();
	let valid = true;
	for (const [index, item] of value.entries()) {
		if (typeof item !== 'string' || item.length === 0) {
			pushReason(reasons, invalidCode, `${path}[${index}]`, 'Required evidence ID must be a non-empty string');
			valid = false;
		} else if (seen.has(item)) {
			pushReason(reasons, duplicateCode, `${path}[${index}]`, `Required evidence ${item} is duplicated`);
			valid = false;
		} else {
			seen.add(item);
			result.push(item);
		}
	}
	return valid ? result : null;
}

function readNonNegativeInteger(
	value: unknown,
	path: string,
	reasons: PromotionEvaluationReason[],
	code: string,
): number | null {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		pushReason(reasons, code, path, `${path} must be a non-negative safe integer`);
		return null;
	}
	return value as number;
}

function readBoolean(
	value: unknown,
	path: string,
	reasons: PromotionEvaluationReason[],
	code: string,
): boolean | null {
	if (typeof value !== 'boolean') {
		pushReason(reasons, code, path, `${path} must be a boolean`);
		return null;
	}
	return value;
}

function readSha(
	value: unknown,
	path: string,
	reasons: PromotionEvaluationReason[],
): string | null {
	if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value)) {
		pushReason(reasons, 'INVALID_CANDIDATE_SHA', path, `${path} must be a 40- or 64-character hexadecimal SHA`);
		return null;
	}
	return value.toLowerCase();
}

function appendUnique(values: string[], value: string): void {
	if (!values.includes(value)) values.push(value);
}

function pushReason(
	reasons: PromotionEvaluationReason[],
	code: string,
	path: string,
	message: string,
): void {
	reasons.push({ code, path, message });
}
