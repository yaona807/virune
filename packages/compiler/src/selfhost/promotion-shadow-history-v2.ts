import { createHash } from 'node:crypto';
import type { PromotionSubjectStage } from './promotion-subject.js';

export const PROMOTION_SHADOW_HISTORY_VERSION = 2 as const;

export type PromotionObservationOutcome =
	| 'passed'
	| 'product-failed'
	| 'infrastructure-failed'
	| 'cancelled';

export type PromotionObservationEvidenceStatus = 'passed' | 'failed';

export interface PromotionObservationEvidenceInputV2 {
	readonly id: string;
	readonly status: PromotionObservationEvidenceStatus;
	readonly sha256: string;
}

export interface PromotionShadowHistoryEntryInputV2 {
	readonly version: typeof PROMOTION_SHADOW_HISTORY_VERSION;
	readonly runId: string;
	readonly stage: PromotionSubjectStage;
	readonly executionCommit: string;
	readonly promotionSubjectId: string;
	readonly completedAt: string;
	readonly outcome: PromotionObservationOutcome;
	readonly countsTowardPromotion: boolean;
	readonly unexplainedDifferentials: number;
	readonly evidence: readonly PromotionObservationEvidenceInputV2[];
}

export interface PromotionShadowHistoryInputV2 {
	readonly version: typeof PROMOTION_SHADOW_HISTORY_VERSION;
	readonly stage: PromotionSubjectStage;
	readonly entries: readonly PromotionShadowHistoryEntryInputV2[];
}

export interface PromotionObservationEvidenceV2 extends PromotionObservationEvidenceInputV2 {}

export interface PromotionShadowHistoryEntryV2 extends Omit<PromotionShadowHistoryEntryInputV2, 'evidence'> {
	readonly evidence: readonly PromotionObservationEvidenceV2[];
}

export interface PromotionShadowHistoryV2 {
	readonly version: typeof PROMOTION_SHADOW_HISTORY_VERSION;
	readonly stage: PromotionSubjectStage;
	readonly promotionSubjectId: string;
	readonly successfulRuns: number;
	readonly observationDays: number;
	readonly firstSuccessfulAt: string | null;
	readonly latestCompletedAt: string;
	readonly productInvalidated: boolean;
	readonly unexplainedDifferentials: number;
	readonly entries: readonly PromotionShadowHistoryEntryV2[];
}

export interface PromotionShadowHistoryResultV2 {
	readonly history: PromotionShadowHistoryV2;
	readonly serialized: string;
	readonly sha256: string;
}

export class PromotionShadowHistoryError extends Error {
	public override readonly name = 'PromotionShadowHistoryError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const gitShaPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;

export function createPromotionShadowHistoryV2(value: unknown): PromotionShadowHistoryResultV2 {
	const input = record(value, '$');
	exactKeys(input, ['version', 'stage', 'entries'], '$');
	literal(input.version, PROMOTION_SHADOW_HISTORY_VERSION, '$.version');
	const stage = promotionStage(input.stage, '$.stage');
	const entryValues = array(input.entries, '$.entries');
	if (entryValues.length === 0) throw new PromotionShadowHistoryError('$.entries', 'at least one observation is required');

	const seenRunIds = new Set<string>();
	const entries = entryValues.map((entry, index) => parseEntry(entry, index, stage, seenRunIds));
	for (let index = 1; index < entries.length; index += 1) {
		if (compareEntryOrder(entries[index - 1]!, entries[index]!) >= 0) {
			throw new PromotionShadowHistoryError(`$.entries[${index}]`, 'entries must be strictly ordered by completedAt and runId');
		}
	}

	const latest = entries.at(-1)!;
	const currentSegment = trailingSubjectSegment(entries, latest.promotionSubjectId);
	const currentSubjectEntries = entries.filter(entry => entry.promotionSubjectId === latest.promotionSubjectId);
	const countingCurrentSubjectEntries = currentSubjectEntries.filter(entry => entry.countsTowardPromotion);
	const productInvalidated = countingCurrentSubjectEntries.some(entry => entry.outcome === 'product-failed');
	const unexplainedDifferentials = countingCurrentSubjectEntries.reduce(
		(total, entry) => total + entry.unexplainedDifferentials,
		0,
	);
	const trailingSuccessful = productInvalidated ? [] : trailingCountingSuccesses(currentSegment);
	const history: PromotionShadowHistoryV2 = {
		version: PROMOTION_SHADOW_HISTORY_VERSION,
		stage,
		promotionSubjectId: latest.promotionSubjectId,
		successfulRuns: trailingSuccessful.length,
		observationDays: distinctUtcDays(trailingSuccessful),
		firstSuccessfulAt: trailingSuccessful[0]?.completedAt ?? null,
		latestCompletedAt: latest.completedAt,
		productInvalidated,
		unexplainedDifferentials,
		entries,
	};
	const serialized = JSON.stringify(history);
	return { history, serialized, sha256: sha256(serialized) };
}

function parseEntry(
	value: unknown,
	index: number,
	expectedStage: PromotionSubjectStage,
	seenRunIds: Set<string>,
): PromotionShadowHistoryEntryV2 {
	const path = `$.entries[${index}]`;
	const entry = record(value, path);
	exactKeys(entry, [
		'version', 'runId', 'stage', 'executionCommit', 'promotionSubjectId', 'completedAt',
		'outcome', 'countsTowardPromotion', 'unexplainedDifferentials', 'evidence',
	], path);
	literal(entry.version, PROMOTION_SHADOW_HISTORY_VERSION, `${path}.version`);
	const runId = nonEmptyString(entry.runId, `${path}.runId`);
	if (seenRunIds.has(runId)) throw new PromotionShadowHistoryError(`${path}.runId`, `duplicate runId ${runId}`);
	seenRunIds.add(runId);
	const stage = promotionStage(entry.stage, `${path}.stage`);
	if (stage !== expectedStage) throw new PromotionShadowHistoryError(`${path}.stage`, `expected ${expectedStage}, received ${stage}`);
	const executionCommit = canonicalGitSha(entry.executionCommit, `${path}.executionCommit`);
	const promotionSubjectId = canonicalSha256(entry.promotionSubjectId, `${path}.promotionSubjectId`);
	const completedAt = canonicalTimestamp(entry.completedAt, `${path}.completedAt`);
	const outcome = observationOutcome(entry.outcome, `${path}.outcome`);
	const countsTowardPromotion = boolean(entry.countsTowardPromotion, `${path}.countsTowardPromotion`);
	const unexplainedDifferentials = nonNegativeSafeInteger(entry.unexplainedDifferentials, `${path}.unexplainedDifferentials`);
	if (outcome === 'passed' && unexplainedDifferentials !== 0) {
		throw new PromotionShadowHistoryError(`${path}.unexplainedDifferentials`, 'passed observations must have zero unexplained differentials');
	}
	const evidence = parseEvidence(entry.evidence, `${path}.evidence`);
	if (outcome === 'passed' && evidence.some(item => item.status !== 'passed')) {
		throw new PromotionShadowHistoryError(`${path}.evidence`, 'passed observations cannot contain failed evidence');
	}
	return {
		version: PROMOTION_SHADOW_HISTORY_VERSION,
		runId,
		stage,
		executionCommit,
		promotionSubjectId,
		completedAt,
		outcome,
		countsTowardPromotion,
		unexplainedDifferentials,
		evidence,
	};
}

function parseEvidence(value: unknown, path: string): readonly PromotionObservationEvidenceV2[] {
	const values = array(value, path);
	if (values.length === 0) throw new PromotionShadowHistoryError(path, 'at least one evidence item is required');
	const seen = new Set<string>();
	const evidence = values.map((item, index): PromotionObservationEvidenceV2 => {
		const itemPath = `${path}[${index}]`;
		const recordValue = record(item, itemPath);
		exactKeys(recordValue, ['id', 'status', 'sha256'], itemPath);
		const id = nonEmptyString(recordValue.id, `${itemPath}.id`);
		if (seen.has(id)) throw new PromotionShadowHistoryError(`${itemPath}.id`, `duplicate evidence id ${id}`);
		seen.add(id);
		const status = evidenceStatus(recordValue.status, `${itemPath}.status`);
		const itemSha256 = canonicalSha256(recordValue.sha256, `${itemPath}.sha256`);
		return { id, status, sha256: itemSha256 };
	}).sort((left, right) => compareText(left.id, right.id));
	return evidence;
}

function trailingSubjectSegment(entries: readonly PromotionShadowHistoryEntryV2[], promotionSubjectId: string) {
	let first = entries.length - 1;
	for (let index = entries.length - 2; index >= 0; index -= 1) {
		if (entries[index]!.promotionSubjectId !== promotionSubjectId) break;
		first = index;
	}
	return entries.slice(first);
}

function trailingCountingSuccesses(entries: readonly PromotionShadowHistoryEntryV2[]) {
	const counting = entries.filter(entry => entry.countsTowardPromotion);
	if (counting.length === 0 || counting.at(-1)!.outcome !== 'passed') return [];
	let first = counting.length - 1;
	for (let index = counting.length - 2; index >= 0; index -= 1) {
		if (counting[index]!.outcome !== 'passed') break;
		first = index;
	}
	return counting.slice(first);
}

function distinctUtcDays(entries: readonly PromotionShadowHistoryEntryV2[]): number {
	return new Set(entries.map(entry => entry.completedAt.slice(0, 10))).size;
}

function promotionStage(value: unknown, path: string): PromotionSubjectStage {
	if (value === 'required-selfhost' || value === 'required-compiler' || value === 'production-default') return value;
	throw new PromotionShadowHistoryError(path, 'invalid promotion stage');
}

function observationOutcome(value: unknown, path: string): PromotionObservationOutcome {
	if (value === 'passed' || value === 'product-failed' || value === 'infrastructure-failed' || value === 'cancelled') return value;
	throw new PromotionShadowHistoryError(path, 'invalid observation outcome');
}

function evidenceStatus(value: unknown, path: string): PromotionObservationEvidenceStatus {
	if (value === 'passed' || value === 'failed') return value;
	throw new PromotionShadowHistoryError(path, 'invalid evidence status');
}

function canonicalTimestamp(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new PromotionShadowHistoryError(path, 'expected canonical UTC ISO timestamp');
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
		throw new PromotionShadowHistoryError(path, 'expected canonical UTC ISO timestamp');
	}
	return value;
}

function canonicalGitSha(value: unknown, path: string): string {
	if (typeof value !== 'string' || !gitShaPattern.test(value)) {
		throw new PromotionShadowHistoryError(path, 'expected lowercase 40-character Git SHA');
	}
	return value;
}

function canonicalSha256(value: unknown, path: string): string {
	if (typeof value !== 'string' || !sha256Pattern.test(value)) {
		throw new PromotionShadowHistoryError(path, 'expected lowercase 64-character SHA-256');
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new PromotionShadowHistoryError(path, 'expected a non-negative safe integer');
	return value as number;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new PromotionShadowHistoryError(path, 'expected a boolean');
	return value;
}

function literal(value: unknown, expected: number, path: string): void {
	if (value !== expected) throw new PromotionShadowHistoryError(path, `expected ${expected}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PromotionShadowHistoryError(path, 'expected an object');
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new PromotionShadowHistoryError(path, 'expected an array');
	return value;
}

function nonEmptyString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
		throw new PromotionShadowHistoryError(path, 'expected a non-empty canonical string');
	}
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
		throw new PromotionShadowHistoryError(path, `expected exactly keys ${wanted.join(', ')}`);
	}
}

function compareEntryOrder(left: PromotionShadowHistoryEntryV2, right: PromotionShadowHistoryEntryV2): number {
	return compareText(left.completedAt, right.completedAt) || compareText(left.runId, right.runId);
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
