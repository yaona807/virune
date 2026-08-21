import { createHash } from 'node:crypto';
import {
	PROMOTION_HISTORY_AGGREGATION_CLAIM,
	PROMOTION_HISTORY_ORCHESTRATOR_VERSION,
	type PromotionHistoryAggregationReportV2,
	type PromotionHistoryPolicySummaryV2,
} from './promotion-history-orchestrator-v2.js';
import { promotionHistoryMigrationV2, type PromotionHistoryMigrationV2 } from './promotion-history-ledger-v2.js';
import type { PromotionAggregationLateAttemptV2 } from './promotion-history-aggregation-v2.js';
import type { PromotionSubjectStage } from './promotion-subject.js';

export interface PromotionHistoryAggregationReportResultV2 {
	readonly report: PromotionHistoryAggregationReportV2;
	readonly serialized: string;
	readonly sha256: string;
}

export class PromotionHistoryAggregationReportError extends Error {
	public override readonly name = 'PromotionHistoryAggregationReportError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const runIdPattern = /^[1-9][0-9]*$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const stageValues = new Set<PromotionSubjectStage>(['required-selfhost', 'required-compiler', 'production-default']);

export function parsePromotionHistoryAggregationReportV2(value: unknown): PromotionHistoryAggregationReportResultV2 {
	const input = record(value, '$');
	exactKeys(input, [
		'version', 'claim', 'productionEligible', 'automaticPromotion', 'stage', 'trigger', 'publish',
		'parentLedgerSha256', 'publishedLedgerSha256', 'currentLedgerSha256', 'currentLedgerGeneration',
		'processedRunIds', 'blockedByRunId', 'lateAttempts', 'currentProductKnown', 'policy', 'migration',
	], '$');
	literal(input.version, PROMOTION_HISTORY_ORCHESTRATOR_VERSION, '$.version');
	literal(input.claim, PROMOTION_HISTORY_AGGREGATION_CLAIM, '$.claim');
	literal(input.productionEligible, false, '$.productionEligible');
	literal(input.automaticPromotion, false, '$.automaticPromotion');
	const stage = promotionStage(input.stage, '$.stage');
	const trigger = parseTrigger(input.trigger, '$.trigger');
	const publish = boolean(input.publish, '$.publish');
	const parentLedgerSha256 = nullableSha256(input.parentLedgerSha256, '$.parentLedgerSha256');
	const publishedLedgerSha256 = nullableSha256(input.publishedLedgerSha256, '$.publishedLedgerSha256');
	const currentLedgerSha256 = nullableSha256(input.currentLedgerSha256, '$.currentLedgerSha256');
	const currentLedgerGeneration = nullablePositiveInteger(input.currentLedgerGeneration, '$.currentLedgerGeneration');
	const processedRunIds = canonicalRunIds(input.processedRunIds, '$.processedRunIds');
	const blockedByRunId = nullableRunId(input.blockedByRunId, '$.blockedByRunId');
	const lateAttempts = parseLateAttempts(input.lateAttempts, '$.lateAttempts');
	const currentProductKnown = boolean(input.currentProductKnown, '$.currentProductKnown');
	const policy = input.policy === null ? null : parsePolicy(input.policy, '$.policy', currentProductKnown);
	const migration = input.migration === null ? null : parseMigration(input.migration, '$.migration');

	if (publish !== (publishedLedgerSha256 !== null)) {
		throw new PromotionHistoryAggregationReportError('$.publishedLedgerSha256', 'publish must exactly match presence of a published ledger SHA');
	}
	if (publish && trigger.observationEvent !== 'schedule') {
		throw new PromotionHistoryAggregationReportError('$.publish', 'manual observation triggers cannot publish canonical ledger state');
	}
	if (publish && trigger.aggregationAttempt !== 1) {
		throw new PromotionHistoryAggregationReportError('$.publish', 'aggregation rerun attempts cannot publish canonical ledger state');
	}
	if (publish && publishedLedgerSha256 !== currentLedgerSha256) {
		throw new PromotionHistoryAggregationReportError('$.currentLedgerSha256', 'published ledger must be the current ledger');
	}
	if ((currentLedgerSha256 === null) !== (currentLedgerGeneration === null)) {
		throw new PromotionHistoryAggregationReportError('$.currentLedgerGeneration', 'current ledger SHA and generation must be present together');
	}
	if ((currentLedgerSha256 === null) !== (migration === null)) {
		throw new PromotionHistoryAggregationReportError('$.migration', 'migration record must be present exactly when a current ledger exists');
	}
	if (policy !== null && currentLedgerSha256 === null) {
		throw new PromotionHistoryAggregationReportError('$.policy', 'policy replay requires a current ledger');
	}
	if (currentProductKnown && policy === null) {
		throw new PromotionHistoryAggregationReportError('$.currentProductKnown', 'known current product requires policy replay');
	}

	const report: PromotionHistoryAggregationReportV2 = {
		version: PROMOTION_HISTORY_ORCHESTRATOR_VERSION,
		claim: PROMOTION_HISTORY_AGGREGATION_CLAIM,
		productionEligible: false,
		automaticPromotion: false,
		stage,
		trigger,
		publish,
		parentLedgerSha256,
		publishedLedgerSha256,
		currentLedgerSha256,
		currentLedgerGeneration,
		processedRunIds,
		blockedByRunId,
		lateAttempts,
		currentProductKnown,
		policy,
		migration,
	};
	const serialized = JSON.stringify(report);
	return { report, serialized, sha256: sha256(serialized) };
}

function parseTrigger(value: unknown, path: string): PromotionHistoryAggregationReportV2['trigger'] {
	const input = record(value, path);
	exactKeys(input, ['aggregationRunId', 'aggregationAttempt', 'observationRunId', 'observationEvent'], path);
	const observationEvent = input.observationEvent;
	if (observationEvent !== 'schedule' && observationEvent !== 'workflow_dispatch') {
		throw new PromotionHistoryAggregationReportError(`${path}.observationEvent`, 'expected schedule or workflow_dispatch');
	}
	return {
		aggregationRunId: runId(input.aggregationRunId, `${path}.aggregationRunId`),
		aggregationAttempt: positiveInteger(input.aggregationAttempt, `${path}.aggregationAttempt`),
		observationRunId: runId(input.observationRunId, `${path}.observationRunId`),
		observationEvent,
	};
}

function parsePolicy(value: unknown, path: string, currentProductKnown: boolean): PromotionHistoryPolicySummaryV2 {
	const input = record(value, path);
	exactKeys(input, [
		'promotionSubjectId', 'successfulRuns', 'observationDays', 'productInvalidated',
		'unexplainedDifferentials', 'historyThresholdsSatisfied', 'requiredEvidence',
	], path);
	const promotionSubjectId = input.promotionSubjectId === null ? null : sha256Value(input.promotionSubjectId, `${path}.promotionSubjectId`);
	const successfulRuns = nonNegativeInteger(input.successfulRuns, `${path}.successfulRuns`);
	const observationDays = nonNegativeInteger(input.observationDays, `${path}.observationDays`);
	if (observationDays > successfulRuns) {
		throw new PromotionHistoryAggregationReportError(`${path}.observationDays`, 'observation days cannot exceed successful runs');
	}
	const productInvalidated = boolean(input.productInvalidated, `${path}.productInvalidated`);
	const unexplainedDifferentials = nonNegativeInteger(input.unexplainedDifferentials, `${path}.unexplainedDifferentials`);
	const historyThresholdsSatisfied = boolean(input.historyThresholdsSatisfied, `${path}.historyThresholdsSatisfied`);
	const requiredEvidence = canonicalStrings(input.requiredEvidence, `${path}.requiredEvidence`);
	if (requiredEvidence.length === 0) throw new PromotionHistoryAggregationReportError(`${path}.requiredEvidence`, 'at least one required evidence id is required');
	if (currentProductKnown !== (promotionSubjectId !== null)) {
		throw new PromotionHistoryAggregationReportError(`${path}.promotionSubjectId`, 'current product identity presence must match currentProductKnown');
	}
	if (!currentProductKnown && historyThresholdsSatisfied) {
		throw new PromotionHistoryAggregationReportError(`${path}.historyThresholdsSatisfied`, 'unknown current product cannot satisfy promotion thresholds');
	}
	return {
		promotionSubjectId,
		successfulRuns,
		observationDays,
		productInvalidated,
		unexplainedDifferentials,
		historyThresholdsSatisfied,
		requiredEvidence,
	};
}

function parseMigration(value: unknown, path: string): PromotionHistoryMigrationV2 {
	const input = record(value, path);
	exactKeys(input, ['sourceHistoryVersion', 'strategy', 'promotionCreditRuns', 'promotionCreditDays', 'reason'], path);
	const expected = promotionHistoryMigrationV2();
	for (const [key, expectedValue] of Object.entries(expected)) {
		if (input[key] !== expectedValue) throw new PromotionHistoryAggregationReportError(`${path}.${key}`, `expected ${String(expectedValue)}`);
	}
	return expected;
}

function parseLateAttempts(value: unknown, path: string): readonly PromotionAggregationLateAttemptV2[] {
	const values = array(value, path);
	return values.map((item, index) => {
		const itemPath = `${path}[${index}]`;
		const input = record(item, itemPath);
		exactKeys(input, ['runId', 'attempt', 'startedAt', 'completedAt', 'conclusion', 'reason'], itemPath);
		const startedAt = canonicalTimestamp(input.startedAt, `${itemPath}.startedAt`);
		const completedAt = canonicalTimestamp(input.completedAt, `${itemPath}.completedAt`);
		if (startedAt > completedAt) throw new PromotionHistoryAggregationReportError(`${itemPath}.completedAt`, 'attempt cannot complete before it starts');
		const reason = input.reason;
		if (reason !== 'completed-at-or-after-next-formal-run' && reason !== 'run-already-frozen') {
			throw new PromotionHistoryAggregationReportError(`${itemPath}.reason`, 'invalid late-attempt reason');
		}
		return {
			runId: runId(input.runId, `${itemPath}.runId`),
			attempt: positiveInteger(input.attempt, `${itemPath}.attempt`),
			startedAt,
			completedAt,
			conclusion: nonEmptyText(input.conclusion, `${itemPath}.conclusion`),
			reason,
		};
	});
}

function canonicalRunIds(value: unknown, path: string): readonly string[] {
	const values = array(value, path).map((item, index) => runId(item, `${path}[${index}]`));
	if (new Set(values).size !== values.length) throw new PromotionHistoryAggregationReportError(path, 'duplicate run IDs are not allowed');
	for (let index = 1; index < values.length; index += 1) {
		if (BigInt(values[index - 1]!) >= BigInt(values[index]!)) {
			throw new PromotionHistoryAggregationReportError(`${path}[${index}]`, 'processed run IDs must be strictly increasing');
		}
	}
	return values;
}

function canonicalStrings(value: unknown, path: string): readonly string[] {
	const values = array(value, path).map((item, index) => nonEmptyText(item, `${path}[${index}]`));
	if (new Set(values).size !== values.length) throw new PromotionHistoryAggregationReportError(path, 'duplicate values are not allowed');
	const sorted = [...values].sort(compareText);
	if (JSON.stringify(values) !== JSON.stringify(sorted)) throw new PromotionHistoryAggregationReportError(path, 'values must use canonical lexical order');
	return values;
}

function promotionStage(value: unknown, path: string): PromotionSubjectStage {
	if (typeof value !== 'string' || !stageValues.has(value as PromotionSubjectStage)) {
		throw new PromotionHistoryAggregationReportError(path, 'invalid promotion stage');
	}
	return value as PromotionSubjectStage;
}

function nullableSha256(value: unknown, path: string): string | null {
	return value === null ? null : sha256Value(value, path);
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
	return value === null ? null : positiveInteger(value, path);
}

function nullableRunId(value: unknown, path: string): string | null {
	return value === null ? null : runId(value, path);
}

function sha256Value(value: unknown, path: string): string {
	if (typeof value !== 'string' || !sha256Pattern.test(value)) throw new PromotionHistoryAggregationReportError(path, 'expected canonical lowercase SHA-256');
	return value;
}

function runId(value: unknown, path: string): string {
	if (typeof value !== 'string' || !runIdPattern.test(value)) throw new PromotionHistoryAggregationReportError(path, 'expected canonical positive decimal run ID');
	return value;
}

function canonicalTimestamp(value: unknown, path: string): string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(value).toISOString() !== value) {
		throw new PromotionHistoryAggregationReportError(path, 'expected canonical ISO timestamp');
	}
	return value;
}

function positiveInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new PromotionHistoryAggregationReportError(path, 'expected positive safe integer');
	return value as number;
}

function nonNegativeInteger(value: unknown, path: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new PromotionHistoryAggregationReportError(path, 'expected non-negative safe integer');
	return value as number;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new PromotionHistoryAggregationReportError(path, 'expected boolean');
	return value;
}

function nonEmptyText(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new PromotionHistoryAggregationReportError(path, 'expected non-empty canonical string');
	return value;
}

function literal(value: unknown, expected: unknown, path: string): void {
	if (value !== expected) throw new PromotionHistoryAggregationReportError(path, `expected ${String(expected)}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PromotionHistoryAggregationReportError(path, 'expected object');
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new PromotionHistoryAggregationReportError(path, 'expected array');
	return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new PromotionHistoryAggregationReportError(path, `expected exactly keys ${wanted.join(', ')}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}