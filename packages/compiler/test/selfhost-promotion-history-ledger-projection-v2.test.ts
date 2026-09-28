import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function observation(runId: string, commit: string, completedAt: string, outcome: 'passed' | 'product-failed') {
	return {
		version: 2 as const,
		runId,
		stage: 'required-selfhost' as const,
		executionCommit: commit,
		promotionSubjectId: subjectA,
		completedAt,
		outcome,
		countsTowardPromotion: true,
		unexplainedDifferentials: 0,
		evidence: [{ id: 'unit-tests', status: outcome === 'passed' ? 'passed' as const : 'failed' as const, sha256: evidenceSha }],
	};
}

function observationReportSha256(value: ReturnType<typeof observation>): string {
	const observationSerialized = JSON.stringify(value);
	return sha256(JSON.stringify({
		schemaVersion: 1,
		claim: 'required-selfhost-promotion-observation',
		productionEligible: false,
		observationSha256: sha256(observationSerialized),
		observation: value,
	}));
}

function attempt(runId: string, commit: string, outcome: 'passed' | 'product-failed'): PromotionHistoryAttemptInputV2 {
	const observed = observation(runId, commit, '2026-08-01T18:49:00.000Z', outcome);
	return {
		attempt: 1,
		startedAt: '2026-08-01T18:47:01.000Z',
		completedAt: '2026-08-01T18:50:00.000Z',
		providerConclusion: outcome === 'passed' ? 'success' : 'failure',
		artifactState: 'valid',
		artifact: {
			archiveSha256: archiveSha,
			bytesSha256: observationReportSha256(observed),
			observation: observed,
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

function run(
	runId: string,
	sequenceAt: string,
	commit: string,
	attempts: readonly PromotionHistoryAttemptInputV2[],
): PromotionHistoryRunInputV2 {
	return { runId, sequenceAt, executionCommit: commit, freezeBoundary: null, promotionEffectiveAttemptCount: attempts.length, attempts };
}

function ledger(runs: readonly PromotionHistoryRunInputV2[]): PromotionHistoryLedgerInputV2 {
	return { version: 2, stage: 'required-selfhost', generation: 1, parentLedgerSha256: null, migration: promotionHistoryMigrationV2(), runs };
}

test('gap projection uses a tombstone Subject without claiming a current Product', () => {
	const projected = projectPromotionHistoryLedgerV2(ledger([
		run('200', '2026-08-02T18:47:00.000Z', '2'.repeat(40), [gap()]),
	]));
	assert.equal(projected.currentProductKnown, false);
	assert.equal(projected.historyInput.entries[0]?.countsTowardPromotion, true);
	assert.equal(projected.historyInput.entries[0]?.outcome, 'infrastructure-failed');
	assert.match(projected.historyInput.entries[0]?.promotionSubjectId ?? '', /^[0-9a-f]{64}$/u);
	assert.notEqual(projected.historyInput.entries[0]?.promotionSubjectId, subjectA);
});

test('real observation projection preserves canonical completion timestamps across UTC day boundaries', () => {
	const commitA = '1'.repeat(40);
	const commitB = '2'.repeat(40);
	const firstBase = attempt('100', commitA, 'passed');
	const secondBase = attempt('200', commitB, 'passed');
	const firstObservation = observation('100', commitA, '2026-08-02T00:30:00.000Z', 'passed');
	const secondObservation = observation('200', commitB, '2026-08-02T18:50:00.000Z', 'passed');
	const first = run('100', '2026-08-01T23:59:00.000Z', commitA, [{
		...firstBase,
		startedAt: '2026-08-01T23:59:01.000Z',
		completedAt: '2026-08-02T00:31:00.000Z',
		artifact: { ...firstBase.artifact!, bytesSha256: observationReportSha256(firstObservation), observation: firstObservation },
	}]);
	const second = run('200', '2026-08-02T18:47:00.000Z', commitB, [{
		...secondBase,
		startedAt: '2026-08-02T18:47:01.000Z',
		completedAt: '2026-08-02T18:51:00.000Z',
		artifact: { ...secondBase.artifact!, bytesSha256: observationReportSha256(secondObservation), observation: secondObservation },
	}]);
	const projected = projectPromotionHistoryLedgerV2(ledger([
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
	const lastBase = attempt('300', '3'.repeat(40), 'passed');
	const lastObservation = observation('300', '3'.repeat(40), '2026-08-03T18:49:00.000Z', 'passed');
	const last = run('300', '2026-08-03T18:47:00.000Z', '3'.repeat(40), [{
		...lastBase,
		startedAt: '2026-08-03T18:47:01.000Z',
		completedAt: '2026-08-03T18:50:00.000Z',
		artifact: { ...lastBase.artifact!, bytesSha256: observationReportSha256(lastObservation), observation: lastObservation },
	}]);
	const projected = projectPromotionHistoryLedgerV2(ledger([
		{ ...first, freezeBoundary: { runId: middleGap.runId, sequenceAt: middleGap.sequenceAt, executionCommit: middleGap.executionCommit }, promotionEffectiveAttemptCount: 1 },
		{ ...middleGap, freezeBoundary: { runId: last.runId, sequenceAt: last.sequenceAt, executionCommit: last.executionCommit }, promotionEffectiveAttemptCount: 1 },
		last,
	]));
	const history = createPromotionShadowHistoryV2(projected.historyInput).history;
	assert.equal(history.successfulRuns, 1);
	assert.equal(history.promotionSubjectId, subjectA);
});

test('product failure for A remains invalidating when A reappears after a gap', () => {
	const first = run('100', '2026-08-01T18:47:00.000Z', '1'.repeat(40), [attempt('100', '1'.repeat(40), 'product-failed')]);
	const middleGap = run('200', '2026-08-02T18:47:00.000Z', '2'.repeat(40), [gap()]);
	const lastBase = attempt('300', '3'.repeat(40), 'passed');
	const lastObservation = observation('300', '3'.repeat(40), '2026-08-03T18:49:00.000Z', 'passed');
	const last = run('300', '2026-08-03T18:47:00.000Z', '3'.repeat(40), [{
		...lastBase,
		startedAt: '2026-08-03T18:47:01.000Z',
		completedAt: '2026-08-03T18:50:00.000Z',
		artifact: { ...lastBase.artifact!, bytesSha256: observationReportSha256(lastObservation), observation: lastObservation },
	}]);
	const projected = projectPromotionHistoryLedgerV2(ledger([
		{ ...first, freezeBoundary: { runId: middleGap.runId, sequenceAt: middleGap.sequenceAt, executionCommit: middleGap.executionCommit }, promotionEffectiveAttemptCount: 1 },
		{ ...middleGap, freezeBoundary: { runId: last.runId, sequenceAt: last.sequenceAt, executionCommit: last.executionCommit }, promotionEffectiveAttemptCount: 1 },
		last,
	]));
	const history = createPromotionShadowHistoryV2(projected.historyInput).history;
	assert.equal(history.productInvalidated, true);
	assert.equal(history.successfulRuns, 0);
});
