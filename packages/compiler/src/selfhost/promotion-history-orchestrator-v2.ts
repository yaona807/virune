import { createHash } from 'node:crypto';
import {
	aggregatePromotionHistoryV2,
	type PromotionAggregationRunSnapshotV2,
	type PromotionAggregationLateAttemptV2,
} from './promotion-history-aggregation-v2.js';
import {
	parsePromotionHistoryLedgerV2,
	type PromotionHistoryLedgerV2,
} from './promotion-history-ledger-v2.js';
import { projectPromotionHistoryLedgerV2 } from './promotion-history-ledger-projection-v2.js';
import {
	replayPromotionHistoryAgainstPolicyV2,
	type PromotionPolicyReplayV2,
} from './promotion-policy-replay-v2.js';
import type { PromotionSubjectStage } from './promotion-subject.js';

export const PROMOTION_HISTORY_ORCHESTRATOR_VERSION = 2 as const;
export const PROMOTION_HISTORY_AGGREGATION_CLAIM = 'selfhost-promotion-history-aggregation-v2' as const;

export interface PromotionHistoryAggregationTriggerV2 {
	readonly aggregationRunId: string;
	readonly aggregationAttempt: number;
	readonly observationRunId: string;
}

export interface PromotionHistoryPolicySummaryV2 {
	readonly promotionSubjectId: string | null;
	readonly successfulRuns: number;
	readonly observationDays: number;
	readonly productInvalidated: boolean;
	readonly unexplainedDifferentials: number;
	readonly historyThresholdsSatisfied: boolean;
	readonly requiredEvidence: readonly string[];
}

export interface PromotionHistoryAggregationReportV2 {
	readonly version: typeof PROMOTION_HISTORY_ORCHESTRATOR_VERSION;
	readonly claim: typeof PROMOTION_HISTORY_AGGREGATION_CLAIM;
	readonly productionEligible: false;
	readonly automaticPromotion: false;
	readonly stage: PromotionSubjectStage;
	readonly trigger: PromotionHistoryAggregationTriggerV2;
	readonly publish: boolean;
	readonly parentLedgerSha256: string | null;
	readonly publishedLedgerSha256: string | null;
	readonly currentLedgerSha256: string | null;
	readonly currentLedgerGeneration: number | null;
	readonly processedRunIds: readonly string[];
	readonly blockedByRunId: string | null;
	readonly lateAttempts: readonly PromotionAggregationLateAttemptV2[];
	readonly currentProductKnown: boolean;
	readonly policy: PromotionHistoryPolicySummaryV2 | null;
	readonly migration: PromotionHistoryLedgerV2['migration'] | null;
}

export interface PromotionHistoryOrchestratorResultV2 {
	readonly report: PromotionHistoryAggregationReportV2;
	readonly serializedReport: string;
	readonly reportSha256: string;
	readonly ledger: PromotionHistoryLedgerV2 | null;
	readonly serializedLedger: string | null;
	readonly ledgerSha256: string | null;
	readonly policyReplay: PromotionPolicyReplayV2 | null;
}

export class PromotionHistoryOrchestratorError extends Error {
	public override readonly name = 'PromotionHistoryOrchestratorError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const runIdPattern = /^[1-9][0-9]*$/u;

export function orchestratePromotionHistoryV2(input: {
	readonly stage: PromotionSubjectStage;
	readonly policy: unknown;
	readonly trigger: PromotionHistoryAggregationTriggerV2;
	readonly parent?: PromotionHistoryLedgerV2 | unknown;
	readonly runs: readonly PromotionAggregationRunSnapshotV2[];
}): PromotionHistoryOrchestratorResultV2 {
	const trigger = parseTrigger(input.trigger);
	const parent = input.parent === undefined ? null : parsePromotionHistoryLedgerV2(input.parent);
	const aggregation = aggregatePromotionHistoryV2({
		stage: input.stage,
		...(parent === null ? {} : { parent: parent.ledger }),
		runs: input.runs,
	});
	const canonicalPublish = trigger.aggregationAttempt === 1 && aggregation.publish;
	const currentLedgerResult = canonicalPublish ? aggregation.ledger : parent;
	let policyReplay: PromotionPolicyReplayV2 | null = null;
	let currentProductKnown = false;
	let policySummary: PromotionHistoryPolicySummaryV2 | null = null;
	if (currentLedgerResult !== null && currentLedgerResult.ledger.runs.length > 0) {
		const projection = projectPromotionHistoryLedgerV2(currentLedgerResult.ledger);
		policyReplay = replayPromotionHistoryAgainstPolicyV2(input.policy, input.stage, projection.historyInput);
		currentProductKnown = projection.currentProductKnown;
		policySummary = {
			promotionSubjectId: projection.currentProductKnown ? policyReplay.promotionSubjectId : null,
			successfulRuns: policyReplay.successfulRuns,
			observationDays: policyReplay.observationDays,
			productInvalidated: policyReplay.productInvalidated,
			unexplainedDifferentials: policyReplay.unexplainedDifferentials,
			historyThresholdsSatisfied: projection.currentProductKnown && policyReplay.historyThresholdsSatisfied,
			requiredEvidence: policyReplay.requiredEvidence,
		};
	}
	const report: PromotionHistoryAggregationReportV2 = {
		version: PROMOTION_HISTORY_ORCHESTRATOR_VERSION,
		claim: PROMOTION_HISTORY_AGGREGATION_CLAIM,
		productionEligible: false,
		automaticPromotion: false,
		stage: input.stage,
		trigger,
		publish: canonicalPublish,
		parentLedgerSha256: parent?.sha256 ?? null,
		publishedLedgerSha256: canonicalPublish ? aggregation.ledger?.sha256 ?? null : null,
		currentLedgerSha256: currentLedgerResult?.sha256 ?? null,
		currentLedgerGeneration: currentLedgerResult?.ledger.generation ?? null,
		processedRunIds: [...aggregation.processedRunIds].sort(compareRunIds),
		blockedByRunId: aggregation.blockedByRunId,
		lateAttempts: aggregation.lateAttempts,
		currentProductKnown,
		policy: policySummary,
		migration: currentLedgerResult?.ledger.migration ?? null,
	};
	const serializedReport = JSON.stringify(report);
	return {
		report,
		serializedReport,
		reportSha256: sha256(serializedReport),
		ledger: canonicalPublish ? aggregation.ledger?.ledger ?? null : null,
		serializedLedger: canonicalPublish ? aggregation.ledger?.serialized ?? null : null,
		ledgerSha256: canonicalPublish ? aggregation.ledger?.sha256 ?? null : null,
		policyReplay,
	};
}

function parseTrigger(value: PromotionHistoryAggregationTriggerV2): PromotionHistoryAggregationTriggerV2 {
	if (!runIdPattern.test(value.aggregationRunId)) throw new PromotionHistoryOrchestratorError('trigger.aggregationRunId', 'expected canonical positive decimal run ID');
	if (!Number.isSafeInteger(value.aggregationAttempt) || value.aggregationAttempt <= 0) {
		throw new PromotionHistoryOrchestratorError('trigger.aggregationAttempt', 'expected positive safe integer');
	}
	if (!runIdPattern.test(value.observationRunId)) throw new PromotionHistoryOrchestratorError('trigger.observationRunId', 'expected canonical positive decimal run ID');
	return {
		aggregationRunId: value.aggregationRunId,
		aggregationAttempt: value.aggregationAttempt,
		observationRunId: value.observationRunId,
	};
}

function compareRunIds(left: string, right: string): number {
	const leftId = BigInt(left);
	const rightId = BigInt(right);
	return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
