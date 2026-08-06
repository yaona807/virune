import assert from 'node:assert/strict';
import test from 'node:test';
import {
	evaluateCleanBootstrapEvidence,
	type CleanBootstrapEvidenceInput,
} from '../src/selfhost/clean-bootstrap-evidence.js';

const candidateSha256 = 'a'.repeat(64);
const repositoryCommit = 'b'.repeat(40);

function validInput(): CleanBootstrapEvidenceInput {
	return {
		version: 1,
		candidateSha256,
		repositoryCommit,
		checkedAt: '2026-08-01T00:00:00.000Z',
		workingTreeClean: true,
		networkMode: 'offline',
		lockfileSha256: 'c'.repeat(64),
		seed: {
			manifestSha256: 'd'.repeat(64),
			artifactSha256: 'e'.repeat(64),
			verified: true,
		},
		bootstrap: {
			stage1Sha256: candidateSha256,
			stage2Sha256: candidateSha256,
			equivalent: true,
		},
		commands: [
			command('seed-verify', 0, '2'),
			command('install', 0, '1'),
			command('bootstrap', 0, '3'),
		],
	};
}

function command(
	name: CleanBootstrapEvidenceInput['commands'][number]['name'],
	exitCode: number,
	digest: string,
): CleanBootstrapEvidenceInput['commands'][number] {
	return {
		name,
		exitCode,
		stdoutSha256: digest.repeat(64),
		stderrSha256: '0'.repeat(64),
	};
}

test('passing clean bootstrap evidence produces a deterministic rollback gate witness', () => {
	const first = evaluateCleanBootstrapEvidence(validInput());
	const second = evaluateCleanBootstrapEvidence({
		...validInput(),
		commands: [...validInput().commands].reverse(),
	});

	assert.deepEqual(first, second);
	assert.equal(first.report.status, 'pass');
	assert.deepEqual(first.report.failures, []);
	assert.deepEqual(first.report.commands.map(value => value.name), [
		'bootstrap',
		'install',
		'seed-verify',
	]);
	assert.deepEqual(first.gate, {
		name: 'clean-bootstrap',
		candidateSha256,
		checkedAt: '2026-08-01T00:00:00.000Z',
		status: 'pass',
		evidenceSha256: first.sha256,
	});
	assert.equal(first.serialized, JSON.stringify(first.report));
	assert.match(first.sha256, /^[0-9a-f]{64}$/u);
});

test('operational failures are canonicalized into a failed clean-bootstrap gate', () => {
	const value = validInput();
	const result = evaluateCleanBootstrapEvidence({
		...value,
		candidateSha256: 'f'.repeat(64),
		workingTreeClean: false,
		networkMode: 'online',
		seed: { ...value.seed, verified: false },
		bootstrap: {
			stage1Sha256: candidateSha256,
			stage2Sha256: '9'.repeat(64),
			equivalent: false,
		},
		commands: [
			command('install', 0, '1'),
			command('bootstrap', 2, '3'),
		],
	});

	assert.equal(result.report.status, 'fail');
	assert.equal(result.gate.status, 'fail');
	assert.deepEqual(result.report.failures.map(failure => failure.code), [
		'CANDIDATE_MISMATCH',
		'COMMAND_FAILED',
		'DIRTY_WORKTREE',
		'MISSING_COMMAND',
		'NETWORK_NOT_OFFLINE',
		'SEED_NOT_VERIFIED',
		'STAGE_MISMATCH',
	]);
	assert.deepEqual(result.report.failures.map(failure => failure.path), [
		'$.candidateSha256',
		'$.commands.bootstrap.exitCode',
		'$.workingTreeClean',
		'$.commands.seed-verify',
		'$.networkMode',
		'$.seed.verified',
		'$.bootstrap',
	]);
});

test('candidate binding requires the exact Stage 2 artifact digest', () => {
	const value = validInput();
	const result = evaluateCleanBootstrapEvidence({
		...value,
		candidateSha256: 'f'.repeat(64),
	});

	assert.equal(result.report.status, 'fail');
	assert.deepEqual(result.report.failures, [{
		code: 'CANDIDATE_MISMATCH',
		path: '$.candidateSha256',
		message: 'The clean bootstrap Stage 2 artifact does not match the candidate',
	}]);
});

test('malformed and ambiguous evidence fails closed', () => {
	const value = validInput();
	assert.throws(
		() => evaluateCleanBootstrapEvidence({ ...value, unexpected: true }),
		/\$\.unexpected is unknown/u,
	);
	assert.throws(
		() => evaluateCleanBootstrapEvidence({ ...value, checkedAt: '2026-08-01T00:00:00Z' }),
		/\$\.checkedAt must be a canonical UTC ISO timestamp/u,
	);
	assert.throws(
		() => evaluateCleanBootstrapEvidence({ ...value, repositoryCommit: repositoryCommit.toUpperCase() }),
		/\$\.repositoryCommit must be a lowercase Git commit SHA/u,
	);
	assert.throws(
		() => evaluateCleanBootstrapEvidence({
			...value,
			commands: [command('install', 0, '1'), command('install', 0, '2')],
		}),
		/\$\.commands\[1\]\.name is duplicated/u,
	);
	assert.throws(
		() => evaluateCleanBootstrapEvidence({
			...value,
			commands: [{ ...command('install', 0, '1'), exitCode: -1 }],
		}),
		/exitCode must be a non-negative safe integer/u,
	);
});

test('command output digests are included in the evidence identity', () => {
	const first = evaluateCleanBootstrapEvidence(validInput());
	const value = validInput();
	const second = evaluateCleanBootstrapEvidence({
		...value,
		commands: value.commands.map(commandValue => commandValue.name === 'bootstrap'
			? { ...commandValue, stdoutSha256: '8'.repeat(64) }
			: commandValue),
	});

	assert.notEqual(first.sha256, second.sha256);
	assert.notEqual(first.gate.evidenceSha256, second.gate.evidenceSha256);
});
