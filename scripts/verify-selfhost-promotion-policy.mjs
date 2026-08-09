import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = '.github/self-hosting/promotion-policy-v1.json';
const STAGES = [
	['pr-informational', false, 'pull-request', 0, 0],
	['nightly-shadow', false, 'nightly', 0, 0],
	['required-selfhost', true, 'selfhost-related', 14, 14],
	['required-compiler', true, 'compiler-changes', 28, 28],
	['production-default', true, 'production', 30, 30],
];
const CURRENT_FIXED_POINT_EVIDENCE = Object.freeze([
	'clean-bootstrap',
	'environment-perturbation',
	'fixed-seed-verification',
	'independent-runner-reproducibility',
	'stage1-stage2-transition',
	'stage2-stage3-fixed-point',
]);
const REQUIRED_SELFHOST_EVIDENCE = Object.freeze([
	'cross-evidence-generation-binding',
	'exact-head-evidence-binding',
	'legacy-rollback',
]);
const PRODUCTION_EVIDENCE = [
	'compiler-api-compatibility',
	['interop', 'abi', 'compatibility'].join('-'),
	'release-reproducibility',
	'rollback-smoke',
	'runtime-abi-compatibility',
	'stable-release-cycle',
];

export async function verifySelfhostPromotionPolicy(root = process.cwd()) {
	const policy = await loadPolicy(root);
	const errors = [];
	if (!isRecord(policy)) errors.push('policy must be an object');
	if (policy?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
	if (policy?.automaticPromotionAllowed !== false) errors.push('automaticPromotionAllowed must be false');
	const stages = Array.isArray(policy?.stages) ? policy.stages : [];
	if (stages.length !== STAGES.length) errors.push(`stages must contain exactly ${STAGES.length} entries`);

	let previousEvidence = new Set();
	let previousRuns = 0;
	let previousDays = 0;
	for (const [index, [id, blocking, scope, minimumRuns, minimumDays]] of STAGES.entries()) {
		const stage = stages[index];
		if (!isRecord(stage)) {
			errors.push(`stages[${index}] must be an object`);
			continue;
		}
		if (stage.id !== id) errors.push(`stages[${index}].id must be ${id}`);
		if (stage.blocking !== blocking) errors.push(`${id}.blocking must be ${blocking}`);
		if (stage.scope !== scope) errors.push(`${id}.scope must be ${scope}`);
		if (stage.productionDefault !== (id === 'production-default')) errors.push(`${id}.productionDefault is invalid`);

		const evidence = evidenceSet(stage.requiredEvidence, id, errors);
		if (evidence.has('stage1-stage2')) {
			errors.push(`${id}.requiredEvidence contains obsolete stage1-stage2 equality evidence`);
		}
		for (const item of previousEvidence) {
			if (!evidence.has(item)) errors.push(`${id}.requiredEvidence removed ${item}`);
		}
		if (index >= 1) requireEvidence(evidence, CURRENT_FIXED_POINT_EVIDENCE, id, errors);
		if (index >= 2) requireEvidence(evidence, REQUIRED_SELFHOST_EVIDENCE, id, errors);
		previousEvidence = evidence;

		const requirements = stage.promotionRequirements;
		if (!isRecord(requirements)) {
			errors.push(`${id}.promotionRequirements must be an object`);
			continue;
		}
		const runs = integer(requirements.minimumConsecutiveSuccessfulRuns, `${id}.minimumConsecutiveSuccessfulRuns`, errors);
		const days = integer(requirements.minimumObservationDays, `${id}.minimumObservationDays`, errors);
		integer(requirements.minimumStableReleaseCycles, `${id}.minimumStableReleaseCycles`, errors);
		if (runs < minimumRuns) {
			errors.push(`${id}.minimumConsecutiveSuccessfulRuns must be at least ${minimumRuns}`);
		}
		if (days < minimumDays) {
			errors.push(`${id}.minimumObservationDays must be at least ${minimumDays}`);
		}
		if (runs < previousRuns) errors.push(`${id} reduces the successful-run threshold`);
		if (days < previousDays) errors.push(`${id} reduces the observation-day threshold`);
		previousRuns = runs;
		previousDays = days;
		if (requirements.maximumUnexplainedDifferentials !== 0) {
			errors.push(`${id}.maximumUnexplainedDifferentials must be 0`);
		}
		if (index > 0 && requirements.manualApprovalRequired !== true) {
			errors.push(`${id}.manualApprovalRequired must be true`);
		}
		if (blocking && (runs === 0 || days === 0)) errors.push(`${id} requires non-zero observation thresholds`);
		if (id === 'production-default') verifyProduction(requirements, evidence, errors);
	}
	if (errors.length > 0) {
		throw new Error(`Self-host promotion policy verification failed:\n${errors.map(item => `- ${item}`).join('\n')}`);
	}
	console.log(`Verified self-host promotion policy v1 with ${stages.length} fail-closed stages.`);
}

async function loadPolicy(root) {
	try {
		return JSON.parse(await readFile(resolve(root, POLICY_PATH), 'utf8'));
	} catch (error) {
		throw new Error(`Unable to read ${POLICY_PATH}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function evidenceSet(value, id, errors) {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push(`${id}.requiredEvidence must be a non-empty array`);
		return new Set();
	}
	const evidence = new Set();
	for (const [index, item] of value.entries()) {
		if (typeof item !== 'string' || item.length === 0) {
			errors.push(`${id}.requiredEvidence[${index}] must be a non-empty string`);
		} else if (evidence.has(item)) {
			errors.push(`${id}.requiredEvidence contains duplicate ${item}`);
		} else {
			evidence.add(item);
		}
	}
	return evidence;
}

function requireEvidence(evidence, required, id, errors) {
	for (const item of required) {
		if (!evidence.has(item)) errors.push(`${id}.requiredEvidence must include ${item}`);
	}
}

function verifyProduction(requirements, evidence, errors) {
	if (requirements.rollbackEvidenceRequired !== true) {
		errors.push('production-default.rollbackEvidenceRequired must be true');
	}
	if (!Number.isSafeInteger(requirements.minimumStableReleaseCycles)
		|| requirements.minimumStableReleaseCycles < 1) {
		errors.push('production-default.minimumStableReleaseCycles must be at least 1');
	}
	for (const item of PRODUCTION_EVIDENCE) {
		if (!evidence.has(item)) errors.push(`production-default.requiredEvidence must include ${item}`);
	}
}

function integer(value, name, errors) {
	if (!Number.isSafeInteger(value) || value < 0) {
		errors.push(`${name} must be a non-negative safe integer`);
		return 0;
	}
	return value;
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	await verifySelfhostPromotionPolicy(resolve(process.argv[2] ?? '.'));
}
