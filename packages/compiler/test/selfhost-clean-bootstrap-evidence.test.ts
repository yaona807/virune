import assert from 'node:assert/strict';
import test from 'node:test';
import {
	evaluateCleanBootstrapEvidence,
	type CleanBootstrapEvidenceInput,
} from '../src/selfhost/clean-bootstrap-evidence.js';

const candidateSha256 = 'a'.repeat(64);
const repositoryCommit = 'b'.repeat(40);
const seedArtifactSha256 = 'e'.repeat(64);
const stage1Sha256 = '6'.repeat(64);

function validInput(): CleanBootstrapEvidenceInput {
	return {
		version: 2,
		candidateSha256,
		repositoryCommit,
		checkedAt: '2026-08-01T00:00:00.000Z',
		workingTreeClean: true,
		dependencyMode: 'offline',
		environment: {
			profile: 'baseline',
			timezone: 'UTC',
			locale: 'C.UTF-8',
			homeVariant: 'baseline-home',
			tempVariant: 'baseline-temp',
		},
		lockfileSha256: 'c'.repeat(64),
		seed: {
			manifestSha256: 'd'.repeat(64),
			artifactSha256: seedArtifactSha256,
			verified: true,
		},
		bootstrap: {
			seedSha256: seedArtifactSha256,
			stage1Sha256,
			stage2Sha256: candidateSha256,
			stage3Sha256: candidateSha256,
			fixedPointEquivalent: true,
			fixedPointDifferenceCount: 0,
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

test('passing clean bootstrap evidence accepts Stage 1 transition drift but requires the Stage 2/3 fixed point', () => {
	const first = evaluateCleanBootstrapEvidence(validInput());
	const second = evaluateCleanBootstrapEvidence({
		...validInput(),
		commands: [...validInput().commands].reverse(),
	});

	assert.deepEqual(first, second);
	assert.notEqual(first.report.bootstrap.stage1Sha256, first.report.bootstrap.stage2Sha256);
	assert.equal(first.report.bootstrap.stage2Sha256, first.report.bootstrap.stage3Sha256);
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

test('operational and fixed-point failures are canonicalized into a failed clean-bootstrap gate', () => {
	const value = validInput();
	const result = evaluateCleanBootstrapEvidence({
		...value,
		candidateSha256: 'f'.repeat(64),
		workingTreeClean: false,
		dependencyMode: 'online',
		seed: { ...value.seed, verified: false },
		bootstrap: {
			seedSha256: '7'.repeat(64),
			stage1Sha256,
			stage2Sha256: '8'.repeat(64),
			stage3Sha256: '9'.repeat(64),
			fixedPointEquivalent: false,
			fixedPointDifferenceCount: 3,
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
		'DEPENDENCIES_NOT_OFFLINE',
		'DIRTY_WORKTREE',
		'FIXED_POINT_MISMATCH',
		'MISSING_COMMAND',
		'SEED_MISMATCH',
		'SEED_NOT_VERIFIED',
	]);
	assert.deepEqual(result.report.failures.map(failure => failure.path), [
		'$.candidateSha256',
		'$.commands.bootstrap.exitCode',
		'$.dependencyMode',
		'$.workingTreeClean',
		'$.bootstrap',
		'$.commands.seed-verify',
		'$.bootstrap.seedSha256',
		'$.seed.verified',
	]);
});

test('candidate binding requires the exact Stage 3 artifact digest', () => {
	const value = validInput();
	const result = evaluateCleanBootstrapEvidence({
		...value,
		candidateSha256: 'f'.repeat(64),
	});

	assert.equal(result.report.status, 'fail');
	assert.deepEqual(result.report.failures, [{
		code: 'CANDIDATE_MISMATCH',
		path: '$.candidateSha256',
		message: 'The clean bootstrap Stage 3 artifact does not match the candidate',
	}]);
});

test('fixed point requires both exact Stage 2/3 digests and zero normalized differences', () => {
	const value = validInput();
	for (const bootstrap of [
		{ ...value.bootstrap, stage3Sha256: 'f'.repeat(64) },
		{ ...value.bootstrap, fixedPointEquivalent: false },
		{ ...value.bootstrap, fixedPointDifferenceCount: 1 },
	]) {
		const result = evaluateCleanBootstrapEvidence({ ...value, bootstrap });
		assert.equal(result.report.status, 'fail');
		assert.ok(result.report.failures.some(failure => failure.code === 'FIXED_POINT_MISMATCH'));
	}
});

test('bootstrap execution is bound to the verified Stage 0 seed artifact', () => {
	const value = validInput();
	const result = evaluateCleanBootstrapEvidence({
		...value,
		bootstrap: { ...value.bootstrap, seedSha256: 'f'.repeat(64) },
	});

	assert.equal(result.report.status, 'fail');
	assert.deepEqual(result.report.failures, [{
		code: 'SEED_MISMATCH',
		path: '$.bootstrap.seedSha256',
		message: 'The bootstrap run did not use the verified Stage 0 seed artifact',
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
			environment: { ...value.environment, profile: 'unknown' },
		}),
		/\$\.environment\.profile must be baseline or perturbed/u,
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

test('command output digests and environment profile are included in evidence identity', () => {
	const first = evaluateCleanBootstrapEvidence(validInput());
	const value = validInput();
	const second = evaluateCleanBootstrapEvidence({
		...value,
		commands: value.commands.map(commandValue => commandValue.name === 'bootstrap'
			? { ...commandValue, stdoutSha256: '8'.repeat(64) }
			: commandValue),
	});
	const perturbed = evaluateCleanBootstrapEvidence({
		...value,
		environment: {
			profile: 'perturbed',
			timezone: 'Asia/Tokyo',
			locale: 'C.UTF-8',
			homeVariant: 'perturbed-home',
			tempVariant: 'perturbed-temp',
		},
	});

	assert.notEqual(first.sha256, second.sha256);
	assert.notEqual(first.gate.evidenceSha256, second.gate.evidenceSha256);
	assert.notEqual(first.sha256, perturbed.sha256);
	assert.equal(first.report.candidateSha256, perturbed.report.candidateSha256);
});
