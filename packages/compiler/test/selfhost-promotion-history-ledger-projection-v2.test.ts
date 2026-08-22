import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromotionShadowHistoryV2 } from '../src/selfhost/promotion-shadow-history-v2.js';
import {
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryLedgerInputV2,
	type PromotionHistoryRunInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';
import { projectPromotionHistoryLedgerV2 } from '../src/selfhost/promotion-history-ledger-projection-v2.js';

const subjectA = 'a'.repeat(64);
const evidenceSha = 'c'.repeat(64);
const archiveSha = 'd'.repeat(64);
const bytesSha = 'e'.repeat(64);

function attempt(runId: string, commit: string, outcome: 'passed' | 'product-failed'): PromotionHistoryAttemptInputV2 {
	return {
		attempt: 1,
		startedAt: '2026-08-01T18:47:01.000Z',
		completedAt: '2026-08-01T18:50:00.000Z',
		providerConclusion: outcome === 'passed' ? 'success' : 'failure',
		artifactState: 'valid',
		artifact: {
			archiveSha256: archiveSha,
			bytesSha256: bytesSha,
			observation: {
				version: 2,
				runId,
				stage: 'required-selfhost',
				executionCommit: commit,
				promotionSubjectId: subjectA,
				completedAt: '2026-08-01T18:49:00.000Z',
				outcome,
				countsTowardPromotion: true,
				unexplainedDifferentials: 0,
				evidence: [{ id: 'unit-tests', status: outcome === 'passed' ? 'passed' : 'failed', sha256: evidenceSha }],
			},
		},
	};
}

function gap(attemptNumber = 1): PromotionHistoryAttemptInputV2 {
	return {
		attempt: attemptNumber,
		startedAt: '2026-08-02T18:47:01.000Z',
		completedAt: '2026-08-02T18:50:00.000Z',
		providerConclusion: 'failure',
		artifactState: 'missing',
		artifact: null,
	};
}

function run(runId: string, sequenceAt: string, commit: string, attempts: readonly PromotionHistoryAttemptInputV2[]): PromotionHistoryRunInputV2 {
	return { runId, sequenceAt, executionCommit: commit, freezeBoundary: null, promotionEffectiveAttemptCount: attempts.length, attempts };
}

function ledger(stage: 'required-selfhost' | 'required-compiler', runs: readonly PromotionHistoryRunInputV2[]): PromotionHistoryLedgerInputV2 {
	return { version: 2, stage, generation: 1, parentLedgerSha256: null, migration: promotionHistoryMigrationV2(), runs };
}

test('gap projection uses a stage-domain-separated synthetic Subject identity', () => {
	const runValue = run('200', '2026-08-02T18:47:00.000Z', '2'.repeat(40), [gap()]);
	const selfhost = projectPromotionHistoryLedgerV2(ledger('required-selfhost', [runValue]));
	const compiler = projectPromotionHistoryLedgerV2(ledger('required-compiler', [runValue]));
	assert.notEqual(selfhost.historyInput.entries[0]?.promotionSubjectId, compiler.historyInput.entries[0]?.promotionSubjectId);
	assert.equal(selfhost.currentProductKnown, false);
	assert.equal(selfhost.historyInput.entries[0]?.countsTowardPromotion, true);
	assert.equal(selfhost.historyInput.entries[0]?.outcome, 'infrastructure-failed');
});

test('real observation projection preserves canonical completion timestamps across UTC day boundaries', () => {
	const commitA = '1'.repeat(40);
	const commitB = '2'.repeat(40);
	const firstBase = attempt('100', commitA, 'passed');
	const secondBase = attempt('200', commitB, 'passed');
	const first = run('100', '2026-08-01T23:59:00.000Z', commitA, [{
		...firstBase,
		startedAt: '2026-08-01T23:59:01.000Z',
		completedAt: '2026-08-02T00:31:00.000Z',
		artifact: {
			...firstBase.artifact!,
			observation: { ...firstBase.artifact!.observation, completedAt: '2026-08-02T00:30:00.000Z' },
		},
	}]);
	const second = run('200', '2026-08-02T18:47:00.000Z', commitB, [{
		...secondBase,
		startedAt: '2026-08-02T18:47:01.000Z',
		completedAt: '2026-08-02T18:51:00.000Z',
		artifact: {
			...secondBase.artifact!,
			observation: { ...secondBase.artifact!.observation, completedAt: '2026-08-02T18:50:00.000Z' },
		},
	}]);
	const projected = projectPromotionHistoryLedgerV2(ledger('required-selfhost', [
		{ ...first, freezeBoundary: { runId: second.runId, sequenceAt: second.sequenceAt, executionCommit: second.executionCommit }, promotionEffectiveAttemptCount: 1 },
		second,
	]));
	assert.deepEqual(projected.historyInput.entries.map(entry => entry.completedAt), [
		'2026-08-02T00:30:00.000Z',
		'2026-08-02T18:50:00.000Z',
	]);
	const history = createPromotionShadowHistoryV2(projected.historyInput).history;
	assert.equal(history.observationDays, 1);
});

test('A -> gap -> A breaks the trailing successful streak', () => {
	const first = run('100', '2026-08-01T18:47:00.000Z', '1'.repeat(40), [attempt('100', '1'.repeat(40), 'passed')]);
	const middleGap = run('200', '2026-08-02T18:47:00.000Z', '2'.repeat(40), [gap()]);
	const last = run('300', '2026-08-03T18:47:00.000Z', '3'.repeat(40), [{
		...attempt('300', '3'.repeat(40), 'passed'),
		startedAt: '2026-08-03T18:47:01.000Z',
		completedAt: '2026-08-03T18:50:00.000Z',
		artifact: { ...attempt('300', '3'.repeat(40), 'passed').artifact!, observation: { ...attempt('300', '3'.repeat(40), 'passed').artifact!.observation, completedAt: '2026-08-03T18:49:00.000Z' } },
	}]);
	const freezeFirst = { runId: middleGap.runId, sequenceAt: middleGap.sequenceAt, executionCommit: middleGap.executionCommit };
	const freezeGap = { runId: last.runId, sequenceAt: last.sequenceAt, executionCommit: last.executionCommit };
	const projected = projectPromotionHistoryLedgerV2(ledger('required-selfhost', [
		{ ...first, freezeBoundary: freezeFirst, promotionEffectiveAttemptCount: 1 },
		{ ...middleGap, freezeBoundary: freezeGap, promotionEffectiveAttemptCount: 1 },
		last,
	]));
	const history = createPromotionShadowHistoryV2(projected.historyInput).history;
	assert.equal(history.successfulRuns, 1);
	assert.equal(history.promotionSubjectId, subjectA);
});

test('product failure for A remains invalidating when A reappears after a gap', () => {
	const first = run('100', '2026-08-01T18:47:00.000Z', '1'.repeat(40), [attempt('100', '1'.repeat(40), 'product-failed')]);
	const middleGap = run('200', '2026-08-02T18:47:00.000Z', '2'.repeat(40), [gap()]);
	const lastAttempt = attempt('300', '3'.repeat(40), 'passed');
	const last = run('300', '2026-08-03T18:47:00.000Z', '3'.repeat(40), [{
		...lastAttempt,
		startedAt: '2026-08-03T18:47:01.000Z',
		completedAt: '2026-08-03T18:50:00.000Z',
		artifact: { ...lastAttempt.artifact!, observation: { ...lastAttempt.artifact!.observation, completedAt: '2026-08-03T18:49:00.000Z' } },
	}]);
	const projected = projectPromotionHistoryLedgerV2(ledger('required-selfhost', [
		{ ...first, freezeBoundary: { runId: '200', sequenceAt: middleGap.sequenceAt, executionCommit: middleGap.executionCommit }, promotionEffectiveAttemptCount: 1 },
		{ ...middleGap, freezeBoundary: { runId: '300', sequenceAt: last.sequenceAt, executionCommit: last.executionCommit }, promotionEffectiveAttemptCount: 1 },
		last,
	]));
	const history = createPromotionShadowHistoryV2(projected.historyInput).history;
	assert.equal(history.productInvalidated, true);
	assert.equal(history.successfulRuns, 0);
});
