export const SELFHOST_PROMOTION_POLICY_VERSION = 1 as const;

export const PROMOTION_TARGETS = [
	'non_blocking_pr',
	'nightly_shadow',
	'required_selfhost',
	'required_compiler',
	'internal_opt_in',
	'production_default',
] as const;

export type PromotionTarget = (typeof PROMOTION_TARGETS)[number];

export const PROMOTION_SIGNALS = [
	'bindingCorpus',
	'bootstrapDeterminism',
	'browserIntegration',
	'cleanBootstrap',
	'compilerBuild',
	'diagnosticParity',
	'differentialSmoke',
	'formatCheck',
	'fullConformance',
	'fuzzRegression',
	'interoperabilityAbiCompatible',
	'nodeIntegration',
	'performanceBudget',
	'rollbackSmoke',
	'runtimeAbiCompatible',
	'unitTests',
] as const;

export type PromotionSignal = (typeof PROMOTION_SIGNALS)[number];

export interface PromotionStagePolicy {
	readonly target: PromotionTarget;
	readonly dependsOn: PromotionTarget | null;
	readonly scope:
		| 'pull_request'
		| 'nightly'
		| 'selfhost_paths'
		| 'compiler_paths'
		| 'internal_opt_in'
		| 'production_default';
	readonly required: boolean;
	readonly requiredSignals: readonly PromotionSignal[];
	readonly minConsecutiveNightlySuccesses: number;
	readonly minObservationDays: number;
	readonly manualApprovalRequired: boolean;
}

export interface SelfhostPromotionPolicyV1 {
	readonly version: typeof SELFHOST_PROMOTION_POLICY_VERSION;
	readonly productionCompilerDefault: 'legacy';
	readonly automaticProductionSwitch: false;
	readonly seedAutoUpdate: false;
	readonly legacyRetentionReleaseCycles: number;
	readonly stages: readonly PromotionStagePolicy[];
}

export interface PromotionEvidence {
	readonly target: PromotionTarget;
	readonly completedTargets: readonly PromotionTarget[];
	readonly signals: Partial<Readonly<Record<PromotionSignal, boolean>>>;
	readonly consecutiveNightlySuccesses: number;
	readonly observationDays: number;
	readonly manualApproval: boolean;
}

export interface PromotionDecision {
	readonly target: PromotionTarget;
	readonly eligible: boolean;
	readonly automatic: false;
	readonly blockers: readonly string[];
}

const targetSet = new Set<string>(PROMOTION_TARGETS);
const signalSet = new Set<string>(PROMOTION_SIGNALS);

export function parseSelfhostPromotionPolicy(input: unknown): SelfhostPromotionPolicyV1 {
	const policy = requireRecord(input, 'policy');
	assertExactKeys(policy, [
		'automaticProductionSwitch',
		'legacyRetentionReleaseCycles',
		'productionCompilerDefault',
		'seedAutoUpdate',
		'stages',
		'version',
	], 'policy');
	if (policy.version !== SELFHOST_PROMOTION_POLICY_VERSION) {
		throw new Error(`Unsupported self-host promotion policy version: ${String(policy.version)}`);
	}
	if (policy.productionCompilerDefault !== 'legacy') {
		throw new Error('productionCompilerDefault must remain legacy');
	}
	if (policy.automaticProductionSwitch !== false) {
		throw new Error('automaticProductionSwitch must be false');
	}
	if (policy.seedAutoUpdate !== false) throw new Error('seedAutoUpdate must be false');
	const legacyRetentionReleaseCycles = requireNonNegativeInteger(
		policy.legacyRetentionReleaseCycles,
		'legacyRetentionReleaseCycles',
	);
	if (legacyRetentionReleaseCycles < 1) {
		throw new Error('legacyRetentionReleaseCycles must be at least 1');
	}
	if (!Array.isArray(policy.stages)) throw new Error('policy.stages must be an array');
	const stages = policy.stages.map((value, index) => parseStage(value, index));
	if (stages.length !== PROMOTION_TARGETS.length) {
		throw new Error(`policy.stages must contain ${PROMOTION_TARGETS.length} stages`);
	}
	for (let index = 0; index < PROMOTION_TARGETS.length; index += 1) {
		const expected = PROMOTION_TARGETS[index];
		const actual = stages[index]?.target;
		if (actual !== expected) throw new Error(`policy.stages[${index}].target must be ${expected}`);
	}
	return {
		version: SELFHOST_PROMOTION_POLICY_VERSION,
		productionCompilerDefault: 'legacy',
		automaticProductionSwitch: false,
		seedAutoUpdate: false,
		legacyRetentionReleaseCycles,
		stages,
	};
}

export function evaluateSelfhostPromotion(
	policy: SelfhostPromotionPolicyV1,
	evidence: PromotionEvidence,
): PromotionDecision {
	const stage = policy.stages.find(item => item.target === evidence.target);
	if (stage === undefined) throw new Error(`Missing promotion stage: ${evidence.target}`);
	const completedTargets = new Set(evidence.completedTargets);
	const blockers: string[] = [];
	if (stage.dependsOn !== null && !completedTargets.has(stage.dependsOn)) {
		blockers.push(`dependency:${stage.dependsOn}`);
	}
	for (const signal of stage.requiredSignals) {
		if (evidence.signals[signal] !== true) blockers.push(`signal:${signal}`);
	}
	if (evidence.consecutiveNightlySuccesses < stage.minConsecutiveNightlySuccesses) {
		blockers.push(
			`history:nightly:${evidence.consecutiveNightlySuccesses}/${stage.minConsecutiveNightlySuccesses}`,
		);
	}
	if (evidence.observationDays < stage.minObservationDays) {
		blockers.push(`history:days:${evidence.observationDays}/${stage.minObservationDays}`);
	}
	if (stage.manualApprovalRequired && !evidence.manualApproval) blockers.push('approval:manual');
	return {
		target: stage.target,
		eligible: blockers.length === 0,
		automatic: false,
		blockers: blockers.sort(compareText),
	};
}

function parseStage(input: unknown, index: number): PromotionStagePolicy {
	const path = `policy.stages[${index}]`;
	const stage = requireRecord(input, path);
	assertExactKeys(stage, [
		'dependsOn',
		'manualApprovalRequired',
		'minConsecutiveNightlySuccesses',
		'minObservationDays',
		'required',
		'requiredSignals',
		'scope',
		'target',
	], path);
	const target = requirePromotionTarget(stage.target, `${path}.target`);
	const dependsOn = stage.dependsOn === null
		? null
		: requirePromotionTarget(stage.dependsOn, `${path}.dependsOn`);
	if (dependsOn !== null && PROMOTION_TARGETS.indexOf(dependsOn) >= PROMOTION_TARGETS.indexOf(target)) {
		throw new Error(`${path}.dependsOn must reference an earlier target`);
	}
	const scope = requireScope(stage.scope, `${path}.scope`);
	if (typeof stage.required !== 'boolean') throw new Error(`${path}.required must be boolean`);
	if (!Array.isArray(stage.requiredSignals)) throw new Error(`${path}.requiredSignals must be an array`);
	const requiredSignals = stage.requiredSignals.map((value, signalIndex) =>
		requirePromotionSignal(value, `${path}.requiredSignals[${signalIndex}]`));
	assertSortedUnique(requiredSignals, `${path}.requiredSignals`);
	const minConsecutiveNightlySuccesses = requireNonNegativeInteger(
		stage.minConsecutiveNightlySuccesses,
		`${path}.minConsecutiveNightlySuccesses`,
	);
	const minObservationDays = requireNonNegativeInteger(stage.minObservationDays, `${path}.minObservationDays`);
	if (typeof stage.manualApprovalRequired !== 'boolean') {
		throw new Error(`${path}.manualApprovalRequired must be boolean`);
	}
	return {
		target,
		dependsOn,
		scope,
		required: stage.required,
		requiredSignals,
		minConsecutiveNightlySuccesses,
		minObservationDays,
		manualApprovalRequired: stage.manualApprovalRequired,
	};
}

function requirePromotionTarget(value: unknown, path: string): PromotionTarget {
	if (typeof value !== 'string' || !targetSet.has(value)) throw new Error(`${path} is not a promotion target`);
	return value as PromotionTarget;
}

function requirePromotionSignal(value: unknown, path: string): PromotionSignal {
	if (typeof value !== 'string' || !signalSet.has(value)) throw new Error(`${path} is not a promotion signal`);
	return value as PromotionSignal;
}

function requireScope(value: unknown, path: string): PromotionStagePolicy['scope'] {
	const scopes = new Set([
		'pull_request',
		'nightly',
		'selfhost_paths',
		'compiler_paths',
		'internal_opt_in',
		'production_default',
	]);
	if (typeof value !== 'string' || !scopes.has(value)) throw new Error(`${path} is not a valid scope`);
	return value as PromotionStagePolicy['scope'];
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
		throw new Error(`${path} must be a non-negative integer`);
	}
	return value;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort(compareText);
	const sortedExpected = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
		throw new Error(`${path} has unsupported or missing fields`);
	}
}

function assertSortedUnique(values: readonly string[], path: string): void {
	const sorted = [...new Set(values)].sort(compareText);
	if (JSON.stringify(values) !== JSON.stringify(sorted)) {
		throw new Error(`${path} must be sorted and unique`);
	}
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
