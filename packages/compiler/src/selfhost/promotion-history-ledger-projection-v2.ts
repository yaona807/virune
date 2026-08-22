import { createHash } from 'node:crypto';
import {
	effectivePromotionHistoryRunsV2,
	parsePromotionHistoryLedgerV2,
	type PromotionHistoryEffectiveRunV2,
} from './promotion-history-ledger-v2.js';
import type {
	PromotionShadowHistoryEntryInputV2,
	PromotionShadowHistoryInputV2,
} from './promotion-shadow-history-v2.js';
import type { PromotionSubjectStage } from './promotion-subject.js';

export const PROMOTION_HISTORY_LEDGER_PROJECTION_VERSION = 2 as const;

export interface PromotionHistoryLedgerProjectionV2 {
	readonly version: typeof PROMOTION_HISTORY_LEDGER_PROJECTION_VERSION;
	readonly historyInput: PromotionShadowHistoryInputV2;
	readonly currentProductKnown: boolean;
	readonly latestRunId: string;
	readonly latestSequenceAt: string;
}

export class PromotionHistoryLedgerProjectionError extends Error {
	public override readonly name = 'PromotionHistoryLedgerProjectionError';
}

export function projectPromotionHistoryLedgerV2(value: unknown): PromotionHistoryLedgerProjectionV2 {
	const ledger = parsePromotionHistoryLedgerV2(value).ledger;
	const effectiveRuns = effectivePromotionHistoryRunsV2(ledger);
	if (effectiveRuns.length === 0) throw new PromotionHistoryLedgerProjectionError('promotion history ledger has no formal runs to project');
	const entries = effectiveRuns.map(run => projectEffectiveRun(run, ledger.stage));
	const latest = effectiveRuns.at(-1)!;
	return {
		version: PROMOTION_HISTORY_LEDGER_PROJECTION_VERSION,
		historyInput: { version: 2, stage: ledger.stage, entries },
		currentProductKnown: latest.kind === 'observation',
		latestRunId: latest.runId,
		latestSequenceAt: latest.sequenceAt,
	};
}

function projectEffectiveRun(
	run: PromotionHistoryEffectiveRunV2,
	stage: PromotionSubjectStage,
): PromotionShadowHistoryEntryInputV2 {
	if (run.kind === 'observation') return { ...run.observation };
	const gapRecord = {
		version: PROMOTION_HISTORY_LEDGER_PROJECTION_VERSION,
		kind: 'promotion-history-gap',
		stage,
		runId: run.runId,
		sequenceAt: run.sequenceAt,
		reason: run.reason,
		providerConclusion: run.providerConclusion,
		artifactState: run.artifactState,
	};
	const serializedGap = JSON.stringify(gapRecord);
	return {
		version: 2,
		runId: run.runId,
		stage,
		executionCommit: run.executionCommit,
		promotionSubjectId: sha256(`promotion-history-ledger-gap-subject-v2\n${stage}\n${serializedGap}`),
		completedAt: run.sequenceAt,
		outcome: run.providerConclusion === 'cancelled' ? 'cancelled' : 'infrastructure-failed',
		countsTowardPromotion: true,
		unexplainedDifferentials: 0,
		evidence: [{
			id: 'promotion-history-ledger-gap',
			status: 'failed',
			sha256: sha256(`promotion-history-ledger-gap-evidence-v2\n${stage}\n${serializedGap}`),
		}],
	};
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
