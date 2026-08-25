import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	createPromotionHistoryLedgerV2,
	effectivePromotionHistoryRunsV2,
	parsePromotionHistoryLedgerV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryAttemptInputV2,
	type PromotionHistoryFreezeBoundaryV2,
	type PromotionHistoryLedgerInputV2,
	type PromotionHistoryRunInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';

const commitA = '1'.repeat(40);
const commitB = '2'.repeat(40);
const subjectA = 'a'.repeat(64);
const subjectB = 'b'.repeat(64);
const evidenceSha = 'c'.repeat(64);
const archiveSha = 'd'.repeat(64);

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function observation(
	runId: string,
	commit: string,
	completedAt: string,
	outcome: 'passed' | 'product-failed',
	subject = subjectA,
) {
	return {
		version: 2 as const,
		runId,
		stage: 'required-selfhost' as const,
		executionCommit: commit,
		promotionSubjectId: subject,
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

function validAttempt(
	attempt: number,
	runId: string,
	commit: string,
	startedAt: string,
	completedAt: string,
	outcome: 'passed' | 'product-failed' = 'passed',
	subject = subjectA,
): PromotionHistoryAttemptInputV2 {
	const observedAt = new Date((new Date(startedAt).getTime() + new Date(completedAt).getTime()) / 2).toISOString();
	const observed = observation(runId, commit, observedAt, outcome, subject);
	return {
		attempt,
		startedAt,
		completedAt,
		providerConclusion: outcome === 'passed' ? 'success' : 'failure',
		artifactState: 'valid',
		artifact: { archiveSha256: archiveSha, bytesSha256: observationReportSha256(observed), observation: observed },
	};
}

function gapAttempt(
	attempt: number,
	startedAt: string,
	completedAt: string,
	artifactState: 'missing' | 'invalid' = 'missing',
): PromotionHistoryAttemptInputV2 {
	return { attempt, startedAt, completedAt, providerConclusion: 'failure', artifactState, artifact: null };
}

function boundary(runId: string, sequenceAt: string, executionCommit = commitB): PromotionHistoryFreezeBoundaryV2 {
	return { runId, sequenceAt, executionCommit };
}

function run(
	runId: string,
	sequenceAt: string,
	executionCommit: string,
	attempts: readonly PromotionHistoryAttemptInputV2[],
	freezeBoundary: PromotionHistoryFreezeBoundaryV2 | null = null,
): PromotionHistoryRunInputV2 {
	return {
		runId,
		sequenceAt,
		executionCommit,
		freezeBoundary,
		promotionEffectiveAttemptCount: freezeBoundary === null
			? attempts.length
			: attempts.filter(attempt => attempt.completedAt < freezeBoundary.sequenceAt).length,
		attempts,
	};
}

function ledger(
	runs: readonly PromotionHistoryRunInputV2[],
	generation = 1,
	parentLedgerSha256: string | null = null,
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

test('canonical ledger is deterministic and records zero-credit v1 migration', () => {
	const value = ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	])]);
	const first = parsePromotionHistoryLedgerV2(value);
	const second = parsePromotionHistoryLedgerV2(JSON.parse(first.serialized));
	assert.equal(first.sha256, second.sha256);
	assert.deepEqual(first.ledger.migration, {
		sourceHistoryVersion: 1,
		strategy: 'fresh-v2-no-backfill',
		promotionCreditRuns: 0,
		promotionCreditDays: 0,
		reason: 'v1-missing-promotion-subject-closure-and-current-required-evidence',
	});
});

test('initial ledger rejects stages without a canonical observation artifact contract', () => {
	const value = ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	])]);
	assert.throws(
		() => parsePromotionHistoryLedgerV2({ ...value, stage: 'required-compiler' }),
		/only supports required-selfhost/u,
	);
});

test('freeze boundary must identify the immediately following formal run', () => {
	const second = run('200', '2026-08-02T18:47:00.000Z', commitB, [
		validAttempt(1, '200', commitB, '2026-08-02T18:47:01.000Z', '2026-08-02T18:50:00.000Z'),
	]);
	const first = run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	], boundary('999', second.sequenceAt));
	assert.throws(() => parsePromotionHistoryLedgerV2(ledger([first, second])), /immediately following formal run/u);
});

test('attempt completing exactly at freeze time is audit-only, not promotion-effective', () => {
	const freeze = boundary('200', '2026-08-02T18:47:00.000Z');
	const attempts = [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
		validAttempt(2, '100', commitA, '2026-08-02T18:40:00.000Z', freeze.sequenceAt),
	];
	const value = parsePromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, attempts, freeze)]));
	assert.equal(value.ledger.runs[0]?.promotionEffectiveAttemptCount, 1);
	assert.equal(effectivePromotionHistoryRunsV2(value.ledger)[0]?.kind, 'observation');
});

test('unfrozen evidence gap can be resolved by a later valid pass', () => {
	const effective = effectivePromotionHistoryRunsV2(parsePromotionHistoryLedgerV2(ledger([
		run('100', '2026-08-01T18:47:00.000Z', commitA, [
			gapAttempt(1, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
			validAttempt(2, '100', commitA, '2026-08-01T19:00:00.000Z', '2026-08-01T19:05:00.000Z'),
		]),
	])).ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'passed');
});

test('pass followed by an ambiguous non-product gap remains a gap before freeze', () => {
	const effective = effectivePromotionHistoryRunsV2(parsePromotionHistoryLedgerV2(ledger([
		run('100', '2026-08-01T18:47:00.000Z', commitA, [
			validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
			gapAttempt(2, '2026-08-01T19:00:00.000Z', '2026-08-01T19:05:00.000Z'),
		]),
	])).ledger)[0];
	assert.equal(effective?.kind, 'gap');
	if (effective?.kind === 'gap') assert.equal(effective.reason, 'observation-artifact-missing');
});

test('an unfrozen cancellation gap can be resolved by a later valid pass', () => {
	const cancelled: PromotionHistoryAttemptInputV2 = {
		...gapAttempt(1, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
		providerConclusion: 'cancelled',
	};
	const effective = effectivePromotionHistoryRunsV2(parsePromotionHistoryLedgerV2(ledger([
		run('100', '2026-08-01T18:47:00.000Z', commitA, [
			cancelled,
			validAttempt(2, '100', commitA, '2026-08-01T19:00:00.000Z', '2026-08-01T19:05:00.000Z'),
		]),
	])).ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'passed');
});

test('product failure remains sticky across a later passing rerun', () => {
	const effective = effectivePromotionHistoryRunsV2(parsePromotionHistoryLedgerV2(ledger([
		run('100', '2026-08-01T18:47:00.000Z', commitA, [
			validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z', 'product-failed'),
			validAttempt(2, '100', commitA, '2026-08-01T19:00:00.000Z', '2026-08-01T19:05:00.000Z', 'passed'),
		]),
	])).ledger)[0];
	assert.equal(effective?.kind, 'observation');
	if (effective?.kind === 'observation') assert.equal(effective.observation.outcome, 'product-failed');
});

test('promotion-effective valid reruns that disagree on Subject fail closed', () => {
	const attempts = [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z', 'passed', subjectA),
		validAttempt(2, '100', commitA, '2026-08-01T19:00:00.000Z', '2026-08-01T19:05:00.000Z', 'passed', subjectB),
	];
	assert.throws(
		() => parsePromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, attempts)])),
		/contradict on promotionSubjectId/u,
	);
});

test('forged inner observation report identity fails closed', () => {
	const attempt = validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z');
	const forged: PromotionHistoryAttemptInputV2 = {
		...attempt,
		artifact: { ...attempt.artifact!, bytesSha256: 'f'.repeat(64) },
	};
	assert.throws(
		() => parsePromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [forged])])),
		/canonical Promotion Observation report SHA-256/u,
	);
});

test('malformed unknown fields and contradictory artifact-state pairs fail closed', () => {
	const canonical = ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	])]);
	assert.throws(() => parsePromotionHistoryLedgerV2({ ...canonical, unknown: true }), /expected exactly keys/u);
	const brokenAttempt: PromotionHistoryAttemptInputV2 = {
		...canonical.runs[0]!.attempts[0]!,
		artifactState: 'valid',
		artifact: null,
	};
	assert.throws(
		() => parsePromotionHistoryLedgerV2(ledger([run('100', canonical.runs[0]!.sequenceAt, commitA, [brokenAttempt])])),
		/valid artifactState requires/u,
	);
});

test('duplicate or reordered logical runs fail closed', () => {
	const duplicateSecond = run('100', '2026-08-02T18:47:00.000Z', commitB, [
		validAttempt(1, '100', commitB, '2026-08-02T18:47:01.000Z', '2026-08-02T18:50:00.000Z'),
	]);
	const duplicateFirst = run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	]);
	assert.throws(() => parsePromotionHistoryLedgerV2(ledger([duplicateFirst, duplicateSecond])), /duplicate runId/u);

	const early = run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	]);
	const late = run('200', '2026-08-02T18:47:00.000Z', commitB, [
		validAttempt(1, '200', commitB, '2026-08-02T18:47:01.000Z', '2026-08-02T18:50:00.000Z'),
	]);
	assert.throws(() => parsePromotionHistoryLedgerV2(ledger([late, early])), /strictly ordered/u);
});

test('non-contiguous attempt provenance fails closed instead of inferring a missing attempt', () => {
	const attempts = [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
		validAttempt(3, '100', commitA, '2026-08-01T19:00:00.000Z', '2026-08-01T19:05:00.000Z'),
	];
	assert.throws(
		() => parsePromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, attempts)])),
		/expected contiguous attempt 2/u,
	);
});

test('hash-chain generation and parent identity are fenced fail closed', () => {
	const parent = createPromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	])]));
	const retainedRun = parent.ledger.runs[0]!;
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger([retainedRun], 2, 'f'.repeat(64)), parent.ledger),
		/parentLedgerSha256/u,
	);
	assert.throws(
		() => createPromotionHistoryLedgerV2(ledger([retainedRun], 3, parent.sha256), parent.ledger),
		/expected 2/u,
	);
});

test('retained attempts are immutable across ledger generations', () => {
	const parent = createPromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	])]));
	const retained = parent.ledger.runs[0]!.attempts[0]!;
	const changedAttempt: PromotionHistoryAttemptInputV2 = {
		...retained,
		artifact: { ...retained.artifact!, archiveSha256: 'f'.repeat(64) },
	};
	const child = ledger([
		run('100', parent.ledger.runs[0]!.sequenceAt, commitA, [changedAttempt]),
	], 2, parent.sha256);
	assert.throws(() => createPromotionHistoryLedgerV2(child, parent.ledger), /retained attempt is immutable/u);
});

test('an unfrozen retained run may become frozen only when the next formal run is appended', () => {
	const parent = createPromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	])]));
	const second = run('200', '2026-08-02T18:47:00.000Z', commitB, [
		validAttempt(1, '200', commitB, '2026-08-02T18:47:01.000Z', '2026-08-02T18:50:00.000Z'),
	]);
	const first = run('100', parent.ledger.runs[0]!.sequenceAt, commitA, parent.ledger.runs[0]!.attempts, boundary('200', second.sequenceAt, commitB));
	const child = ledger([first, second], 2, parent.sha256);
	assert.doesNotThrow(() => createPromotionHistoryLedgerV2(child, parent.ledger));
});

test('frozen lineage keeps boundary/effective prefix immutable but accepts audit-only late attempts', () => {
	const freeze = boundary('200', '2026-08-02T18:47:00.000Z');
	const parent = createPromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	], freeze)]));
	const late = gapAttempt(2, '2026-08-03T18:47:01.000Z', '2026-08-03T18:50:00.000Z');
	const child = ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		...parent.ledger.runs[0]!.attempts,
		late,
	], freeze)], 2, parent.sha256);
	assert.doesNotThrow(() => createPromotionHistoryLedgerV2(child, parent.ledger));

	const forgottenBoundary = { ...child, runs: [{ ...child.runs[0]!, freezeBoundary: null, promotionEffectiveAttemptCount: 2 }] };
	assert.throws(() => createPromotionHistoryLedgerV2(forgottenBoundary, parent.ledger), /frozen boundary is immutable|effective prefix/u);
});

test('frozen lineage reports a newly discovered pre-boundary attempt as a late-audit contradiction', () => {
	const freeze = boundary('200', '2026-08-02T18:47:00.000Z');
	const parent = createPromotionHistoryLedgerV2(ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		validAttempt(1, '100', commitA, '2026-08-01T18:47:01.000Z', '2026-08-01T18:50:00.000Z'),
	], freeze)]));
	const contradictory = gapAttempt(2, '2026-08-02T18:40:00.000Z', '2026-08-02T18:46:00.000Z');
	const child = ledger([run('100', '2026-08-01T18:47:00.000Z', commitA, [
		...parent.ledger.runs[0]!.attempts,
		contradictory,
	], freeze)], 2, parent.sha256);
	assert.throws(
		() => createPromotionHistoryLedgerV2(child, parent.ledger),
		/late audit attempt contradicts the retained freeze boundary/u,
	);
});
