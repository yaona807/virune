import { createHash } from 'node:crypto';
import {
	createPromotionShadowHistoryV2,
	type PromotionShadowHistoryEntryInputV2,
	type PromotionShadowHistoryEntryV2,
} from './promotion-shadow-history-v2.js';
import type { PromotionSubjectStage } from './promotion-subject.js';

export const PROMOTION_HISTORY_LEDGER_VERSION = 2 as const;

export type PromotionHistoryGapReasonV2 =
	| 'observation-artifact-missing'
	| 'observation-artifact-invalid'
	| 'observation-source-invalid'
	| 'observation-attempt-incomplete'
	| 'workflow-infrastructure-failed'
	| 'workflow-cancelled';

export interface PromotionHistoryMigrationV2 {
	readonly sourceHistoryVersion: 1;
	readonly strategy: 'fresh-v2-no-backfill';
	readonly promotionCreditRuns: 0;
	readonly promotionCreditDays: 0;
	readonly reason: 'v1-missing-promotion-subject-closure-and-current-required-evidence';
}

export interface PromotionHistoryObservationArtifactV2 {
	readonly archiveSha256: string;
	readonly bytesSha256: string;
	readonly observation: PromotionShadowHistoryEntryInputV2;
}

export interface PromotionHistoryAttemptInputV2 {
	readonly attempt: number;
	readonly startedAt: string;
	readonly completedAt: string;
	readonly conclusion: string;
	readonly artifact: PromotionHistoryObservationArtifactV2 | null;
	readonly gapReason: PromotionHistoryGapReasonV2 | null;
}

export interface PromotionHistoryRunInputV2 {
	readonly runId: string;
	readonly sequenceAt: string;
	readonly executionCommit: string;
	readonly frozen: boolean;
	readonly promotionEffectiveAttemptCount?: number;
	readonly attempts: readonly PromotionHistoryAttemptInputV2[];
}

export interface PromotionHistoryLedgerInputV2 {
	readonly version: typeof PROMOTION_HISTORY_LEDGER_VERSION;
	readonly stage: PromotionSubjectStage;
	readonly generation: number;
	readonly parentLedgerSha256: string | null;
	readonly migration: PromotionHistoryMigrationV2;
	readonly runs: readonly PromotionHistoryRunInputV2[];
}

export interface PromotionHistoryObservationArtifactCanonicalV2
	extends Omit<PromotionHistoryObservationArtifactV2, 'observation'> {
	readonly observation: PromotionShadowHistoryEntryV2;
}

export interface PromotionHistoryAttemptV2 extends Omit<PromotionHistoryAttemptInputV2, 'artifact'> {
	readonly artifact: PromotionHistoryObservationArtifactCanonicalV2 | null;
}

export interface PromotionHistoryRunV2 extends Omit<PromotionHistoryRunInputV2, 'attempts' | 'promotionEffectiveAttemptCount'> {
	readonly promotionEffectiveAttemptCount: number;
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
		readonly frozen: boolean;
		readonly observation: PromotionShadowHistoryEntryV2;
	}
	| {
		readonly kind: 'gap';
		readonly runId: string;
		readonly sequenceAt: string;
		readonly frozen: boolean;
		readonly reason: PromotionHistoryGapReasonV2;
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
const evidenceGapReasons = new Set<PromotionHistoryGapReasonV2>([
	'observation-artifact-missing',
	'observation-artifact-invalid',
	'observation-source-invalid',
	'observation-attempt-incomplete',
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
	if (generation === 1 && parentLedgerSha256 !== null) throw new PromotionHistoryLedgerError('$.parentLedgerSha256', 'genesis ledger must not have a parent');
	if (generation > 1 && parentLedgerSha256 === null) throw new PromotionHistoryLedgerError('$.parentLedgerSha256', 'non-genesis ledger must identify its parent');
	const migration = parseMigration(input.migration, '$.migration');
	const seenRunIds = new Set<string>();
	const runs = array(input.runs, '$.runs').map((run, index) => parseRun(run, index, stage, seenRunIds));
	validateRunOrderAndFreeze(runs);
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
	const child = parsePromotionHistoryLedgerV2(value);
	if (parentValue === undefined) {
		if (child.ledger.generation !== 1) throw new PromotionHistoryLedgerError('$.generation', 'a non-genesis ledger requires its parent for lineage validation');
		return child;
	}
	const parent = parsePromotionHistoryLedgerV2(parentValue);
	validateLineage(child.ledger, parent);
	return child;
}

export function effectivePromotionHistoryRunsV2(value: PromotionHistoryLedgerV2 | unknown): readonly PromotionHistoryEffectiveRunV2[] {
	return parsePromotionHistoryLedgerV2(value).ledger.runs.map(effectiveRun);
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

function parseRun(value: unknown, index: number, stage: PromotionSubjectStage, seenRunIds: Set<string>): PromotionHistoryRunV2 {
	const path = `$.runs[${index}]`;
	const runValue = record(value, path);
	exactKeysWithOptional(runValue, ['runId', 'sequenceAt', 'executionCommit', 'frozen', 'attempts'], ['promotionEffectiveAttemptCount'], path);
	const runId = canonicalRunId(runValue.runId, `${path}.runId`);
	if (seenRunIds.has(runId)) throw new PromotionHistoryLedgerError(`${path}.runId`, `duplicate runId ${runId}`);
	seenRunIds.add(runId);
	const sequenceAt = canonicalTimestamp(runValue.sequenceAt, `${path}.sequenceAt`);
	const executionCommit = canonicalGitSha(runValue.executionCommit, `${path}.executionCommit`);
	const frozen = boolean(runValue.frozen, `${path}.frozen`);
	const attemptValues = array(runValue.attempts, `${path}.attempts`);
	if (attemptValues.length === 0) throw new PromotionHistoryLedgerError(`${path}.attempts`, 'at least one provider attempt is required');
	const attempts = attemptValues.map((attempt, attemptIndex) => parseAttempt(
		attempt,
		`${path}.attempts[${attemptIndex}]`,
		attemptIndex + 1,
		stage,
		runId,
		executionCommit,
	));
	if (attempts[0]!.startedAt < sequenceAt) {
		throw new PromotionHistoryLedgerError(`${path}.attempts[0].startedAt`, 'first provider attempt cannot start before the logical run creation time');
	}
	for (let attemptIndex = 1; attemptIndex < attempts.length; attemptIndex += 1) {
		if (attempts[attemptIndex]!.startedAt < attempts[attemptIndex - 1]!.completedAt) {
			throw new PromotionHistoryLedgerError(`${path}.attempts[${attemptIndex}].startedAt`, 'rerun attempt cannot start before the previous attempt completed');
		}
	}
	const promotionEffectiveAttemptCount = runValue.promotionEffectiveAttemptCount === undefined
		? attempts.length
		: nonNegativeSafeInteger(runValue.promotionEffectiveAttemptCount, `${path}.promotionEffectiveAttemptCount`);
	if (promotionEffectiveAttemptCount > attempts.length) {
		throw new PromotionHistoryLedgerError(`${path}.promotionEffectiveAttemptCount`, 'cannot exceed retained provider attempt count');
	}
	if (!frozen && promotionEffectiveAttemptCount !== attempts.length) {
		throw new PromotionHistoryLedgerError(`${path}.promotionEffectiveAttemptCount`, 'mutable tail must treat every retained attempt as promotion-effective');
	}
	return { runId, sequenceAt, executionCommit, frozen, promotionEffectiveAttemptCount, attempts };
}

function parseAttempt(
	value: unknown,
	path: string,
	expectedAttempt: number,
	stage: PromotionSubjectStage,
	runId: string,
	executionCommit: string,
): PromotionHistoryAttemptV2 {
	const attempt = record(value, path);
	exactKeys(attempt, ['attempt', 'startedAt', 'completedAt', 'conclusion', 'artifact', 'gapReason'], path);
	const attemptNumber = positiveSafeInteger(attempt.attempt, `${path}.attempt`);
	if (attemptNumber !== expectedAttempt) throw new PromotionHistoryLedgerError(`${path}.attempt`, `expected contiguous attempt ${expectedAttempt}, received ${attemptNumber}`);
	const startedAt = canonicalTimestamp(attempt.startedAt, `${path}.startedAt`);
	const completedAt = canonicalTimestamp(attempt.completedAt, `${path}.completedAt`);
	if (completedAt < startedAt) throw new PromotionHistoryLedgerError(`${path}.completedAt`, 'must not precede startedAt');
	const conclusion = nonEmptyString(attempt.conclusion, `${path}.conclusion`);
	const gapReason = nullableGapReason(attempt.gapReason, `${path}.gapReason`);
	const artifact = attempt.artifact === null ? null : parseArtifact(attempt.artifact, `${path}.artifact`, stage, runId, executionCommit);
	if ((artifact === null) === (gapReason === null)) throw new PromotionHistoryLedgerError(path, 'exactly one of artifact or gapReason must be present');
	if (artifact !== null && (artifact.observation.completedAt < startedAt || artifact.observation.completedAt > completedAt)) {
		throw new PromotionHistoryLedgerError(`${path}.artifact.observation.completedAt`, 'must fall within the provider attempt execution interval');
	}
	if (artifact?.observation.outcome === 'passed' && conclusion !== 'success') {
		throw new PromotionHistoryLedgerError(`${path}.conclusion`, 'passing observation requires a successful workflow attempt');
	}
	if (artifact !== null && artifact.observation.outcome !== 'passed' && conclusion === 'success') {
		throw new PromotionHistoryLedgerError(`${path}.conclusion`, 'failed observation cannot come from a successful workflow attempt');
	}
	if (artifact === null && conclusion === 'success' && !evidenceGapReasons.has(gapReason!)) {
		throw new PromotionHistoryLedgerError(`${path}.conclusion`, 'successful workflow attempt may only become an evidence-layer gap');
	}
	if (gapReason === 'workflow-cancelled' && conclusion !== 'cancelled') {
		throw new PromotionHistoryLedgerError(`${path}.conclusion`, 'workflow-cancelled gap requires cancelled provider conclusion');
	}
	return { attempt: attemptNumber, startedAt, completedAt, conclusion, artifact, gapReason };
}

function parseArtifact(
	value: unknown,
	path: string,
	stage: PromotionSubjectStage,
	runId: string,
	executionCommit: string,
): PromotionHistoryObservationArtifactCanonicalV2 {
	const artifact = record(value, path);
	exactKeys(artifact, ['archiveSha256', 'bytesSha256', 'observation'], path);
	const archiveSha256 = canonicalSha256(artifact.archiveSha256, `${path}.archiveSha256`);
	const bytesSha256 = canonicalSha256(artifact.bytesSha256, `${path}.bytesSha256`);
	const canonical = createPromotionShadowHistoryV2({ version: 2, stage, entries: [artifact.observation] }).history.entries[0]!;
	if (canonical.runId !== runId) throw new PromotionHistoryLedgerError(`${path}.observation.runId`, `expected ${runId}, received ${canonical.runId}`);
	if (canonical.executionCommit !== executionCommit) throw new PromotionHistoryLedgerError(`${path}.observation.executionCommit`, 'must match the GitHub run execution commit');
	if (!canonical.countsTowardPromotion) throw new PromotionHistoryLedgerError(`${path}.observation.countsTowardPromotion`, 'formal ledger observations must be counting observations');
	return { archiveSha256, bytesSha256, observation: canonical };
}

function validateRunOrderAndFreeze(runs: readonly PromotionHistoryRunV2[]): void {
	for (let index = 1; index < runs.length; index += 1) {
		if (compareRunOrder(runs[index - 1]!, runs[index]!) >= 0) throw new PromotionHistoryLedgerError(`$.runs[${index}]`, 'runs must be strictly ordered by sequenceAt and runId');
	}
	for (let index = 0; index < Math.max(0, runs.length - 1); index += 1) {
		if (!runs[index]!.frozen) throw new PromotionHistoryLedgerError(`$.runs[${index}].frozen`, 'all runs before the mutable tail must be frozen');
	}
}

function validateLineage(child: PromotionHistoryLedgerV2, parent: PromotionHistoryLedgerResultV2): void {
	if (child.stage !== parent.ledger.stage) throw new PromotionHistoryLedgerError('$.stage', 'child stage must match parent stage');
	if (child.generation !== parent.ledger.generation + 1) throw new PromotionHistoryLedgerError('$.generation', `expected ${parent.ledger.generation + 1}`);
	if (child.parentLedgerSha256 !== parent.sha256) throw new PromotionHistoryLedgerError('$.parentLedgerSha256', `expected ${parent.sha256}`);
	if (JSON.stringify(child.migration) !== JSON.stringify(parent.ledger.migration)) throw new PromotionHistoryLedgerError('$.migration', 'migration decision is immutable after genesis');
	const parentRuns = parent.ledger.runs;
	if (child.runs.length < parentRuns.length) throw new PromotionHistoryLedgerError('$.runs', 'child ledger cannot remove parent runs');
	const mutableParentIndex = parentRuns.length > 0 && !parentRuns.at(-1)!.frozen ? parentRuns.length - 1 : -1;
	for (let index = 0; index < parentRuns.length; index += 1) {
		const parentRun = parentRuns[index]!;
		const childRun = child.runs[index]!;
		if (index === mutableParentIndex) validateMutableTailExtension(parentRun, childRun, `$.runs[${index}]`);
		else validateFrozenRunAuditExtension(parentRun, childRun, `$.runs[${index}]`);
	}
	if (child.runs.length > parentRuns.length && mutableParentIndex >= 0 && !child.runs[mutableParentIndex]!.frozen) {
		throw new PromotionHistoryLedgerError(`$.runs[${mutableParentIndex}].frozen`, 'parent mutable tail must freeze before a later formal run is appended');
	}
}

function validateFrozenRunAuditExtension(parent: PromotionHistoryRunV2, child: PromotionHistoryRunV2, path: string): void {
	if (parent.runId !== child.runId || parent.sequenceAt !== child.sequenceAt || parent.executionCommit !== child.executionCommit) {
		throw new PromotionHistoryLedgerError(path, 'frozen run identity cannot change');
	}
	if (!parent.frozen || !child.frozen) throw new PromotionHistoryLedgerError(`${path}.frozen`, 'frozen run must remain frozen');
	if (child.promotionEffectiveAttemptCount !== parent.promotionEffectiveAttemptCount) {
		throw new PromotionHistoryLedgerError(`${path}.promotionEffectiveAttemptCount`, 'frozen promotion-effective attempt prefix is immutable');
	}
	validateAttemptPrefix(parent, child, path);
}

function validateMutableTailExtension(parent: PromotionHistoryRunV2, child: PromotionHistoryRunV2, path: string): void {
	if (parent.runId !== child.runId || parent.sequenceAt !== child.sequenceAt || parent.executionCommit !== child.executionCommit) throw new PromotionHistoryLedgerError(path, 'mutable tail identity cannot change');
	validateAttemptPrefix(parent, child, path);
	if (child.promotionEffectiveAttemptCount < parent.promotionEffectiveAttemptCount) {
		throw new PromotionHistoryLedgerError(`${path}.promotionEffectiveAttemptCount`, 'mutable tail cannot remove promotion-effective attempts');
	}
	const parentEffective = effectiveRun(parent);
	const childEffective = effectiveRun(child);
	if (parentEffective.kind === 'observation' && parentEffective.observation.outcome === 'product-failed') {
		if (childEffective.kind !== 'observation' || childEffective.observation.outcome !== 'product-failed') throw new PromotionHistoryLedgerError(path, 'product failure cannot be healed by rerun');
	}
	if (parentEffective.kind === 'gap' && evidenceGapReasons.has(parentEffective.reason)) {
		const strengthenedToProductFailure = childEffective.kind === 'observation'
			&& childEffective.observation.outcome === 'product-failed';
		const retainedSameUnknown = childEffective.kind === 'gap'
			&& childEffective.reason === parentEffective.reason;
		if (!strengthenedToProductFailure && !retainedSameUnknown) {
			throw new PromotionHistoryLedgerError(path, 'unresolved evidence gap cannot be healed by rerun');
		}
	}
	if (parent.frozen && !child.frozen) throw new PromotionHistoryLedgerError(`${path}.frozen`, 'frozen tail cannot become mutable');
}

function validateAttemptPrefix(parent: PromotionHistoryRunV2, child: PromotionHistoryRunV2, path: string): void {
	if (parent.attempts.length > child.attempts.length) throw new PromotionHistoryLedgerError(`${path}.attempts`, 'child ledger cannot remove retained attempts');
	for (let index = 0; index < parent.attempts.length; index += 1) {
		if (JSON.stringify(parent.attempts[index]) !== JSON.stringify(child.attempts[index])) throw new PromotionHistoryLedgerError(`${path}.attempts[${index}]`, 'existing attempts are immutable');
	}
}

function effectiveRun(run: PromotionHistoryRunV2): PromotionHistoryEffectiveRunV2 {
	const effectiveAttempts = run.attempts.slice(0, run.promotionEffectiveAttemptCount);
	if (effectiveAttempts.length === 0) {
		return { kind: 'gap', runId: run.runId, sequenceAt: run.sequenceAt, frozen: run.frozen, reason: 'observation-attempt-incomplete' };
	}
	for (const attempt of effectiveAttempts) {
		if (attempt.artifact?.observation.outcome === 'product-failed') {
			return { kind: 'observation', runId: run.runId, sequenceAt: run.sequenceAt, frozen: run.frozen, observation: attempt.artifact.observation };
		}
	}
	for (const attempt of effectiveAttempts) {
		if (attempt.artifact === null && evidenceGapReasons.has(attempt.gapReason!)) {
			return { kind: 'gap', runId: run.runId, sequenceAt: run.sequenceAt, frozen: run.frozen, reason: attempt.gapReason! };
		}
	}
	const latest = effectiveAttempts.at(-1)!;
	if (latest.artifact !== null) return { kind: 'observation', runId: run.runId, sequenceAt: run.sequenceAt, frozen: run.frozen, observation: latest.artifact.observation };
	return { kind: 'gap', runId: run.runId, sequenceAt: run.sequenceAt, frozen: run.frozen, reason: latest.gapReason! };
}

function promotionStage(value: unknown, path: string): PromotionSubjectStage {
	if (value === 'required-selfhost' || value === 'required-compiler' || value === 'production-default') return value;
	throw new PromotionHistoryLedgerError(path, 'invalid promotion stage');
}

function nullableGapReason(value: unknown, path: string): PromotionHistoryGapReasonV2 | null {
	if (value === null) return null;
	if (
		value === 'observation-artifact-missing'
		|| value === 'observation-artifact-invalid'
		|| value === 'observation-source-invalid'
		|| value === 'observation-attempt-incomplete'
		|| value === 'workflow-infrastructure-failed'
		|| value === 'workflow-cancelled'
	) return value;
	throw new PromotionHistoryLedgerError(path, 'invalid gap reason');
}

function canonicalTimestamp(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new PromotionHistoryLedgerError(path, 'expected canonical UTC ISO timestamp');
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new PromotionHistoryLedgerError(path, 'expected canonical UTC ISO timestamp');
	return value;
}

function canonicalRunId(value: unknown, path: string): string {
	if (typeof value !== 'string' || !runIdPattern.test(value)) throw new PromotionHistoryLedgerError(path, 'expected canonical positive decimal GitHub run ID');
	return value;
}

function canonicalGitSha(value: unknown, path: string): string {
	if (typeof value !== 'string' || !gitShaPattern.test(value)) throw new PromotionHistoryLedgerError(path, 'expected lowercase 40-character Git SHA');
	return value;
}

function nullableSha256(value: unknown, path: string): string | null {
	if (value === null) return null;
	return canonicalSha256(value, path);
}

function canonicalSha256(value: unknown, path: string): string {
	if (typeof value !== 'string' || !sha256Pattern.test(value)) throw new PromotionHistoryLedgerError(path, 'expected lowercase 64-character SHA-256');
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

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new PromotionHistoryLedgerError(path, 'expected boolean');
	return value;
}

function nonEmptyString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new PromotionHistoryLedgerError(path, 'expected non-empty canonical string');
	return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PromotionHistoryLedgerError(path, 'expected object');
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new PromotionHistoryLedgerError(path, 'expected array');
	return value;
}

function literal(value: unknown, expected: number, path: string): void {
	if (value !== expected) throw new PromotionHistoryLedgerError(path, `expected ${expected}`);
}

function literalValue<T extends string | number>(value: unknown, expected: T, path: string): T {
	if (value !== expected) throw new PromotionHistoryLedgerError(path, `expected ${String(expected)}`);
	return expected;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new PromotionHistoryLedgerError(path, `expected exactly keys ${wanted.join(', ')}`);
}

function exactKeysWithOptional(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], path: string): void {
	const actual = Object.keys(value).sort(compareText);
	const allowed = new Set([...required, ...optional]);
	const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(value, key));
	const extra = actual.filter(key => !allowed.has(key));
	if (missing.length > 0 || extra.length > 0) {
		throw new PromotionHistoryLedgerError(path, `missing keys ${missing.join(', ') || 'none'}; unexpected keys ${extra.join(', ') || 'none'}`);
	}
}

function compareRunOrder(left: PromotionHistoryRunV2, right: PromotionHistoryRunV2): number {
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