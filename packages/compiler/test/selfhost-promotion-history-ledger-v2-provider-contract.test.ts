import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPromotionHistoryLedgerV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryLedgerInputV2,
	type PromotionHistoryRunInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';
import type { PromotionShadowHistoryEntryInputV2 } from '../src/selfhost/promotion-shadow-history-v2.js';

const sha256 = 'a'.repeat(64);
const commit = '1'.repeat(40);

function observation(runId: string): PromotionShadowHistoryEntryInputV2 {
	return {
		version: 2,
		runId,
		stage: 'required-selfhost',
		executionCommit: commit,
		promotionSubjectId: 'b'.repeat(64),
		completedAt: '2026-08-20T01:20:00.000Z',
		outcome: 'passed',
		countsTowardPromotion: true,
		unexplainedDifferentials: 0,
		evidence: [{ id: 'clean-bootstrap', status: 'passed', sha256 }],
	};
}

function passingAttempt(runId: string, conclusion = 'success'): PromotionHistoryAttemptInputV2 {
	return {
		attempt: 1,
		startedAt: '2026-08-20T01:00:00.000Z',
		completedAt: '2026-08-20T01:20:00.000Z',
		conclusion,
		artifact: { archiveSha256: sha256, bytesSha256: 'c'.repeat(64), observation: observation(runId) },
		gapReason: null,
	};
}

function gapAttempt(conclusion = 'failure'): PromotionHistoryAttemptInputV2 {
	return {
		attempt: 1,
		startedAt: '2026-08-20T01:00:00.000Z',
		completedAt: '2026-08-20T01:20:00.000Z',
		conclusion,
		artifact: null,
		gapReason: 'workflow-infrastructure-failed',
	};
}

function ledger(runs: readonly PromotionHistoryRunInputV2[]): PromotionHistoryLedgerInputV2 {
	return {
		version: 2,
		stage: 'required-selfhost',
		generation: 1,
		parentLedgerSha256: null,
		migration: promotionHistoryMigrationV2(),
		runs,
	};
}

test('GitHub run IDs are canonical positive decimal strings', () => {
	for (const runId of ['run-1', '01', '0', '-1', ' 1']) {
		assert.throws(() => createPromotionHistoryLedgerV2(ledger([{
			runId,
			sequenceAt: '2026-08-20T01:00:00.000Z',
			executionCommit: commit,
			frozen: false,
			attempts: [gapAttempt()],
		}])), /canonical positive decimal GitHub run ID/u, runId);
	}
});

test('same-timestamp run ordering uses numeric GitHub run identity', () => {
	const run9: PromotionHistoryRunInputV2 = {
		runId: '9', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: true, attempts: [gapAttempt()],
	};
	const run10: PromotionHistoryRunInputV2 = {
		runId: '10', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: false, attempts: [gapAttempt()],
	};
	assert.doesNotThrow(() => createPromotionHistoryLedgerV2(ledger([run9, run10])));
	assert.throws(() => createPromotionHistoryLedgerV2(ledger([{ ...run10, frozen: true }, { ...run9, frozen: false }])), /strictly ordered/u);
});

test('first provider attempt cannot start before logical run creation', () => {
	const attempt = { ...gapAttempt(), startedAt: '2026-08-20T00:59:59.999Z' };
	assert.throws(() => createPromotionHistoryLedgerV2(ledger([{
		runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: false, attempts: [attempt],
	}])), /cannot start before the logical run creation time/u);
});

test('passing observation requires a successful workflow conclusion', () => {
	assert.throws(() => createPromotionHistoryLedgerV2(ledger([{
		runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: false, attempts: [passingAttempt('100', 'failure')],
	}])), /passing observation requires a successful workflow attempt/u);
});

test('embedded observation completion must remain inside the provider attempt interval', () => {
	for (const completedAt of ['2026-08-20T00:59:59.999Z', '2026-08-20T01:20:00.001Z']) {
		const base = passingAttempt('100');
		const attempt: PromotionHistoryAttemptInputV2 = {
			...base,
			artifact: {
				...base.artifact!,
				observation: { ...base.artifact!.observation, completedAt },
			},
		};
		assert.throws(() => createPromotionHistoryLedgerV2(ledger([{
			runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: false, attempts: [attempt],
		}])), /must fall within the provider attempt execution interval/u);
	}
});

test('embedded observation completion may equal either provider attempt boundary', () => {
	for (const completedAt of ['2026-08-20T01:00:00.000Z', '2026-08-20T01:20:00.000Z']) {
		const base = passingAttempt('100');
		const attempt: PromotionHistoryAttemptInputV2 = {
			...base,
			artifact: {
				...base.artifact!,
				observation: { ...base.artifact!.observation, completedAt },
			},
		};
		assert.doesNotThrow(() => createPromotionHistoryLedgerV2(ledger([{
			runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: false, attempts: [attempt],
		}])));
	}
});

test('successful workflow may retain a missing-artifact evidence gap', () => {
	const attempt: PromotionHistoryAttemptInputV2 = {
		...gapAttempt('success'),
		gapReason: 'observation-artifact-missing',
	};
	assert.doesNotThrow(() => createPromotionHistoryLedgerV2(ledger([{
		runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: false, attempts: [attempt],
	}])));
});

test('successful workflow cannot be relabeled as workflow infrastructure failure', () => {
	assert.throws(() => createPromotionHistoryLedgerV2(ledger([{
		runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: false, attempts: [gapAttempt('success')],
	}])), /successful workflow attempt may only become an evidence-layer gap/u);
});

test('rerun attempt cannot overlap or precede completion of the previous attempt', () => {
	const first = gapAttempt();
	const second: PromotionHistoryAttemptInputV2 = {
		...gapAttempt(),
		attempt: 2,
		startedAt: '2026-08-20T01:10:00.000Z',
		completedAt: '2026-08-20T01:30:00.000Z',
	};
	assert.throws(() => createPromotionHistoryLedgerV2(ledger([{
		runId: '100', sequenceAt: '2026-08-20T01:00:00.000Z', executionCommit: commit, frozen: false, attempts: [first, second],
	}])), /rerun attempt cannot start before the previous attempt completed/u);
});
