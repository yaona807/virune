import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assembleSelfhostReleaseGate,
	parseArguments,
} from './assemble-selfhost-release-gate.mjs';

const GIT = '1'.repeat(40);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function evidence() {
	return {
		'seed-verify': { schemaVersion: 1, passed: true, sha256: A },
		'fixed-seed-bootstrap': {
			schemaVersion: 2,
			claim: 'fixed-seed-bootstrap-fixed-point',
			productionEligible: false,
			status: 'match',
			stage0Source: 'fixed-seed-artifact',
			seed: { verified: true, artifactSha256: A, manifestSha256: C },
			stage1: { sha256: A },
			stage2: { sha256: B },
			stage3: { sha256: B },
			transition: { from: 'stage1', to: 'stage2', equivalent: false, differenceCount: 467 },
			fixedPoint: { from: 'stage2', to: 'stage3', attempted: true, equivalent: true, differenceCount: 0, error: null },
			equivalent: true,
		},
		'clean-bootstrap': {
			schemaVersion: 2,
			claim: 'selfhost-clean-bootstrap-fixed-point',
			productionEligible: false,
			status: 'pass',
			passed: true,
			repositoryCommit: GIT,
			candidateSha256: B,
			workingTreeClean: true,
			dependencyMode: 'offline',
			environment: { profile: 'baseline', timezone: 'UTC', locale: 'C.UTF-8', homeVariant: 'host-default', tempVariant: 'host-default' },
			lockfileSha256: C,
			seed: { verified: true, manifestSha256: C, artifactSha256: A },
			bootstrap: {
				seedSha256: A,
				stage1Sha256: A,
				stage2Sha256: B,
				stage3Sha256: B,
				fixedPointEquivalent: true,
				fixedPointDifferenceCount: 0,
			},
		},
		'legacy-rollback': {
			schemaVersion: 1,
			claim: 'selfhost-legacy-rollback-smoke',
			productionEligible: false,
			status: 'pass',
			workingTreeClean: true,
			selection: 'legacy',
			rollbackRequired: true,
			candidateAccessed: false,
		},
	};
}

test('assembles independently generated evidence through the canonical release-core evaluator', async () => {
	const report = await assembleSelfhostReleaseGate({
		repositoryRoot: '/repo',
		evidenceById: evidence(),
		now: () => new Date('2026-08-09T00:00:00.000Z'),
	});
	assert.equal(report.schemaVersion, 2);
	assert.equal(report.claim, 'selfhost-stable-release-gate-core');
	assert.equal(report.productionEligible, false);
	assert.equal(report.passed, true);
	assert.equal(report.evidenceConsistency.checked, true);
	assert.equal(report.evidenceConsistency.passed, true);
	assert.equal(report.evidenceConsistency.bindings.stage3Sha256, B);
});

test('fails closed when precomputed evidence comes from different compiler generations', async () => {
	const values = evidence();
	values['clean-bootstrap'].bootstrap.stage1Sha256 = C;
	const report = await assembleSelfhostReleaseGate({ repositoryRoot: '/repo', evidenceById: values });
	assert.equal(report.passed, false);
	assert.equal(report.evidenceConsistency.checked, true);
	assert.equal(report.evidenceConsistency.passed, false);
	assert.match(report.evidenceConsistency.reason, /Stage 1 SHA-256/u);
});

test('fails closed when a required evidence object is missing', async () => {
	const values = evidence();
	delete values['legacy-rollback'];
	const report = await assembleSelfhostReleaseGate({ repositoryRoot: '/repo', evidenceById: values });
	assert.equal(report.passed, false);
	assert.equal(report.steps.at(-1).id, 'legacy-rollback');
	assert.equal(report.steps.at(-1).status, 'fail');
});

test('argument parsing requires all four precomputed evidence paths', () => {
	const args = [
		'--seed-verify=.cache/seed.json',
		'--fixed-seed-bootstrap=.cache/fixed.json',
		'--clean-bootstrap=.cache/clean.json',
		'--legacy-rollback=.cache/rollback.json',
		'--output=.cache/out.json',
		'--json',
	];
	const parsed = parseArguments(args);
	assert.equal(parsed.inputs['seed-verify'], '.cache/seed.json');
	assert.equal(parsed.inputs['fixed-seed-bootstrap'], '.cache/fixed.json');
	assert.equal(parsed.inputs['clean-bootstrap'], '.cache/clean.json');
	assert.equal(parsed.inputs['legacy-rollback'], '.cache/rollback.json');
	assert.equal(parsed.output, '.cache/out.json');
	assert.equal(parsed.json, true);
	assert.throws(() => parseArguments(args.filter(item => !item.startsWith('--legacy-rollback='))), /--legacy-rollback is required/u);
});
