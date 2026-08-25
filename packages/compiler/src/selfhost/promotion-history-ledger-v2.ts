import { createHash } from 'node:crypto';
import {
	createPromotionShadowHistoryV2,
	type PromotionShadowHistoryEntryInputV2,
	type PromotionShadowHistoryEntryV2,
} from './promotion-shadow-history-v2.js';

export const PROMOTION_HISTORY_LEDGER_VERSION = 2 as const;
export type PromotionHistoryLedgerStageV2 = 'required-selfhost';

export type PromotionHistoryArtifactStateV2 = 'valid' | 'missing' | 'invalid';
export type PromotionHistoryProviderConclusionV2 =
	| 'success'
	| 'failure'
	| 'cancelled'
	| 'skipped'
	| 'timed_out'
	| 'action_required'
	| 'neutral'
	| 'stale'
	| 'startup_failure';
export type PromotionHistoryGapReasonV2 =
	| 'observation-artifact-missing'
	| 'observation-artifact-invalid'
	| 'observation-attempt-incomplete';

export interface PromotionHistoryMigrationV2 {
	readonly sourceHistoryVersion: 1;
	readonly strategy: 'fresh-v2-no-backfill';
	readonly promotionCreditRuns: 0;
	readonly promotionCreditDays: 0;
	readonly reason: 'v1-missing-promotion-subject-closure-and-current-required-evidence';
}

export interface PromotionHistoryFreezeBoundaryV2 {
	readonly runId: string;
	readonly sequenceAt: string;
	readonly executionCommit: string;
}

export interface PromotionHistoryObservationArtifactInputV2 {
	readonly archiveSha256: string;
	readonly bytesSha256: string;
	readonly observation: PromotionShadowHistoryEntryInputV2;
}

export interface PromotionHistoryAttemptInputV2 {
	readonly attempt: number;
	readonly startedAt: string;
	readonly completedAt: string;
	readonly providerConclusion: PromotionHistoryProviderConclusionV2;
	readonly artifactState: PromotionHistoryArtifactStateV2;
	readonly artifact: PromotionHistoryObservationArtifactInputV2 | null;
}

export interface PromotionHistoryRunInputV2 {
	readonly runId: string;
	readonly sequenceAt: string;
	readonly executionCommit: string;
	readonly freezeBoundary: PromotionHistoryFreezeBoundaryV2 | null;
	readonly promotionEffectiveAttemptCount: number;
	readonly attempts: readonly PromotionHistoryAttemptInputV2[];
}

export interface PromotionHistoryLedgerInputV2 {
	readonly version: typeof PROMOTION_HISTORY_LEDGER_VERSION;
	readonly stage: PromotionHistoryLedgerStageV2;
	readonly generation: number;
	readonly parentLedgerSha256: string | null;
	readonly migration: PromotionHistoryMigrationV2;
	readonly runs: readonly PromotionHistoryRunInputV2[];
}

export interface PromotionHistoryObservationArtifactV2
	extends Omit<PromotionHistoryObservationArtifactInputV2, 'observation'> {
	readonly observation: PromotionShadowHistoryEntryV2;
}

export interface PromotionHistoryAttemptV2 extends Omit<PromotionHistoryAttemptInputV2, 'artifact'> {
	readonly artifact: PromotionHistoryObservationArtifactV2 | null;
}

export interface PromotionHistoryRunV2 extends Omit<PromotionHistoryRunInputV2, 'freezeBoundary' | 'attempts'> {
	readonly freezeBoundary: PromotionHistoryFreezeBoundaryV2 | null;
	readonly attempts: readonly PromotionHistoryAttemptV2[];
}

export interface PromotionHistoryLedgerV2 extends Omit<PromotionHistoryLedgerInputV2, 'runs'> {
	readonly runs: readonly PromotionHistoryRunV2[];
}

export interface PromotionHistoryLedgerResultV2 {
	readonly ledger: PromotionHistoryLedgerV2;
	readonly serialized: string;
	readonly sha256: string;
}

export type PromotionHistoryEffectiveRunV2 =
	| {
		readonly kind: 'observation';
		readonly runId: string;
		readonly sequenceAt: string;
		readonly executionCommit: string;
		readonly freezeBoundary: PromotionHistoryFreezeBoundaryV2 | null;
		readonly observation: PromotionShadowHistoryEntryV2;
	}
	| {
		readonly kind: 'gap';
		readonly runId: string;
		readonly sequenceAt: string;
		readonly executionCommit: string;
		readonly freezeBoundary: PromotionHistoryFreezeBoundaryV2 | null;
		readonly reason: PromotionHistoryGapReasonV2;
		readonly providerConclusion: PromotionHistoryProviderConclusionV2 | null;
		readonly artifactState: Exclude<PromotionHistoryArtifactStateV2, 'valid'> | null;
	};

export class PromotionHistoryLedgerError extends Error {
	public override readonly name = 'PromotionHistoryLedgerError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const gitShaPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const runIdPattern = /^[1-9][0-9]*$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const providerConclusions = new Set<PromotionHistoryProviderConclusionV2>([
	'success', 'failure', 'cancelled', 'skipped', 'timed_out', 'action_required', 'neutral', 'stale', 'startup_failure',
]);
const migrationContract: PromotionHistoryMigrationV2 = Object.freeze({
	sourceHistoryVersion: 1,
	strategy: 'fresh-v2-no-backfill',
	promotionCreditRuns: 0,
	promotionCreditDays: 0,
	reason: 'v1-missing-promotion-subject-closure-and-current-required-evidence',
});

export function promotionHistoryMigrationV2(): PromotionHistoryMigrationV2 {
	return { ...migrationContract };
}

export function parsePromotionHistoryLedgerV2(value: unknown): PromotionHistoryLedgerResultV2 {
	const input = record(value, '$');
	exactKeys(input, ['version', 'stage', 'generation', 'parentLedgerSha256', 'migration', 'runs'], '$');
	literal(input.version, PROMOTION_HISTORY_LEDGER_VERSION, '$.version');
	const stage = promotionStage(input.stage, '$.stage');
	const generation = positiveSafeInteger(input.generation, '$.generation');
	const parentLedgerSha256 = nullableSha256(input.parentLedgerSha256, '$.parentLedgerSha256');
	if (generation === 1 && parentLedgerSha256 !== null) {
		throw new PromotionHistoryLedgerError('$.parentLedgerSha256', 'genesis ledger must not have a parent');
	}
	if (generation > 1 && parentLedgerSha256 === null) {
		throw new PromotionHistoryLedgerError('$.parentLedgerSha256', 'non-genesis ledger must identify its parent');
	}
	const migration = parseMigration(input.migration, '$.migration');
	const seenRunIds = new Set<string>();
	const runs = array(input.runs, '$.runs').map((run, index) => parseRun(run, index, stage, seenRunIds));
	validateRunOrderAndFreezeBoundaries(runs);
	const ledger: PromotionHistoryLedgerV2 = {
		version: PROMOTION_HISTORY_LEDGER_VERSION,
		stage,
		generation,
		parentLedgerSha256,
		migration,
		runs,
	};
	const serialized = JSON.stringify(ledger);
	return { ledger, serialized, sha256: sha256(serialized) };
}

export function createPromotionHistoryLedgerV2(value: unknown, parentValue?: unknown): PromotionHistoryLedgerResultV2 {
	if (parentValue === undefined) {
		const child = parsePromotionHistoryLedgerV2(value);
		if (child.ledger.generation !== 1) {
			throw new PromotionHistoryLedgerError('$.generation', 'a non-genesis ledger requires its parent for lineage validation');
		}
		return child;
	}
	const parent = parsePromotionHistoryLedgerV2(parentValue);
	validateLateAuditAttemptsBeforeChildParse(value, parent.ledger);
	const child = parsePromotionHistoryLedgerV2(value);
	validateLineage(child.ledger, parent);
	return child;
}

export function effectivePromotionHistoryRunsV2(value: PromotionHistoryLedgerV2 | unknown): readonly PromotionHistoryEffectiveRunV2[] {
	const ledger = parsePromotionHistoryLedgerV2(value).ledger;
	return ledger.runs.map((run, index) => effectiveRun(run, `$.runs[${index}]`));
}

function parseMigration(value: unknown, path: string): PromotionHistoryMigrationV2 {
	const migration = record(value, path);
	exactKeys(migration, ['sourceHistoryVersion', 'strategy', 'promotionCreditRuns', 'promotionCreditDays', 'reason'], path);
	return {
		sourceHistoryVersion: literalValue(migration.sourceHistoryVersion, 1, `${path}.sourceHistoryVersion`),
		strategy: literalValue(migration.strategy, 'fresh-v2-no-backfill', `${path}.strategy`),
		promotionCreditRuns: literalValue(migration.promotionCreditRuns, 0, `${path}.promotionCreditRuns`),
		promotionCreditDays: literalValue(migration.promotionCreditDays, 0, `${path}.promotionCreditDays`),
		reason: literalValue(migration.reason, 'v1-missing-promotion-subject-closure-and-current-required-evidence', `${path}.reason`),
	};
}

function parseRun(
	value: unknown,
	index: number,
	stage: PromotionHistoryLedgerStageV2,
	seenRunIds: Set<string>,
): PromotionHistoryRunV2 {
	const path = `$.runs[${index}]`;
	const run = record(value, path);
	exactKeys(run, [
		'runId', 'sequenceAt', 'executionCommit', 'freezeBoundary', 'promotionEffectiveAttemptCount', 'attempts',
	], path);
	const runId = canonicalRunId(run.runId, `${path}.runId`);
	if (seenRunIds.has(runId)) throw new PromotionHistoryLedgerError(`${path}.runId`, `duplicate runId ${runId}`);
	seenRunIds.add(runId);
	const sequenceAt = canonicalTimestamp(run.sequenceAt, `${path}.sequenceAt`);
	const executionCommit = canonicalGitSha(run.executionCommit, `${path}.executionCommit`);
	const freezeBoundary = run.freezeBoundary === null
		? null
		: parseFreezeBoundary(run.freezeBoundary, `${path}.freezeBoundary`, { runId, sequenceAt }, seenRunIds);
	const attempts = array(run.attempts, `${path}.attempts`).map((attempt, attemptIndex) => parseAttempt(
		attempt,
		`${path}.attempts[${attemptIndex}]`,
		attemptIndex + 1,
		stage,
		runId,
		executionCommit,
	));
	if (attempts.length === 0) throw new PromotionHistoryLedgerError(`${path}.attempts`, 'at least one completed provider attempt is required');
	if (attempts[0]!.startedAt < sequenceAt) {
		throw new PromotionHistoryLedgerError(`${path}.attempts[0].startedAt`, 'first provider attempt cannot start before the formal run sequence time');
	}
	for (let attemptIndex = 1; attemptIndex < attempts.length; attemptIndex += 1) {
		if (attempts[attemptIndex]!.startedAt < attempts[attemptIndex - 1]!.completedAt) {
			throw new PromotionHistoryLedgerError(`${path}.attempts[${attemptIndex}].startedAt`, 'rerun attempt cannot start before the previous attempt completed');
		}
	}
	const promotionEffectiveAttemptCount = nonNegativeSafeInteger(
		run.promotionEffectiveAttemptCount,
		`${path}.promotionEffectiveAttemptCount`,
	);
	const expectedEffectiveCount = freezeBoundary === null
		? attempts.length
		: attempts.filter(attempt => attempt.completedAt < freezeBoundary.sequenceAt).length;
	if (promotionEffectiveAttemptCount !== expectedEffectiveCount) {
		throw new PromotionHistoryLedgerError(
			`${path}.promotionEffectiveAttemptCount`,
			`expected ${expectedEffectiveCount} from the canonical freeze boundary`,
		);
	}
	const parsed: PromotionHistoryRunV2 = {
		runId,
		sequenceAt,
		executionCommit,
		freezeBoundary,
		promotionEffectiveAttemptCount,
		attempts,
	};
	effectiveRun(parsed, path);
	return parsed;
}

function parseFreezeBoundary(
	value: unknown,
	path: string,
	current: { readonly runId: string; readonly sequenceAt: string },
	seenRunIds: ReadonlySet<string>,
): PromotionHistoryFreezeBoundaryV2 {
	const boundary = record(value, path);
	exactKeys(boundary, ['runId', 'sequenceAt', 'executionCommit'], path);
	const runId = canonicalRunId(boundary.runId, `${path}.runId`);
	const sequenceAt = canonicalTimestamp(boundary.sequenceAt, `${path}.sequenceAt`);
	const executionCommit = canonicalGitSha(boundary.executionCommit, `${path}.executionCommit`);
	if (seenRunIds.has(runId)) {
		throw new PromotionHistoryLedgerError(`${path}.runId`, 'freeze boundary must identify a new logical run');
	}
	if (compareRunKey({ runId, sequenceAt }, current) <= 0) {
		throw new PromotionHistoryLedgerError(path, 'freeze boundary must identify a strictly later formal run');
	}
	return { runId, sequenceAt, executionCommit };
}

function parseAttempt(
	value: unknown,
	path: string,
	expectedAttempt: number,
	stage: PromotionHistoryLedgerStageV2,
	runId: string,
	executionCommit: string,
): PromotionHistoryAttemptV2 {
	const attempt = record(value, path);
	exactKeys(attempt, ['attempt', 'startedAt', 'completedAt', 'providerConclusion', 'artifactState', 'artifact'], path);
	const attemptNumber = positiveSafeInteger(attempt.attempt, `${path}.attempt`);
	if (attemptNumber !== expectedAttempt) {
		throw new PromotionHistoryLedgerError(`${path}.attempt`, `expected contiguous attempt ${expectedAttempt}, received ${attemptNumber}`);
	}
	const startedAt = canonicalTimestamp(attempt.startedAt, `${path}.startedAt`);
	const completedAt = canonicalTimestamp(attempt.completedAt, `${path}.completedAt`);
	if (completedAt < startedAt) throw new PromotionHistoryLedgerError(`${path}.completedAt`, 'must not precede startedAt');
	const providerConclusion = providerConclusionValue(attempt.providerConclusion, `${path}.providerConclusion`);
	const artifactState = artifactStateValue(attempt.artifactState, `${path}.artifactState`);
	const artifact = attempt.artifact === null
		? null
		: parseArtifact(attempt.artifact, `${path}.artifact`, stage, runId, executionCommit, startedAt, completedAt);
	if (artifactState === 'valid' && artifact === null) {
		throw new PromotionHistoryLedgerError(path, 'valid artifactState requires a canonical observation artifact');
	}
	if (artifactState !== 'valid' && artifact !== null) {
		throw new PromotionHistoryLedgerError(path, 'missing/invalid artifactState must not carry a trusted observation artifact');
	}
	if (artifact?.observation.outcome === 'passed' && providerConclusion !== 'success') {
		throw new PromotionHistoryLedgerError(`${path}.providerConclusion`, 'passing observation requires a successful workflow attempt');
	}
	if (artifact?.observation.outcome === 'product-failed' && providerConclusion !== 'failure') {
		throw new PromotionHistoryLedgerError(`${path}.providerConclusion`, 'product-failed observation requires a failed workflow attempt');
	}
	return { attempt: attemptNumber, startedAt, completedAt, providerConclusion, artifactState, artifact };
}

function parseArtifact(
	value: unknown,
	path: string,
	stage: PromotionHistoryLedgerStageV2,
	runId: string,
	executionCommit: string,
	startedAt: string,
	completedAt: string,
): PromotionHistoryObservationArtifactV2 {
	const artifact = record(value, path);
	exactKeys(artifact, ['archiveSha256', 'bytesSha256', 'observation'], path);
	const archiveSha256 = canonicalSha256(artifact.archiveSha256, `${path}.archiveSha256`);
	const bytesSha256 = canonicalSha256(artifact.bytesSha256, `${path}.bytesSha256`);
	const canonical = createPromotionShadowHistoryV2({ version: 2, stage, entries: [artifact.observation] }).history.entries[0]!;
	if (canonical.runId !== runId) throw new PromotionHistoryLedgerError(`${path}.observation.runId`, `expected ${runId}, received ${canonical.runId}`);
	if (canonical.executionCommit !== executionCommit) {
		throw new PromotionHistoryLedgerError(`${path}.observation.executionCommit`, 'must match the provider execution commit');
	}
	if (!canonical.countsTowardPromotion) {
		throw new PromotionHistoryLedgerError(`${path}.observation.countsTowardPromotion`, 'formal ledger observation must be countable');
	}
	if (canonical.outcome !== 'passed' && canonical.outcome !== 'product-failed') {
		throw new PromotionHistoryLedgerError(`${path}.observation.outcome`, 'canonical Promotion Observation may only prove passed or product-failed');
	}
	if (canonical.completedAt < startedAt || canonical.completedAt > completedAt) {
		throw new PromotionHistoryLedgerError(`${path}.observation.completedAt`, 'must fall within the provider attempt execution interval');
	}
	const expectedBytesSha256 = canonicalObservationReportSha256(canonical);
	if (bytesSha256 !== expectedBytesSha256) {
		throw new PromotionHistoryLedgerError(`${path}.bytesSha256`, `expected canonical Promotion Observation report SHA-256 ${expectedBytesSha256}`);
	}
	return { archiveSha256, bytesSha256, observation: canonical };
}

function canonicalObservationReportSha256(observation: PromotionShadowHistoryEntryV2): string {
	const observationSerialized = JSON.stringify(observation);
	const report = {
		schemaVersion: 1,
		claim: 'required-selfhost-promotion-observation',
		productionEligible: false,
		observationSha256: sha256(observationSerialized),
		observation,
	};
	return sha256(JSON.stringify(report));
}

function validateRunOrderAndFreezeBoundaries(runs: readonly PromotionHistoryRunV2[]): void {
	for (let index = 1; index < runs.length; index += 1) {
		if (compareRunKey(runs[index - 1]!, runs[index]!) >= 0) {
			throw new PromotionHistoryLedgerError(`$.runs[${index}]`, 'runs must be strictly ordered by sequenceAt and numeric runId');
		}
	}
	for (let index = 0; index < runs.length - 1; index += 1) {
		const boundary = runs[index]!.freezeBoundary;
		if (boundary === null) {
			throw new PromotionHistoryLedgerError(`$.runs[${index}].freezeBoundary`, 'a run before another formal run must be frozen');
		}
		const next = runs[index + 1]!;
		if (boundary.runId !== next.runId || boundary.sequenceAt !== next.sequenceAt || boundary.executionCommit !== next.executionCommit) {
			throw new PromotionHistoryLedgerError(`$.runs[${index}].freezeBoundary`, 'must identify the immediately following formal run');
		}
	}
}

function validateLateAuditAttemptsBeforeChildParse(value: unknown, parent: PromotionHistoryLedgerV2): void {
	const child = record(value, '$');
	const childRuns = array(child.runs, '$.runs');
	for (let index = 0; index < Math.min(parent.runs.length, childRuns.length); index += 1) {
		const parentRun = parent.runs[index]!;
		if (parentRun.freezeBoundary === null) continue;
		const childPath = `$.runs[${index}]`;
		const childRun = record(childRuns[index], childPath);
		if (
			childRun.runId !== parentRun.runId
			|| childRun.sequenceAt !== parentRun.sequenceAt
			|| childRun.executionCommit !== parentRun.executionCommit
		) continue;
		const childAttempts = array(childRun.attempts, `${childPath}.attempts`);
		for (let attemptIndex = parentRun.attempts.length; attemptIndex < childAttempts.length; attemptIndex += 1) {
			const attemptPath = `${childPath}.attempts[${attemptIndex}]`;
			const attempt = record(childAttempts[attemptIndex], attemptPath);
			const completedAt = canonicalTimestamp(attempt.completedAt, `${attemptPath}.completedAt`);
			if (completedAt < parentRun.freezeBoundary.sequenceAt) {
				throw new PromotionHistoryLedgerError(`${childPath}.attempts`, 'late audit attempt contradicts the retained freeze boundary');
			}
		}
	}
}

function validateLineage(child: PromotionHistoryLedgerV2, parent: PromotionHistoryLedgerResultV2): void {
	if (child.stage !== parent.ledger.stage) throw new PromotionHistoryLedgerError('$.stage', 'child stage must match parent stage');
	if (child.generation !== parent.ledger.generation + 1) {
		throw new PromotionHistoryLedgerError('$.generation', `expected ${parent.ledger.generation + 1}`);
	}
	if (child.parentLedgerSha256 !== parent.sha256) {
		throw new PromotionHistoryLedgerError('$.parentLedgerSha256', `expected ${parent.sha256}`);
	}
	if (JSON.stringify(child.migration) !== JSON.stringify(parent.ledger.migration)) {
		throw new PromotionHistoryLedgerError('$.migration', 'migration decision is immutable after genesis');
	}
	if (child.runs.length < parent.ledger.runs.length) throw new PromotionHistoryLedgerError('$.runs', 'child ledger cannot remove retained runs');
	for (let index = 0; index < parent.ledger.runs.length; index += 1) {
		validateRunExtension(parent.ledger.runs[index]!, child.runs[index]!, `$.runs[${index}]`);
	}
}

function validateRunExtension(parent: PromotionHistoryRunV2, child: PromotionHistoryRunV2, path: string): void {
	if (parent.runId !== child.runId || parent.sequenceAt !== child.sequenceAt || parent.executionCommit !== child.executionCommit) {
		throw new PromotionHistoryLedgerError(path, 'retained logical run identity cannot change');
	}
	if (parent.attempts.length > child.attempts.length) throw new PromotionHistoryLedgerError(`${path}.attempts`, 'child cannot remove retained attempts');
	for (let index = 0; index < parent.attempts.length; index += 1) {
		if (JSON.stringify(parent.attempts[index]) !== JSON.stringify(child.attempts[index])) {
			throw new PromotionHistoryLedgerError(`${path}.attempts[${index}]`, 'retained attempt is immutable');
		}
	}
	if (
		parent.freezeBoundary === null
		&& child.freezeBoundary !== null
		&& child.promotionEffectiveAttemptCount < parent.promotionEffectiveAttemptCount
	) {
		throw new PromotionHistoryLedgerError(
			`${path}.promotionEffectiveAttemptCount`,
			'a new freeze boundary cannot demote retained promotion-effective attempts',
		);
	}
	if (parent.freezeBoundary !== null) {
		if (JSON.stringify(parent.freezeBoundary) !== JSON.stringify(child.freezeBoundary)) {
			throw new PromotionHistoryLedgerError(`${path}.freezeBoundary`, 'frozen boundary is immutable');
		}
		for (const attempt of child.attempts.slice(parent.attempts.length)) {
			if (attempt.completedAt < parent.freezeBoundary.sequenceAt) {
				throw new PromotionHistoryLedgerError(`${path}.attempts`, 'late audit attempt contradicts the retained freeze boundary');
			}
		}
		if (parent.promotionEffectiveAttemptCount !== child.promotionEffectiveAttemptCount) {
			throw new PromotionHistoryLedgerError(`${path}.promotionEffectiveAttemptCount`, 'frozen promotion-effective prefix is immutable');
		}
	}
}

function effectiveRun(run: PromotionHistoryRunV2, path: string): PromotionHistoryEffectiveRunV2 {
	const effectiveAttempts = run.attempts.slice(0, run.promotionEffectiveAttemptCount);
	if (effectiveAttempts.length === 0) {
		return {
			kind: 'gap', runId: run.runId, sequenceAt: run.sequenceAt, executionCommit: run.executionCommit,
			freezeBoundary: run.freezeBoundary, reason: 'observation-attempt-incomplete', providerConclusion: null, artifactState: null,
		};
	}
	const validObservations = effectiveAttempts
		.filter(attempt => attempt.artifact !== null)
		.map(attempt => attempt.artifact!.observation);
	const subjects = new Set(validObservations.map(observation => observation.promotionSubjectId));
	if (subjects.size > 1) {
		throw new PromotionHistoryLedgerError(`${path}.attempts`, 'promotion-effective observation attempts contradict on promotionSubjectId');
	}
	const productFailures = validObservations.filter(observation => observation.outcome === 'product-failed');
	if (productFailures.length > 0) {
		return {
			kind: 'observation', runId: run.runId, sequenceAt: run.sequenceAt, executionCommit: run.executionCommit,
			freezeBoundary: run.freezeBoundary, observation: productFailures.at(-1)!,
		};
	}
	const latest = effectiveAttempts.at(-1)!;
	if (latest.artifact !== null) {
		return {
			kind: 'observation', runId: run.runId, sequenceAt: run.sequenceAt, executionCommit: run.executionCommit,
			freezeBoundary: run.freezeBoundary, observation: latest.artifact.observation,
		};
	}
	if (latest.artifactState === 'valid') {
		throw new PromotionHistoryLedgerError(
			`${path}.attempts[${run.promotionEffectiveAttemptCount - 1}].artifactState`,
			'gap attempt cannot retain valid artifact state without a trusted artifact',
		);
	}
	return {
		kind: 'gap', runId: run.runId, sequenceAt: run.sequenceAt, executionCommit: run.executionCommit,
		freezeBoundary: run.freezeBoundary,
		reason: latest.artifactState === 'invalid' ? 'observation-artifact-invalid' : 'observation-artifact-missing',
		providerConclusion: latest.providerConclusion,
		artifactState: latest.artifactState,
	};
}

function promotionStage(value: unknown, path: string): PromotionHistoryLedgerStageV2 {
	if (value === 'required-selfhost') return value;
	throw new PromotionHistoryLedgerError(path, 'initial Promotion History Ledger v2 only supports required-selfhost');
}

function providerConclusionValue(value: unknown, path: string): PromotionHistoryProviderConclusionV2 {
	if (typeof value === 'string' && providerConclusions.has(value as PromotionHistoryProviderConclusionV2)) {
		return value as PromotionHistoryProviderConclusionV2;
	}
	throw new PromotionHistoryLedgerError(path, 'invalid completed GitHub Actions conclusion');
}

function artifactStateValue(value: unknown, path: string): PromotionHistoryArtifactStateV2 {
	if (value === 'valid' || value === 'missing' || value === 'invalid') return value;
	throw new PromotionHistoryLedgerError(path, 'invalid artifact state');
}

function canonicalTimestamp(value: unknown, path: string): string {
	if (typeof value !== 'string' || !timestampPattern.test(value)) {
		throw new PromotionHistoryLedgerError(path, 'expected canonical UTC ISO timestamp');
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
		throw new PromotionHistoryLedgerError(path, 'expected canonical UTC ISO timestamp');
	}
	return value;
}

function canonicalRunId(value: unknown, path: string): string {
	if (typeof value !== 'string' || !runIdPattern.test(value)) {
		throw new PromotionHistoryLedgerError(path, 'expected canonical positive decimal GitHub run ID');
	}
	return value;
}

function canonicalGitSha(value: unknown, path: string): string {
	if (typeof value !== 'string' || !gitShaPattern.test(value)) {
		throw new PromotionHistoryLedgerError(path, 'expected lowercase 40-character Git SHA');
	}
	return value;
}

function nullableSha256(value: unknown, path: string): string | null {
	if (value === null) return null;
	return canonicalSha256(value, path);
}

function canonicalSha256(value: unknown, path: string): string {
	if (typeof value !== 'string' || !sha256Pattern.test(value)) {
		throw new PromotionHistoryLedgerError(path, 'expected lowercase 64-character SHA-256');
	}
	return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new PromotionHistoryLedgerError(path, 'expected a positive safe integer');
	return value as number;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new PromotionHistoryLedgerError(path, 'expected a non-negative safe integer');
	return value as number;
}

function literal(value: unknown, expected: number, path: string): void {
	if (value !== expected) throw new PromotionHistoryLedgerError(path, `expected ${expected}`);
}

function literalValue<T extends string | number>(value: unknown, expected: T, path: string): T {
	if (value !== expected) throw new PromotionHistoryLedgerError(path, `expected ${String(expected)}`);
	return expected;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PromotionHistoryLedgerError(path, 'expected an object');
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new PromotionHistoryLedgerError(path, 'expected an array');
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
		throw new PromotionHistoryLedgerError(path, `expected exactly keys ${wanted.join(', ')}`);
	}
}

function compareRunKey(
	left: { readonly sequenceAt: string; readonly runId: string },
	right: { readonly sequenceAt: string; readonly runId: string },
): number {
	const timestampOrder = compareText(left.sequenceAt, right.sequenceAt);
	if (timestampOrder !== 0) return timestampOrder;
	const leftId = BigInt(left.runId);
	const rightId = BigInt(right.runId);
	return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
