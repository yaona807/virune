import { createHash } from 'node:crypto';
import { createPromotionShadowHistoryV2 } from '../packages/compiler/dist/src/selfhost/promotion-shadow-history-v2.js';
import { artifactByExactName } from './selfhost-promotion-github.mjs';

export const PROMOTION_OBSERVATION_WORKFLOW = 'selfhost-promotion-observation.yml';
export const PROMOTION_OBSERVATION_ARTIFACT_PREFIX = 'selfhost-promotion-observation';
export const PROMOTION_OBSERVATION_FILE = 'observation.json';
export const PROMOTION_OBSERVATION_REPORT_SCHEMA_VERSION = 1;
const promotionStage = 'required-selfhost';
const sha256Pattern = /^[0-9a-f]{64}$/u;

export class PromotionObservationArtifactContractError extends Error {
	constructor(path, message) {
		super(`${path}: ${message}`);
		this.name = 'PromotionObservationArtifactContractError';
		this.path = path;
	}
}

export async function createPromotionObservationSnapshots({ reader, inventory, retainedRuns = [] }) {
	if (!Array.isArray(inventory)) throw new TypeError('inventory must be an array');
	if (!Array.isArray(retainedRuns)) throw new TypeError('retainedRuns must be an array');
	const retainedByRunId = new Map(retainedRuns.map(run => [run.runId, run]));
	if (retainedByRunId.size !== retainedRuns.length) throw new Error('retainedRuns contains duplicate run IDs');
	const output = [];
	for (const [runIndex, run] of inventory.entries()) {
		const retained = retainedByRunId.get(run.runId) ?? null;
		if (retained !== null) validateRetainedRunIdentity(retained, run, runIndex);
		if (retained !== null && retained.attempts.length > run.attempts.length) {
			throw new Error(`inventory[${runIndex}]: provider no longer exposes every retained completed attempt`);
		}
		const attempts = [];
		for (const attempt of run.attempts) {
			const retainedAttempt = retained?.attempts[attempt.attempt - 1] ?? null;
			if (retainedAttempt !== null) {
				validateRetainedAttemptMetadata(retainedAttempt, attempt, runIndex);
				attempts.push(retainedAttempt);
				continue;
			}
			const artifactName = `${PROMOTION_OBSERVATION_ARTIFACT_PREFIX}-${run.runId}-${attempt.attempt}`;
			const metadata = artifactByExactName(run.artifacts, artifactName);
			if (metadata === null || metadata.expired) {
				attempts.push({
					attempt: attempt.attempt,
					startedAt: attempt.startedAt,
					completedAt: attempt.completedAt,
					conclusion: attempt.conclusion,
					artifact: null,
					gapReason: missingGapReason(attempt.conclusion),
				});
				continue;
			}
			try {
				const downloaded = await reader.downloadCanonicalJsonArtifact({ artifact: metadata, expectedFileName: PROMOTION_OBSERVATION_FILE });
				const report = parsePromotionObservationReport(downloaded.value);
				const observation = validateEmbeddedObservation(report.observation, run, attempt);
				attempts.push({
					attempt: attempt.attempt,
					startedAt: attempt.startedAt,
					completedAt: attempt.completedAt,
					conclusion: attempt.conclusion,
					artifact: {
						archiveSha256: downloaded.archiveSha256,
						bytesSha256: downloaded.bytesSha256,
						observation,
					},
					gapReason: null,
				});
			} catch (error) {
				if (!(error instanceof Error) || (error.name !== 'PromotionArtifactError' && error.name !== 'PromotionObservationArtifactContractError')) throw error;
				attempts.push({
					attempt: attempt.attempt,
					startedAt: attempt.startedAt,
					completedAt: attempt.completedAt,
					conclusion: attempt.conclusion,
					artifact: null,
					gapReason: 'observation-artifact-invalid',
				});
			}
		}
		if (run.status === 'completed' && attempts.length !== run.runAttempt) {
			throw new Error(`inventory[${runIndex}]: completed run does not contain every attempt`);
		}
		output.push({
			runId: run.runId,
			sequenceAt: run.createdAt,
			executionCommit: run.executionCommit,
			status: run.status,
			runAttempt: run.runAttempt,
			attempts,
		});
	}
	return output;
}

export function parsePromotionObservationReport(value) {
	const report = record(value, 'observation-report');
	exactKeys(report, ['schemaVersion', 'claim', 'productionEligible', 'observationSha256', 'observation'], 'observation-report');
	if (report.schemaVersion !== PROMOTION_OBSERVATION_REPORT_SCHEMA_VERSION) {
		throw new PromotionObservationArtifactContractError('observation-report.schemaVersion', `expected ${PROMOTION_OBSERVATION_REPORT_SCHEMA_VERSION}`);
	}
	if (report.claim !== 'required-selfhost-promotion-observation') {
		throw new PromotionObservationArtifactContractError('observation-report.claim', 'unexpected observation report claim');
	}
	if (report.productionEligible !== false) {
		throw new PromotionObservationArtifactContractError('observation-report.productionEligible', 'observation report must remain non-promotable');
	}
	const claimed = canonicalSha256(report.observationSha256, 'observation-report.observationSha256');
	const observation = record(report.observation, 'observation-report.observation');
	const actual = sha256(JSON.stringify(observation));
	if (actual !== claimed) {
		throw new PromotionObservationArtifactContractError('observation-report.observationSha256', 'does not match canonical embedded observation bytes');
	}
	return { observation, observationSha256: claimed };
}

function validateEmbeddedObservation(value, run, attempt) {
	let canonical;
	try {
		canonical = createPromotionShadowHistoryV2({ version: 2, stage: promotionStage, entries: [value] }).history.entries[0];
	} catch {
		throw new PromotionObservationArtifactContractError('observation-report.observation', 'embedded observation does not satisfy the canonical version 2 schema');
	}
	if (JSON.stringify(canonical) !== JSON.stringify(value)) {
		throw new PromotionObservationArtifactContractError('observation-report.observation', 'embedded observation must already use canonical semantic ordering');
	}
	if (canonical.runId !== run.runId) {
		throw new PromotionObservationArtifactContractError('observation-report.observation.runId', `expected ${run.runId}, received ${canonical.runId}`);
	}
	if (canonical.executionCommit !== run.executionCommit) {
		throw new PromotionObservationArtifactContractError('observation-report.observation.executionCommit', 'must match the provider run execution commit');
	}
	if (canonical.countsTowardPromotion !== true) {
		throw new PromotionObservationArtifactContractError('observation-report.observation.countsTowardPromotion', 'formal scheduled observation must be countable');
	}
	if (canonical.completedAt < attempt.startedAt || canonical.completedAt > attempt.completedAt) {
		throw new PromotionObservationArtifactContractError('observation-report.observation.completedAt', 'must fall within the provider attempt execution interval');
	}
	if (canonical.outcome === 'passed' && attempt.conclusion !== 'success') {
		throw new PromotionObservationArtifactContractError('observation-report.observation.outcome', 'passing observation requires a successful workflow attempt');
	}
	if (canonical.outcome !== 'passed' && attempt.conclusion === 'success') {
		throw new PromotionObservationArtifactContractError('observation-report.observation.outcome', 'failed observation cannot come from a successful workflow attempt');
	}
	return canonical;
}

function validateRetainedRunIdentity(retained, run, runIndex) {
	if (retained.sequenceAt !== run.createdAt || retained.executionCommit !== run.executionCommit) {
		throw new Error(`inventory[${runIndex}]: provider run identity disagrees with retained ledger`);
	}
}

function validateRetainedAttemptMetadata(retained, provider, runIndex) {
	if (
		retained.attempt !== provider.attempt
		|| retained.startedAt !== provider.startedAt
		|| retained.completedAt !== provider.completedAt
		|| retained.conclusion !== provider.conclusion
	) {
		throw new Error(`inventory[${runIndex}].attempts[${provider.attempt - 1}]: provider attempt metadata disagrees with retained ledger`);
	}
}

function missingGapReason(conclusion) {
	if (conclusion === 'cancelled') return 'workflow-cancelled';
	return 'observation-artifact-missing';
}

function record(value, path) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new PromotionObservationArtifactContractError(path, 'expected object');
	}
	return value;
}

function exactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
		throw new PromotionObservationArtifactContractError(path, `expected exactly keys ${wanted.join(', ')}`);
	}
}

function canonicalSha256(value, path) {
	if (typeof value !== 'string' || !sha256Pattern.test(value)) {
		throw new PromotionObservationArtifactContractError(path, 'expected lowercase SHA-256');
	}
	return value;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
