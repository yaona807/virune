import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPromotionHistoryLedgerV2,
	effectivePromotionHistoryRunsV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryLedgerInputV2,
	type PromotionHistoryRunInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';
import type { PromotionShadowHistoryEntryInputV2 } from '../src/selfhost/promotion-shadow-history-v2.js';

const subject = 'a'.repeat(64);
const digest = (character: string): string => character.repeat(64);
const commit = (character: string): string => character.repeat(40);

function observation(
	runId: string,
	executionCommit: string,
	outcome: 'passed' | 'product-failed' | 'infrastructure-failed' | 'cancelled' = 'passed',
	completedAt = '2026-08-20T01:10:00.000Z',
): PromotionShadowHistoryEntryInputV2 {
	return {
		version: 2,
		runId,
		stage: 'required-selfhost',
		executionCommit,
		promotionSubjectId: subject,
		completedAt,
		outcome,
		countsTowardPromotion: true,
		unexplainedDifferentials: outcome === 'product-failed' ? 1 : 0,
		evidence: [{ id: 'clean-bootstrap', status: 'passed', sha256: digest('e') }],
	};
}

function artifactAttempt(
	attempt: number,
	runId: string,
	executionCommit: string,
	outcome: 'passed' | 'product-failed' | 'infrastructure-failed' | 'cancelled' = 'passed',
): PromotionHistoryAttemptInputV2 {
	const startedAt = `2026-08-20T0${attempt}:00:00.000Z`;
	const completedAt = `2026-08-20T0${attempt}:20:00.000Z`;
	return {
		attempt,
		startedAt,
		completedAt,
		conclusion: outcome === 'passed' ? 'success' : 'failure',
		artifact: {
			archiveSha256: digest(String(attempt)),
			bytesSha256: digest(String((attempt + 1) % 10)),
			observation: observation(runId, executionCommit, outcome, completedAt),
		},
		gapReason: null,
	};
}

function gapAttempt(attempt: number, reason: 'observation-artifact-missing' | 'workflow-infrastructure-failed' = 'workflow-infrastructure-failed'): PromotionHistoryAttemptInputV2 {
	return {
		attempt,
		startedAt: `2026-08-20T0${attempt}:00:00.000Z`,
		completedAt: `2026-08-20T0${attempt}:20:00.000Z`,
		conclusion: 'failure',
		artifact: null,
		gapReason: reason,
	};
}

function run(
	runId: string,
	sequenceAt: string,
	executionCommit: string,
	attempts: readonly PromotionHistoryAttemptInputV2[],
	frozen = false,
	promotionEffectiveAttemptCount?: number,
): PromotionHistoryRunInputV2 {
	return {
		runId,
		sequenceAt,
		executionCommit,
		frozen,
		...(promotionEffectiveAttemptCount === undefined ? {} : { promotionEffectiveAttemptCount }),
		attempts,
	};
}

function ledger(
	generation: number,
	parentLedgerSha256: string | null,
	runs: readonly PromotionHistoryRunInputV2[],
): PromotionHistoryLedgerInputV2 {
	return {
		version: 2,
		stage: 'required-selfhost',
		generation,
		parentLedgerSha256,
		migration: promotionHistoryMigrationV2(),
		runs,
	};
}

test('genesis ledger is canonical, deterministic, and records zero-credit v1 migration', () => {
	const value = ledger(1, null, [run('100', '2026-08-20T01:00:00.000Z', commit('1'), [artifactAttempt(1, '100', commit('1'))])]);
	const first = createPromotionHistoryLedgerV2(value);
	const second = createPromotionHistoryLedgerV2(value);
	assert.equal(first.serialized, second.serialized);
	assert.equal(first.sha256, second.sha256);
	assert.equal(first.ledger.migration.strategy, 'fresh-v2-no-backfill');
	assert.equal(first.ledger.migration.promotionCreditRuns, 0);
	assert.equal(first.ledger.migration.promotionCreditDays, 0);
	assert.equal(first.ledger.runs[0]?.promotionEffectiveAttemptCount, 1);
});

test('migration decision is exact and immutable', () => {
	const base = ledger(1, null, [run('100', '2026-08-20T01:00:00.000Z', commit('1'), [gapAttempt(1)])]);
	assert.throws(
		() => createPromotionHistoryLedgerV2({ ...base, migration: { ...base.migration, promotionCreditRuns: 1 } }),
		/expected 0/u,
	);
	const parent = createPromotionHistoryLedgerV2(base);
	const child = ledger(2, parent.sha256, [run('100', '2026-08-20T01:00:00.000Z', commit('1'), [gapAttempt(1)], true)]);
	assert.doesNotThrow(() => createPromotionHistoryLedgerV2(child, parent.ledger));
});

test('attempts must be contiguous and exactly one artifact or gap must be present', () => {
	const executionCommit = commit('1');
	const skippedAttempt = { ...artifactAttempt(1, '100', executionCommit), attempt: 2 };
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(1, null, [run('100', '2026-08-20T01:00:00.000Z', executionCommit, [skippedAttempt])])),
		/expected contiguous attempt 1/u,
	);
	const both = { ...artifactAttempt(1, '100', executionCommit), gapReason: 'workflow-infrastructure-failed' as const };
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(1, null, [run('100', '2026-08-20T01:00:00.000Z', executionCommit, [both])])),
		/exactly one of artifact or gapReason/u,
	);
});

test('observation identity is bound to logical run and execution commit', () => {
	const executionCommit = commit('1');
	const wrongRun = artifactAttempt(1, '101', executionCommit);
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(1, null, [run('100', '2026-08-20T01:00:00.000Z', executionCommit, [wrongRun])])),
		/expected 100, received 101/u,
	);
	const wrongCommitAttempt = artifactAttempt(1, '100', commit('2'));
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(1, null, [run('100', '2026-08-20T01:00:00.000Z', executionCommit, [wrongCommitAttempt])])),
		/must match the GitHub run execution commit/u,
	);
});

test('only the trailing run may remain mutable', () => {
	const first = run('100', '2026-08-19T01:00:00.000Z', commit('1'), [gapAttempt(1)], false);
	const second = run('101', '2026-08-20T01:00:00.000Z', commit('2'), [gapAttempt(1)], false);
	assert.throws(() => createPromotionHistoryLedgerV2(ledger(1, null, [first, second])), /before the mutable tail must be frozen/u);
});

test('promotion-effective attempt count is bounded and a mutable tail cannot hide retained attempts', () => {
	const executionCommit = commit('1');
	const attempts = [gapAttempt(1), artifactAttempt(2, '100', executionCommit)];
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(1, null, [run('100', '2026-08-20T01:00:00.000Z', executionCommit, attempts, false, 1)])),
		/mutable tail must treat every retained attempt as promotion-effective/u,
	);
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(1, null, [run('100', '2026-08-20T01:00:00.000Z', executionCommit, attempts, true, 3)])),
		/cannot exceed retained provider attempt count/u,
	);
});

test('mutable tail may extend attempts prefix-preservingly and recover infrastructure failure', () => {
	const executionCommit = commit('1');
	const parent = createPromotionHistoryLedgerV2(ledger(1, null, [
		run('100', '2026-08-20T01:00:00.000Z', executionCommit, [gapAttempt(1)]),
	]));
	const child = ledger(2, parent.sha256, [
		run('100', '2026-08-20T01:00:00.000Z', executionCommit, [gapAttempt(1), artifactAttempt(2, '100', executionCommit)]),
	]);
	const result = createPromotionHistoryLedgerV2(child, parent.ledger);
	const effective = effectivePromotionHistoryRunsV2(result.ledger);
	assert.equal(effective[0]?.kind, 'observation');
	if (effective[0]?.kind === 'observation') assert.equal(effective[0].observation.outcome, 'passed');
});

test('existing attempts cannot be rewritten while extending the mutable tail', () => {
	const executionCommit = commit('1');
	const parent = createPromotionHistoryLedgerV2(ledger(1, null, [
		run('100', '2026-08-20T01:00:00.000Z', executionCommit, [gapAttempt(1)]),
	]));
	const changedFirstAttempt = { ...gapAttempt(1), conclusion: 'cancelled' };
	const child = ledger(2, parent.sha256, [
		run('100', '2026-08-20T01:00:00.000Z', executionCommit, [changedFirstAttempt, artifactAttempt(2, '100', executionCommit)]),
	]);
	assert.throws(() => createPromotionHistoryLedgerV2(child, parent.ledger), /existing attempts are immutable/u);
});

test('product failure cannot be healed by a later rerun', () => {
	const executionCommit = commit('1');
	const parent = createPromotionHistoryLedgerV2(ledger(1, null, [
		run('100', '2026-08-20T01:00:00.000Z', executionCommit, [artifactAttempt(1, '100', executionCommit, 'product-failed')]),
	]));
	const child = ledger(2, parent.sha256, [
		run('100', '2026-08-20T01:00:00.000Z', executionCommit, [
			artifactAttempt(1, '100', executionCommit, 'product-failed'),
			artifactAttempt(2, '100', executionCommit, 'passed'),
		]),
	]);
	const result = createPromotionHistoryLedgerV2(child, parent.ledger);
	const effective = effectivePromotionHistoryRunsV2(result.ledger);
	assert.equal(effective[0]?.kind, 'observation');
	if (effective[0]?.kind === 'observation') assert.equal(effective[0].observation.outcome, 'product-failed');
});

test('appending a later formal run freezes the previous mutable tail', () => {
	const parentCommit = commit('1');
	const parent = createPromotionHistoryLedgerV2(ledger(1, null, [
		run('100', '2026-08-19T01:00:00.000Z', parentCommit, [gapAttempt(1)]),
	]));
	const invalidChild = ledger(2, parent.sha256, [
		run('100', '2026-08-19T01:00:00.000Z', parentCommit, [gapAttempt(1)], false),
		run('101', '2026-08-20T01:00:00.000Z', commit('2'), [gapAttempt(1)], false),
	]);
	assert.throws(() => createPromotionHistoryLedgerV2(invalidChild, parent.ledger), /must freeze before a later formal run is appended/u);
	const validChild = ledger(2, parent.sha256, [
		run('100', '2026-08-19T01:00:00.000Z', parentCommit, [gapAttempt(1)], true),
		run('101', '2026-08-20T01:00:00.000Z', commit('2'), [gapAttempt(1)], false),
	]);
	assert.doesNotThrow(() => createPromotionHistoryLedgerV2(validChild, parent.ledger));
});

test('frozen history keeps identity and effective prefix immutable while allowing an append-only audit suffix', () => {
	const executionCommit = commit('1');
	const firstAttempt = artifactAttempt(1, '100', executionCommit, 'passed');
	const parent = createPromotionHistoryLedgerV2(ledger(1, null, [
		run('100', '2026-08-19T01:00:00.000Z', executionCommit, [firstAttempt], true, 1),
	]));
	const auditAttempt = artifactAttempt(2, '100', executionCommit, 'product-failed');
	const child = ledger(2, parent.sha256, [
		run('100', '2026-08-19T01:00:00.000Z', executionCommit, [firstAttempt, auditAttempt], true, 1),
	]);
	const result = createPromotionHistoryLedgerV2(child, parent.ledger);
	assert.equal(result.ledger.runs[0]?.attempts.length, 2);
	assert.equal(result.ledger.runs[0]?.promotionEffectiveAttemptCount, 1);
	const effective = effectivePromotionHistoryRunsV2(result.ledger)[0];
	assert.equal(effective?.kind === 'observation' ? effective.observation.outcome : null, 'passed');
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(2, parent.sha256, [
			run('100', '2026-08-19T01:00:00.000Z', executionCommit, [firstAttempt, auditAttempt], true, 2),
		]), parent.ledger),
		/frozen promotion-effective attempt prefix is immutable/u,
	);
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger(2, parent.sha256, [
			run('100', '2026-08-19T01:00:00.000Z', executionCommit, [{ ...firstAttempt, conclusion: 'failure' }, auditAttempt], true, 1),
		]), parent.ledger),
		/existing attempts are immutable/u,
	);
});

test('lineage requires exact generation and parent hash', () => {
	const parent = createPromotionHistoryLedgerV2(ledger(1, null, []));
	assert.throws(() => createPromotionHistoryLedgerV2(ledger(3, parent.sha256, []), parent.ledger), /expected 2/u);
	assert.throws(() => createPromotionHistoryLedgerV2(ledger(2, digest('f'), []), parent.ledger), /parentLedgerSha256/u);
});

test('gaps remain explicit effective records and never disappear', () => {
	const result = createPromotionHistoryLedgerV2(ledger(1, null, [
		run('100', '2026-08-20T01:00:00.000Z', commit('1'), [gapAttempt(1, 'observation-artifact-missing')]),
	]));
	assert.deepEqual(effectivePromotionHistoryRunsV2(result.ledger), [{
		kind: 'gap',
		runId: '100',
		sequenceAt: '2026-08-20T01:00:00.000Z',
		frozen: false,
		reason: 'observation-artifact-missing',
	}]);
});
