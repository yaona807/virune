import assert from 'node:assert/strict';
import test from 'node:test';
import { createPromotionObservationSnapshots } from './selfhost-promotion-observation-collector.mjs';

const retainedAttempt = {
	attempt: 1,
	startedAt: '2026-07-01T18:17:01.000Z',
	completedAt: '2026-07-01T18:30:00.000Z',
	conclusion: 'success',
	artifact: {
		archiveSha256: 'a'.repeat(64),
		bytesSha256: 'b'.repeat(64),
		observation: { version: 2, retained: true },
	},
	gapReason: null,
};
const retainedRun = {
	runId: '100',
	sequenceAt: '2026-07-01T18:17:00.000Z',
	executionCommit: '1'.repeat(40),
	frozen: false,
	attempts: [retainedAttempt],
};

function inventory(attempts) {
	return [{
		runId: '100', runAttempt: attempts.length, createdAt: retainedRun.sequenceAt,
		status: 'completed', conclusion: attempts.at(-1)?.conclusion ?? 'success', executionCommit: retainedRun.executionCommit,
		attempts,
		artifacts: [],
	}];
}

const providerAttempt1 = {
	runId: '100', attempt: 1,
	startedAt: retainedAttempt.startedAt, completedAt: retainedAttempt.completedAt,
	conclusion: retainedAttempt.conclusion, executionCommit: retainedRun.executionCommit,
	event: 'schedule', headBranch: 'main', workflowPath: '.github/workflows/selfhost-promotion-observation.yml',
};

test('retained artifact bytes are reused without redownloading after provider artifact expiry', async () => {
	let downloads = 0;
	const snapshots = await createPromotionObservationSnapshots({
		reader: { async downloadCanonicalJsonArtifact() { downloads += 1; throw new Error('expired old artifact must not be downloaded'); } },
		inventory: inventory([providerAttempt1]),
		retainedRuns: [retainedRun],
	});
	assert.equal(downloads, 0);
	assert.deepEqual(snapshots[0].attempts[0], retainedAttempt);
});

test('retained provider metadata cannot be rewritten after canonicalization', async () => {
	await assert.rejects(
		() => createPromotionObservationSnapshots({
			reader: {},
			inventory: inventory([{ ...providerAttempt1, conclusion: 'failure' }]),
			retainedRuns: [retainedRun],
		}),
		/provider attempt metadata disagrees with retained ledger/u,
	);
});

test('only appended rerun attempts require fresh artifact evidence', async () => {
	const attempt2 = {
		...providerAttempt1,
		attempt: 2,
		startedAt: '2026-07-01T19:00:00.000Z',
		completedAt: '2026-07-01T19:10:00.000Z',
		conclusion: 'failure',
	};
	const snapshots = await createPromotionObservationSnapshots({
		reader: {},
		inventory: inventory([providerAttempt1, attempt2]),
		retainedRuns: [retainedRun],
	});
	assert.deepEqual(snapshots[0].attempts[0], retainedAttempt);
	assert.equal(snapshots[0].attempts[1].gapReason, 'workflow-infrastructure-failed');
});
