import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPromotionShadowHistoryV2,
	type PromotionObservationOutcome,
	type PromotionShadowHistoryEntryInputV2,
} from '../src/selfhost/promotion-shadow-history-v2.js';

const subjectA = 'a'.repeat(64);
const subjectB = 'b'.repeat(64);
const commit = (character: string): string => character.repeat(40);
const evidence = (character: string): string => character.repeat(64);

function entry(
	runId: string,
	completedAt: string,
	options: {
		readonly executionCommit?: string;
		readonly promotionSubjectId?: string;
		readonly outcome?: PromotionObservationOutcome;
		readonly countsTowardPromotion?: boolean;
		readonly unexplainedDifferentials?: number;
		readonly evidence?: readonly { readonly id: string; readonly status: 'passed' | 'failed'; readonly sha256: string }[];
	} = {},
): PromotionShadowHistoryEntryInputV2 {
	return {
		version: 2,
		runId,
		stage: 'required-selfhost',
		executionCommit: options.executionCommit ?? commit('1'),
		promotionSubjectId: options.promotionSubjectId ?? subjectA,
		completedAt,
		outcome: options.outcome ?? 'passed',
		countsTowardPromotion: options.countsTowardPromotion ?? true,
		unexplainedDifferentials: options.unexplainedDifferentials ?? 0,
		evidence: options.evidence ?? [{ id: 'stage2-stage3-fixed-point', status: 'passed', sha256: evidence(runId.endsWith('1') ? '1' : runId.endsWith('2') ? '2' : '3') }],
	};
}

function history(entries: readonly PromotionShadowHistoryEntryInputV2[]) {
	return { version: 2 as const, stage: 'required-selfhost' as const, entries };
}

test('unchanged promotion subject continues across different execution commits', () => {
	const result = createPromotionShadowHistoryV2(history([
		entry('run-1', '2026-08-18T01:00:00.000Z', { executionCommit: commit('1') }),
		entry('run-2', '2026-08-19T01:00:00.000Z', { executionCommit: commit('2') }),
		entry('run-3', '2026-08-20T01:00:00.000Z', { executionCommit: commit('3') }),
	]));
	assert.equal(result.history.promotionSubjectId, subjectA);
	assert.equal(result.history.successfulRuns, 3);
	assert.equal(result.history.observationDays, 3);
	assert.equal(result.history.firstSuccessfulAt, '2026-08-18T01:00:00.000Z');
	assert.equal(result.history.productInvalidated, false);
});

test('subject changes reset history and A to B to A cannot resurrect the first A segment', () => {
	const result = createPromotionShadowHistoryV2(history([
		entry('run-1', '2026-08-17T01:00:00.000Z'),
		entry('run-2', '2026-08-18T01:00:00.000Z'),
		entry('run-3', '2026-08-19T01:00:00.000Z', { promotionSubjectId: subjectB }),
		entry('run-4', '2026-08-20T01:00:00.000Z', { promotionSubjectId: subjectA }),
	]));
	assert.equal(result.history.promotionSubjectId, subjectA);
	assert.equal(result.history.successfulRuns, 1);
	assert.equal(result.history.observationDays, 1);
	assert.equal(result.history.firstSuccessfulAt, '2026-08-20T01:00:00.000Z');
});

test('non-counting diagnostics on different subjects neither move nor break the formal subject streak', () => {
	const result = createPromotionShadowHistoryV2(history([
		entry('run-1', '2026-08-18T01:00:00.000Z'),
		entry('diag-1', '2026-08-18T12:00:00.000Z', {
			promotionSubjectId: subjectB,
			outcome: 'product-failed',
			countsTowardPromotion: false,
			unexplainedDifferentials: 7,
		}),
		entry('run-2', '2026-08-19T01:00:00.000Z'),
		entry('diag-2', '2026-08-20T01:00:00.000Z', {
			promotionSubjectId: subjectB,
			countsTowardPromotion: false,
		}),
	]));
	assert.equal(result.history.promotionSubjectId, subjectA);
	assert.equal(result.history.successfulRuns, 2);
	assert.equal(result.history.observationDays, 2);
	assert.equal(result.history.firstSuccessfulAt, '2026-08-18T01:00:00.000Z');
	assert.equal(result.history.latestCompletedAt, '2026-08-20T01:00:00.000Z');
	assert.equal(result.history.productInvalidated, false);
	assert.equal(result.history.unexplainedDifferentials, 0);
});

test('history with only non-counting diagnostics exposes the latest subject with no formal streak', () => {
	const result = createPromotionShadowHistoryV2(history([
		entry('diag-1', '2026-08-19T01:00:00.000Z', { countsTowardPromotion: false }),
		entry('diag-2', '2026-08-20T01:00:00.000Z', {
			promotionSubjectId: subjectB,
			outcome: 'infrastructure-failed',
			countsTowardPromotion: false,
		}),
	]));
	assert.equal(result.history.promotionSubjectId, subjectB);
	assert.equal(result.history.successfulRuns, 0);
	assert.equal(result.history.observationDays, 0);
	assert.equal(result.history.firstSuccessfulAt, null);
	assert.equal(result.history.productInvalidated, false);
});

test('counting infrastructure or cancellation resets the streak without invalidating the subject', () => {
	for (const outcome of ['infrastructure-failed', 'cancelled'] as const) {
		const result = createPromotionShadowHistoryV2(history([
			entry('run-1', '2026-08-18T01:00:00.000Z'),
			entry('run-2', '2026-08-19T01:00:00.000Z', { outcome }),
			entry('run-3', '2026-08-20T01:00:00.000Z'),
		]));
		assert.equal(result.history.successfulRuns, 1, outcome);
		assert.equal(result.history.productInvalidated, false, outcome);
		assert.equal(result.history.unexplainedDifferentials, 0, outcome);
	}
});

test('infrastructure and cancellation outcomes cannot carry permanent product differentials', () => {
	for (const outcome of ['infrastructure-failed', 'cancelled'] as const) {
		assert.throws(
			() => createPromotionShadowHistoryV2(history([
				entry('run-1', '2026-08-20T01:00:00.000Z', { outcome, unexplainedDifferentials: 1 }),
			])),
			/only product-failed observations may have unexplained differentials/u,
			outcome,
		);
	}
});

test('counting product failure invalidates the current subject even after later success', () => {
	const result = createPromotionShadowHistoryV2(history([
		entry('run-1', '2026-08-18T01:00:00.000Z'),
		entry('run-2', '2026-08-19T01:00:00.000Z', { outcome: 'product-failed', unexplainedDifferentials: 2 }),
		entry('run-3', '2026-08-20T01:00:00.000Z'),
	]));
	assert.equal(result.history.productInvalidated, true);
	assert.equal(result.history.successfulRuns, 0);
	assert.equal(result.history.observationDays, 0);
	assert.equal(result.history.firstSuccessfulAt, null);
	assert.equal(result.history.unexplainedDifferentials, 2);
});

test('a counting product failure remains invalid if the same subject identity reappears later', () => {
	const result = createPromotionShadowHistoryV2(history([
		entry('run-1', '2026-08-16T01:00:00.000Z', { outcome: 'product-failed', unexplainedDifferentials: 1 }),
		entry('run-2', '2026-08-17T01:00:00.000Z', { promotionSubjectId: subjectB }),
		entry('run-3', '2026-08-18T01:00:00.000Z', { promotionSubjectId: subjectA }),
	]));
	assert.equal(result.history.promotionSubjectId, subjectA);
	assert.equal(result.history.productInvalidated, true);
	assert.equal(result.history.successfulRuns, 0);
	assert.equal(result.history.observationDays, 0);
	assert.equal(result.history.unexplainedDifferentials, 1);
});

test('same-day successes increase runs but not distinct observation days', () => {
	const result = createPromotionShadowHistoryV2(history([
		entry('run-1', '2026-08-20T01:00:00.000Z'),
		entry('run-2', '2026-08-20T12:00:00.000Z'),
	]));
	assert.equal(result.history.successfulRuns, 2);
	assert.equal(result.history.observationDays, 1);
});

test('aggregate unexplained differentials must remain within safe integer range', () => {
	assert.throws(
		() => createPromotionShadowHistoryV2(history([
			entry('run-1', '2026-08-19T01:00:00.000Z', {
				outcome: 'product-failed',
				unexplainedDifferentials: Number.MAX_SAFE_INTEGER,
			}),
			entry('run-2', '2026-08-20T01:00:00.000Z', {
				outcome: 'product-failed',
				unexplainedDifferentials: 1,
			}),
		])),
		/aggregate unexplained differentials exceed safe integer range/u,
	);
});

test('timestamps reject extended years that cannot participate in fixed-width UTC-day counting', () => {
	assert.throws(
		() => createPromotionShadowHistoryV2(history([
			entry('run-1', '+010000-01-01T00:00:00.000Z'),
		])),
		/canonical UTC ISO timestamp/u,
	);
});

test('evidence is canonicalized and retained so future policy can re-evaluate old runs', () => {
	const result = createPromotionShadowHistoryV2(history([
		entry('run-1', '2026-08-20T01:00:00.000Z', {
			evidence: [
				{ id: 'z-evidence', status: 'passed', sha256: evidence('2') },
				{ id: 'a-evidence', status: 'passed', sha256: evidence('1') },
			],
		}),
	]));
	assert.deepEqual(result.history.entries[0]?.evidence.map(item => item.id), ['a-evidence', 'z-evidence']);
	assert.equal(result.sha256.length, 64);
	assert.equal(result.serialized, JSON.stringify(result.history));
	const replay = createPromotionShadowHistoryV2({
		version: result.history.version,
		stage: result.history.stage,
		entries: result.history.entries,
	});
	assert.equal(replay.serialized, result.serialized);
	assert.equal(replay.sha256, result.sha256);
});

test('history rejects duplicate, unordered, stage-mismatched, and non-canonical evidence', () => {
	const first = entry('run-1', '2026-08-19T01:00:00.000Z');
	const second = entry('run-2', '2026-08-20T01:00:00.000Z');
	assert.throws(() => createPromotionShadowHistoryV2(history([first, { ...second, runId: first.runId }])), /duplicate runId/u);
	assert.throws(() => createPromotionShadowHistoryV2(history([second, first])), /strictly ordered/u);
	assert.throws(() => createPromotionShadowHistoryV2(history([{ ...first, stage: 'required-compiler' }])), /expected required-selfhost/u);
	assert.throws(() => createPromotionShadowHistoryV2(history([{ ...first, executionCommit: 'A'.repeat(40) }])), /lowercase 40-character Git SHA/u);
	assert.throws(() => createPromotionShadowHistoryV2(history([{ ...first, promotionSubjectId: 'A'.repeat(64) }])), /lowercase 64-character SHA-256/u);
	assert.throws(() => createPromotionShadowHistoryV2(history([{ ...first, unexplainedDifferentials: 1 }])), /only product-failed observations may have unexplained differentials/u);
	assert.throws(() => createPromotionShadowHistoryV2(history([{ ...first, evidence: [{ id: 'required', status: 'failed', sha256: evidence('f') }] }])), /passed observations cannot contain failed evidence/u);
	assert.throws(() => createPromotionShadowHistoryV2(history([{ ...first, evidence: [first.evidence[0]!, first.evidence[0]!] }])), /duplicate evidence id/u);
	assert.throws(
		() => createPromotionShadowHistoryV2({ version: 2, stage: 'required-selfhost', entries: [{ ...first, repository: 'yaona807/virune' }] }),
		/expected exactly keys/u,
	);
});
