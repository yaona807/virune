import {
	createPromotionHistoryLedgerV2,
	parsePromotionHistoryLedgerV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryLedgerResultV2,
	type PromotionHistoryLedgerV2,
	type PromotionHistoryRunInputV2,
} from './promotion-history-ledger-v2.js';
import type { PromotionSubjectStage } from './promotion-subject.js';

export const PROMOTION_HISTORY_AGGREGATION_VERSION = 2 as const;

export type PromotionAggregationRunStatusV2 = 'completed' | 'in-progress' | 'queued';

export interface PromotionAggregationRunSnapshotV2 {
	readonly runId: string;
	readonly sequenceAt: string;
	readonly executionCommit: string;
	readonly status: PromotionAggregationRunStatusV2;
	readonly runAttempt: number;
	readonly attempts: readonly PromotionHistoryAttemptInputV2[];
}

export interface PromotionAggregationLateAttemptV2 {
	readonly runId: string;
	readonly attempt: number;
	readonly startedAt: string;
	readonly completedAt: string;
	readonly conclusion: string;
	readonly reason: 'completed-at-or-after-next-formal-run' | 'run-already-frozen';
}

export interface PromotionHistoryAggregationResultV2 {
	readonly version: typeof PROMOTION_HISTORY_AGGREGATION_VERSION;
	readonly publish: boolean;
	readonly ledger: PromotionHistoryLedgerResultV2 | null;
	readonly processedRunIds: readonly string[];
	readonly blockedByRunId: string | null;
	readonly lateAttempts: readonly PromotionAggregationLateAttemptV2[];
}

export class PromotionHistoryAggregationError extends Error {
	public override readonly name = 'PromotionHistoryAggregationError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const runIdPattern = /^[1-9][0-9]*$/u;
const gitShaPattern = /^[0-9a-f]{40}$/u;

export function aggregatePromotionHistoryV2(input: {
	readonly stage: PromotionSubjectStage;
	readonly parent?: PromotionHistoryLedgerV2 | unknown;
	readonly runs: readonly PromotionAggregationRunSnapshotV2[];
}): PromotionHistoryAggregationResultV2 {
	const parent = input.parent === undefined ? null : parsePromotionHistoryLedgerV2(input.parent);
	if (parent !== null && parent.ledger.stage !== input.stage) {
		throw new PromotionHistoryAggregationError('parent.stage', `expected ${input.stage}, received ${parent.ledger.stage}`);
	}
	const snapshots = parseSnapshots(input.runs, input.stage);
	if (snapshots.length === 0) {
		return { version: PROMOTION_HISTORY_AGGREGATION_VERSION, publish: false, ledger: null, processedRunIds: [], blockedByRunId: null, lateAttempts: [] };
	}
	validateSnapshotOrder(snapshots);
	const parentRuns = parent?.ledger.runs ?? [];
	const desiredRuns: PromotionHistoryRunInputV2[] = parentRuns.map(run => ({
		runId: run.runId,
		sequenceAt: run.sequenceAt,
		executionCommit: run.executionCommit,
		frozen: run.frozen,
		promotionEffectiveAttemptCount: run.promotionEffectiveAttemptCount,
		attempts: run.attempts,
	}));
	const processedRunIds: string[] = [];
	const lateAttempts: PromotionAggregationLateAttemptV2[] = [];
	let blockedByRunId: string | null = null;

	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = snapshots[index]!;
		const nextSnapshot = snapshots[index + 1];
		const existingIndex = desiredRuns.findIndex(run => run.runId === snapshot.runId);
		if (snapshot.status !== 'completed') {
			blockedByRunId = snapshot.runId;
			freezePreviousRunForLaterFormalRun(desiredRuns, snapshot.sequenceAt);
			break;
		}
		const freezeBoundary = nextSnapshot?.sequenceAt ?? null;
		if (existingIndex >= 0) {
			const existing = desiredRuns[existingIndex]!;
			validateSnapshotIdentity(existing, snapshot, `runs[${index}]`);
			const existingAttemptCount = existing.attempts.length;
			if (snapshot.attempts.length < existingAttemptCount) {
				throw new PromotionHistoryAggregationError(`runs[${index}].attempts`, 'provider snapshot cannot remove ledger attempts');
			}
			for (let attemptIndex = 0; attemptIndex < existingAttemptCount; attemptIndex += 1) {
				if (JSON.stringify(snapshot.attempts[attemptIndex]) !== JSON.stringify(existing.attempts[attemptIndex])) {
					throw new PromotionHistoryAggregationError(`runs[${index}].attempts[${attemptIndex}]`, 'provider snapshot disagrees with retained ledger attempt');
				}
			}
			const appended = snapshot.attempts.slice(existingAttemptCount);
			if (existing.frozen) {
				for (const attempt of appended) lateAttempts.push(toLateAttempt(snapshot.runId, attempt, 'run-already-frozen'));
				desiredRuns[existingIndex] = { ...existing, attempts: [...existing.attempts, ...appended] };
			} else {
				const effectiveAppended = freezeBoundary === null
					? appended
					: appended.filter(attempt => attempt.completedAt < freezeBoundary);
				const effectiveCount = (existing.promotionEffectiveAttemptCount ?? existing.attempts.length) + effectiveAppended.length;
				for (const attempt of appended.slice(effectiveAppended.length)) {
					lateAttempts.push(toLateAttempt(snapshot.runId, attempt, 'completed-at-or-after-next-formal-run'));
				}
				desiredRuns[existingIndex] = {
					...existing,
					attempts: [...existing.attempts, ...appended],
					promotionEffectiveAttemptCount: effectiveCount,
					frozen: freezeBoundary !== null,
				};
			}
		} else {
			if (parentRuns.length > 0 && compareRunKey(snapshot, parentRuns.at(-1)!) <= 0) {
				throw new PromotionHistoryAggregationError(`runs[${index}]`, 'new provider run precedes or collides with retained ledger history');
			}
			const promotionEffectiveAttemptCount = freezeBoundary === null
				? snapshot.attempts.length
				: snapshot.attempts.filter(attempt => attempt.completedAt < freezeBoundary).length;
			for (const attempt of snapshot.attempts.slice(promotionEffectiveAttemptCount)) {
				lateAttempts.push(toLateAttempt(snapshot.runId, attempt, 'completed-at-or-after-next-formal-run'));
			}
			freezePreviousRunForLaterFormalRun(desiredRuns, snapshot.sequenceAt);
			desiredRuns.push({
				runId: snapshot.runId,
				sequenceAt: snapshot.sequenceAt,
				executionCommit: snapshot.executionCommit,
				frozen: freezeBoundary !== null,
				promotionEffectiveAttemptCount,
				attempts: snapshot.attempts,
			});
		}
		processedRunIds.push(snapshot.runId);
	}

	const changed = parent === null
		? desiredRuns.length > 0
		: JSON.stringify(desiredRuns) !== JSON.stringify(parent.ledger.runs);
	if (!changed) {
		return { version: PROMOTION_HISTORY_AGGREGATION_VERSION, publish: false, ledger: null, processedRunIds, blockedByRunId, lateAttempts };
	}
	const nextInput = {
		version: 2 as const,
		stage: input.stage,
		generation: parent === null ? 1 : parent.ledger.generation + 1,
		parentLedgerSha256: parent?.sha256 ?? null,
		migration: parent?.ledger.migration ?? promotionHistoryMigrationV2(),
		runs: desiredRuns,
	};
	const ledger = parent === null
		? createPromotionHistoryLedgerV2(nextInput)
		: createPromotionHistoryLedgerV2(nextInput, parent.ledger);
	return { version: PROMOTION_HISTORY_AGGREGATION_VERSION, publish: true, ledger, processedRunIds, blockedByRunId, lateAttempts };
}

function parseSnapshots(
	values: readonly PromotionAggregationRunSnapshotV2[],
	stage: PromotionSubjectStage,
): readonly PromotionAggregationRunSnapshotV2[] {
	return values.map((value, index) => {
		const path = `runs[${index}]`;
		if (typeof value.runId !== 'string' || !runIdPattern.test(value.runId)) {
			throw new PromotionHistoryAggregationError(`${path}.runId`, 'expected canonical positive decimal GitHub run ID');
		}
		canonicalTimestamp(value.sequenceAt, `${path}.sequenceAt`);
		if (typeof value.executionCommit !== 'string' || !gitShaPattern.test(value.executionCommit)) {
			throw new PromotionHistoryAggregationError(`${path}.executionCommit`, 'expected lowercase 40-character Git SHA');
		}
		if (value.status !== 'completed' && value.status !== 'in-progress' && value.status !== 'queued') {
			throw new PromotionHistoryAggregationError(`${path}.status`, 'invalid workflow run status');
		}
		if (!Number.isSafeInteger(value.runAttempt) || value.runAttempt <= 0) {
			throw new PromotionHistoryAggregationError(`${path}.runAttempt`, 'expected a positive safe integer');
		}
		if (!Array.isArray(value.attempts)) throw new PromotionHistoryAggregationError(`${path}.attempts`, 'expected attempt array');
		if (value.attempts.length > value.runAttempt) {
			throw new PromotionHistoryAggregationError(`${path}.attempts`, 'attempt list cannot exceed provider runAttempt');
		}
		if (value.status === 'completed' && value.attempts.length !== value.runAttempt) {
			throw new PromotionHistoryAggregationError(
				`${path}.attempts`,
				`completed run attempt metadata is incomplete: expected ${value.runAttempt}, received ${value.attempts.length}`,
			);
		}
		if (value.attempts.length > 0) {
			parsePromotionHistoryLedgerV2({
				version: 2,
				stage,
				generation: 1,
				parentLedgerSha256: null,
				migration: promotionHistoryMigrationV2(),
				runs: [{
					runId: value.runId,
					sequenceAt: value.sequenceAt,
					executionCommit: value.executionCommit,
					frozen: false,
					attempts: value.attempts,
				}],
			});
		}
		return value;
	});
}

function validateSnapshotOrder(runs: readonly PromotionAggregationRunSnapshotV2[]): void {
	const seen = new Set<string>();
	for (let index = 0; index < runs.length; index += 1) {
		const run = runs[index]!;
		if (seen.has(run.runId)) throw new PromotionHistoryAggregationError(`runs[${index}].runId`, `duplicate runId ${run.runId}`);
		seen.add(run.runId);
		if (index > 0 && compareRunKey(runs[index - 1]!, run) >= 0) {
			throw new PromotionHistoryAggregationError(`runs[${index}]`, 'provider runs must be strictly ordered by sequenceAt and numeric runId');
		}
	}
}

function validateSnapshotIdentity(
	existing: PromotionHistoryRunInputV2,
	snapshot: PromotionAggregationRunSnapshotV2,
	path: string,
): void {
	if (existing.sequenceAt !== snapshot.sequenceAt || existing.executionCommit !== snapshot.executionCommit) {
		throw new PromotionHistoryAggregationError(path, 'provider run identity disagrees with retained ledger history');
	}
}

function freezePreviousRunForLaterFormalRun(runs: PromotionHistoryRunInputV2[], laterSequenceAt: string): void {
	if (runs.length === 0) return;
	const previous = runs.at(-1)!;
	if (previous.sequenceAt >= laterSequenceAt) return;
	if (!previous.frozen) {
		runs[runs.length - 1] = {
			...previous,
			frozen: true,
			promotionEffectiveAttemptCount: previous.promotionEffectiveAttemptCount ?? previous.attempts.length,
		};
	}
}

function toLateAttempt(
	runId: string,
	attempt: PromotionHistoryAttemptInputV2,
	reason: PromotionAggregationLateAttemptV2['reason'],
): PromotionAggregationLateAttemptV2 {
	return {
		runId,
		attempt: attempt.attempt,
		startedAt: attempt.startedAt,
		completedAt: attempt.completedAt,
		conclusion: attempt.conclusion,
		reason,
	};
}

function compareRunKey(
	left: { readonly sequenceAt: string; readonly runId: string },
	right: { readonly sequenceAt: string; readonly runId: string },
): number {
	if (left.sequenceAt !== right.sequenceAt) return left.sequenceAt < right.sequenceAt ? -1 : 1;
	const leftId = BigInt(left.runId);
	const rightId = BigInt(right.runId);
	return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function canonicalTimestamp(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new PromotionHistoryAggregationError(path, 'expected canonical UTC ISO timestamp');
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
		throw new PromotionHistoryAggregationError(path, 'expected canonical UTC ISO timestamp');
	}
	return value;
}
