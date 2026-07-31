import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = '.github/self-hosting/promotion-policy-v1.json';
const STAGE_IDS = [
	'pr-informational',
	'nightly-shadow',
	'required-selfhost',
	'required-compiler',
	'production-default',
];
const EXPECTED_BLOCKING = [false, false, true, true, true];
const EXPECTED_SCOPES = ['pull-request', 'nightly', 'selfhost-related', 'compiler-changes', 'production'];
const PRODUCTION_EVIDENCE = [
	'compiler-api-compatibility',
	'interoper-abi-compatibility',
	'release-reproducibility',
	'rollback-smoke',
	'runtime-abi-compatibility',
	'stable-release-cycle',
];

export async function verifySelfhostPromotionPolicy(root = process.cwd()) {
	const path = resolve(root, POLICY_PATH);
	let policy;
	try {
		policy = JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`Unable to read ${POLICY_PATH}: ${formatError(error)}`);
	}
	const errors = [];
	if (!isRecord(policy)) errors.push('policy must be an object');
	if (policy?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
	if (policy?.automaticPromotionAllowed !== false) {
		errors.push('automaticPromotionAllowed must be false');
	}
	const stages = Array.isArray(policy?.stages) ? policy.stages : [];
	if (stages.length !== STAGE_IDS.length) {
		errors.push(`stages must contain exactly ${STAGE_IDS.length} entries`);
	}
	let previousEvidence = new Set();
	let previousRuns = 0;
	let previousDays = 0;
	for (const [index, expectedId] of STAGE_IDS.entries()) {
		const stage = stages[index];
		if (!isRecord(stage)) {
			errors.push(`stages[${index}] must be an object`);
			continue;
		}
		if (stage.id !== expectedId) errors.push(`stages[${index}].id must be ${expectedId}`);
		if (stage.blocking !== EXPECTED_BLOCKING[index]) {
			errors.push(`${expectedId}.blocking must be ${EXPECTED_BLOCKING[index]}`);
		}
		if (stage.scope !== EXPECTED_SCOPES[index]) {
			errors.push(`${expectedId}.scope must be ${EXPECTED_SCOPES[index]}`);
		}
		if (stage.productionDefault !== (expectedId === 'production-default')) {
			errors.push(`${expectedId}.productionDefault is invalid`);
		}
		const evidence = validateEvidence(stage.requiredEvidence, expectedId, errors);
		for (const item of previousEvidence) {
			if (!evidence.has(item)) errors.push(`${expectedId}.requiredEvidence removed ${item}`);
		}
		previousEvidence = evidence;
		const requirements = stage.promotionRequirements;
		if (!isRecord(requirements)) {
			errors.push(`${expectedId}.promotionRequirements must be an object`);
			continue;
		}
		const runs = nonNegativeInteger(
			requirements.minimumConsecutiveSuccessfulRuns,
			`${expectedId}.minimumConsecutiveSuccessfulRuns`,
			errors,
		);
		const days = nonNegativeInteger(
			requirements.minimumObservationDays,
			`${expectedId}.minimumObservationDays`,
			errors,
		);
		nonNegativeInteger(
			requirements.minimumStableReleaseCycles,
			`${expectedId}.minimumStableReleaseCycles`,
			errors,
		);
		if (runs < previousRuns) errors.push(`${expectedId} reduces the successful-run threshold`);
		if (days < previousDays) errors.push(`${expectedId} reduces the observation-day threshold`);
		previousRuns = runs;
		previousDays = days;
		if (requirements.maximumUnexplainedDifferentials !== 0) {
			errors.push(`${expectedId}.maximumUnexplainedDifferentials must be 0`);
		}
		if (index > 0 && requirements.manualApprovalRequired !== true) {
			errors.push(`${expectedId}.manualApprovalRequired must be true`);
		}
		if (stage.blocking && (runs === 0 || days === 0)) {
			errors.push(`${expectedId} requires non-zero observation thresholds`);
		}
		if (expectedId === 'production-default') validateProduction(requirements, evidence, errors);
	}
	if (errors.length > 0) {
		throw new Error(`Self-host promotion policy verification failed:\n${errors.map(item => `- ${item}`).join('\n')}`);
	}
	console.log(`Verified self-host promotion policy v1 with ${stages.length} fail-closed stages.`);
}

function validateEvidence(value, stageId, errors) {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push(`${stageId}.requiredEvidence must be a non-empty array`);
		return new Set();
	}
	const evidence = new Set();
	for (const [index, item] of value.entries()) {
		if (typeof item !== 'string' || item.length === 0) {
			errors.push(`${stageId}.requiredEvidence[${index}] must be a non-empty string`);
			continue;
		}
		if (evidence.has(item)) errors.push(`${stageId}.requiredEvidence contains duplicate ${item}`);
		evidence.add(item);
	}
	return evidence;
}

function validateProduction(requirements, evidence, errors) {
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

function nonNegativeInteger(value, name, errors) {
	if (!Number.isSafeInteger(value) || value < 0) {
		errors.push(`${name} must be a non-negative safe integer`);
		return 0;
	}
	return value;
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(error) {
	return error instanceof Error ? error.message : String(error);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	await verifySelfhostPromotionPolicy(resolve(process.argv[2] ?? '.'));
}
