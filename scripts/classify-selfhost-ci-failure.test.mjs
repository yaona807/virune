import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { classifySelfhostCiFailure } from './classify-selfhost-ci-failure.mjs';

const headSha = 'a'.repeat(40);

function record(classification, evidence = {}) {
	return {
		schemaVersion: 1,
		headSha,
		workflow: 'CI',
		runId: 123,
		jobId: 456,
		classification,
		evidence: {
			reproducesOnHead: false,
			attributableToChangedBehaviorOrFiles: false,
			sameFailureOnUnchangedCode: false,
			sameFailureOnUnrelatedPullRequests: false,
			boundedExternalFailure: false,
			testAssertionFailed: false,
			compilerDiagnosticMismatch: false,
			compatibilityFailure: false,
			securityFailure: false,
			reproducibilityFailure: false,
			repeatedOnSameHead: false,
			...evidence,
		},
	};
}

test('accepts an evidenced feature regression', () => {
	const result = classifySelfhostCiFailure(record('feature-regression', {
		reproducesOnHead: true,
		attributableToChangedBehaviorOrFiles: true,
		testAssertionFailed: true,
	}));
	assert.equal(result.classification, 'feature-regression');
	assert.equal(result.retryAllowed, false);
});

test('accepts shared infrastructure only with cross-run evidence', () => {
	const result = classifySelfhostCiFailure(record('shared-infrastructure', {
		sameFailureOnUnrelatedPullRequests: true,
	}));
	assert.equal(result.classification, 'shared-infrastructure');
	assert.throws(
		() => classifySelfhostCiFailure(record('shared-infrastructure')),
		/shared-infrastructure requires matching evidence/u,
	);
});

test('allows one bounded transient retry on the exact head', () => {
	const result = classifySelfhostCiFailure(record('retryable-transient', {
		boundedExternalFailure: true,
	}));
	assert.equal(result.retryAllowed, true);
});

test('rejects transient classification for protected gate failures', () => {
	for (const field of [
		'testAssertionFailed',
		'compilerDiagnosticMismatch',
		'compatibilityFailure',
		'securityFailure',
		'reproducibilityFailure',
	]) {
		assert.throws(
			() => classifySelfhostCiFailure(record('retryable-transient', {
				boundedExternalFailure: true,
				[field]: true,
			})),
			new RegExp(field, 'u'),
		);
	}
});

test('rejects repeated failures as retryable transients', () => {
	assert.throws(
		() => classifySelfhostCiFailure(record('retryable-transient', {
			boundedExternalFailure: true,
			repeatedOnSameHead: true,
		})),
		/repeats on the same head/u,
	);
});

test('CLI writes deterministic normalized evidence', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-ci-triage-'));
	try {
		const input = join(root, 'input.json');
		const output = join(root, 'output.json');
		await writeFile(input, `${JSON.stringify(record('unknown'))}\n`, 'utf8');
		const result = spawnSync(process.execPath, [
			fileURLToPath(new URL('./classify-selfhost-ci-failure.mjs', import.meta.url)),
			'--input', input,
			'--output', output,
		], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		const parsed = JSON.parse(await readFile(output, 'utf8'));
		assert.equal(parsed.claim, 'selfhost-ci-failure-classification');
		assert.equal(parsed.classification, 'unknown');
		assert.equal(parsed.retryAllowed, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
