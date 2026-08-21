import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createPromotionObservationSnapshots } from './selfhost-promotion-observation-collector.mjs';

const executionCommit = '1'.repeat(40);

function inventory({ conclusion = 'success', artifact = null, status = 'completed' } = {}) {
	return [{
		runId: '100',
		runAttempt: 1,
		createdAt: '2026-08-20T18:17:00.000Z',
		status,
		conclusion,
		executionCommit,
		attempts: [{
			runId: '100', attempt: 1,
			startedAt: '2026-08-20T18:17:01.000Z', completedAt: '2026-08-20T18:30:00.000Z',
			conclusion, executionCommit, event: 'schedule', headBranch: 'main',
			workflowPath: '.github/workflows/selfhost-promotion-observation.yml',
		}],
		artifacts: artifact === null ? [] : [artifact],
	}];
}

function metadata(overrides = {}) {
	return {
		id: 1,
		name: 'selfhost-promotion-observation-100-1',
		expired: false,
		digest: `sha256:${'a'.repeat(64)}`,
		sizeInBytes: 100,
		...overrides,
	};
}

function sha(value) {
	return createHash('sha256').update(value).digest('hex');
}

function validObservation(overrides = {}) {
	return {
		version: 2,
		runId: '100',
		stage: 'required-selfhost',
		executionCommit,
		promotionSubjectId: 'c'.repeat(64),
		completedAt: '2026-08-20T18:29:59.000Z',
		outcome: 'passed',
		countsTowardPromotion: true,
		unexplainedDifferentials: 0,
		evidence: [{ id: 'clean-bootstrap', status: 'passed', sha256: 'd'.repeat(64) }],
		...overrides,
	};
}

function report(observation = validObservation(), overrides = {}) {
	return {
		schemaVersion: 1,
		claim: 'required-selfhost-promotion-observation',
		productionEligible: false,
		observationSha256: sha(JSON.stringify(observation)),
		observation,
		...overrides,
	};
}

function readerFor(value) {
	return {
		async downloadCanonicalJsonArtifact() {
			return { archiveSha256: 'a'.repeat(64), bytesSha256: 'b'.repeat(64), value };
		},
	};
}

test('successful workflow with no artifact becomes an explicit evidence gap without rewriting provider conclusion', async () => {
	const snapshots = await createPromotionObservationSnapshots({ reader: {}, inventory: inventory() });
	assert.equal(snapshots[0].attempts[0].conclusion, 'success');
	assert.equal(snapshots[0].attempts[0].gapReason, 'observation-artifact-missing');
	assert.equal(snapshots[0].attempts[0].artifact, null);
});

test('failed workflow with no canonical observation remains unknown instead of being guessed as infrastructure failure', async () => {
	const snapshots = await createPromotionObservationSnapshots({ reader: {}, inventory: inventory({ conclusion: 'failure' }) });
	assert.equal(snapshots[0].attempts[0].conclusion, 'failure');
	assert.equal(snapshots[0].attempts[0].gapReason, 'observation-artifact-missing');
	assert.equal(snapshots[0].attempts[0].artifact, null);
});

test('cancelled workflow with no artifact becomes workflow-cancelled gap', async () => {
	const snapshots = await createPromotionObservationSnapshots({ reader: {}, inventory: inventory({ conclusion: 'cancelled' }) });
	assert.equal(snapshots[0].attempts[0].conclusion, 'cancelled');
	assert.equal(snapshots[0].attempts[0].gapReason, 'workflow-cancelled');
});

test('expired artifact is treated as unavailable evidence rather than downloaded', async () => {
	let called = false;
	const reader = { async downloadCanonicalJsonArtifact() { called = true; throw new Error('must not be called'); } };
	const snapshots = await createPromotionObservationSnapshots({ reader, inventory: inventory({ artifact: metadata({ expired: true }) }) });
	assert.equal(called, false);
	assert.equal(snapshots[0].attempts[0].gapReason, 'observation-artifact-missing');
});

test('archive or inner JSON validation failure becomes invalid-artifact gap', async () => {
	const error = new Error('bad zip');
	error.name = 'PromotionArtifactError';
	const reader = { async downloadCanonicalJsonArtifact() { throw error; } };
	const snapshots = await createPromotionObservationSnapshots({ reader, inventory: inventory({ artifact: metadata() }) });
	assert.equal(snapshots[0].attempts[0].gapReason, 'observation-artifact-invalid');
});

test('observation report wrapper must remain non-promotable and self-bind its embedded observation', async () => {
	for (const value of [
		report(validObservation(), { productionEligible: true }),
		report(validObservation(), { observationSha256: 'f'.repeat(64) }),
		{ ...report(validObservation()), extra: true },
	]) {
		const snapshots = await createPromotionObservationSnapshots({ reader: readerFor(value), inventory: inventory({ artifact: metadata() }) });
		assert.equal(snapshots[0].attempts[0].artifact, null);
		assert.equal(snapshots[0].attempts[0].gapReason, 'observation-artifact-invalid');
	}
});

test('embedded observation schema and provider identity failures become explicit invalid-artifact gaps', async () => {
	for (const observation of [
		{ version: 2 },
		validObservation({ runId: '101' }),
		validObservation({ executionCommit: '2'.repeat(40) }),
		validObservation({ countsTowardPromotion: false }),
	]) {
		const snapshots = await createPromotionObservationSnapshots({
			reader: readerFor(report(observation)),
			inventory: inventory({ artifact: metadata() }),
		});
		assert.equal(snapshots[0].attempts[0].artifact, null);
		assert.equal(snapshots[0].attempts[0].gapReason, 'observation-artifact-invalid');
	}
});

test('embedded observation must already use canonical evidence ordering', async () => {
	const observation = validObservation({
		evidence: [
			{ id: 'z-evidence', status: 'passed', sha256: 'e'.repeat(64) },
			{ id: 'a-evidence', status: 'passed', sha256: 'f'.repeat(64) },
		],
	});
	const snapshots = await createPromotionObservationSnapshots({
		reader: readerFor(report(observation)),
		inventory: inventory({ artifact: metadata() }),
	});
	assert.equal(snapshots[0].attempts[0].artifact, null);
	assert.equal(snapshots[0].attempts[0].gapReason, 'observation-artifact-invalid');
});

test('observation outcome must agree with provider workflow conclusion', async () => {
	const snapshots = await createPromotionObservationSnapshots({
		reader: readerFor(report(validObservation())),
		inventory: inventory({ conclusion: 'failure', artifact: metadata() }),
	});
	assert.equal(snapshots[0].attempts[0].artifact, null);
	assert.equal(snapshots[0].attempts[0].gapReason, 'observation-artifact-invalid');
});

test('GitHub/provider failure is propagated instead of misclassified as invalid evidence', async () => {
	const error = new Error('HTTP 503');
	error.name = 'PromotionGitHubProviderError';
	const reader = { async downloadCanonicalJsonArtifact() { throw error; } };
	await assert.rejects(
		() => createPromotionObservationSnapshots({ reader, inventory: inventory({ artifact: metadata() }) }),
		/HTTP 503/u,
	);
});

test('valid report preserves outer archive/byte identities and canonical embedded observation', async () => {
	const observation = validObservation();
	const snapshots = await createPromotionObservationSnapshots({
		reader: readerFor(report(observation)),
		inventory: inventory({ artifact: metadata() }),
	});
	assert.equal(snapshots[0].attempts[0].artifact.archiveSha256, 'a'.repeat(64));
	assert.equal(snapshots[0].attempts[0].artifact.bytesSha256, 'b'.repeat(64));
	assert.deepEqual(snapshots[0].attempts[0].artifact.observation, observation);
});
