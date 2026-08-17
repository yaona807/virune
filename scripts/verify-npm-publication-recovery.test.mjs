import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { verifyNpmPublicationRecoveryDocumentation, verifyNpmPublicationRecoveryPolicy } from './verify-npm-publication-recovery.mjs';

const root = resolve('.');

test('current npm publication recovery contract is canonical and documentation is synchronized', () => {
	const policy = verifyNpmPublicationRecoveryPolicy(root);
	const english = readFileSync(resolve(root, 'docs/npm-publication-recovery.md'), 'utf8');
	const japanese = readFileSync(resolve(root, 'docs/npm-publication-recovery_ja.md'), 'utf8');
	assert.equal(verifyNpmPublicationRecoveryDocumentation(policy, english, japanese), true);
});

test('unknown or partial observation cannot authorize writes', () => {
	for (const mutation of [
		policy => { policy.observation.freshRequired = false; },
		policy => { policy.observation.completePlannedPackageSetRequired = false; },
		policy => { policy.observation.unknownAuthorizesWrites = true; },
		policy => { policy.packageVersionPhase.states.find(item => item.state === 'unknown').writes = 'planned-package-versions-only'; },
	]) {
		withFixture((fixture, policy) => {
			mutation(policy);
			writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
			assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture));
		});
	}
});

test('exact partial publication can resume only missing reviewed candidates', () => {
	withFixture((fixture, policy) => {
		const state = policy.packageVersionPhase.states.find(item => item.state === 'exact-subset-observed');
		state.decision = 'republish-all';
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /expected exact-subset-observed\/resume-missing-reviewed-candidates-only\/missing-planned-package-versions-only/u);
	});
});

test('identity mismatch permanently blocks package-version reuse and forbidden recovery is immutable', () => {
	withFixture((fixture, policy) => {
		policy.packageVersionPhase.states.find(item => item.state === 'identity-mismatch').decision = 'retry';
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /block-version-permanently/u);
	});
	withFixture((fixture, policy) => {
		policy.packageVersionPhase.forbiddenRecovery.pop();
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /expected alternate-head-publication, different-bytes-same-version, rebuild-after-review, unpublish-republish/u);
	});
});

test('dist-tag recovery cannot run before exact package publication or republish package bytes', () => {
	withFixture((fixture, policy) => {
		policy.distTagPhase.requiresAllPackageVersionsExact = false;
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /all package versions must be exact/u);
	});
	withFixture((fixture, policy) => {
		policy.distTagPhase.packageRepublishAllowed = true;
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /must never republish package versions/u);
	});
	withFixture((fixture, policy, plan) => {
		policy.distTagPhase.canonicalStableTag = 'stable';
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /must match the publication plan stable dist-tag/u);
		assert.equal(plan.distTagPolicy.stable, 'latest');
	});
});

test('recovery policy cannot claim publication readiness or remove public verification', () => {
	withFixture((fixture, policy, plan) => {
		plan.publicationReady = true;
		writeJson(resolve(fixture, '.github/release/npm-publication-v1.json'), plan);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /must not enable npm publication/u);
	});
	withFixture((fixture, policy) => {
		policy.completion.publicRegistryVerificationRequired = false;
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /public Registry verification is required/u);
	});
});

function withFixture(callback) {
	const fixture = mkdtempSync(join(tmpdir(), 'virune-npm-recovery-'));
	try {
		const policyPath = resolve(root, '.github/release/npm-publication-recovery-v1.json');
		const planPath = resolve(root, '.github/release/npm-publication-v1.json');
		const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
		const plan = JSON.parse(readFileSync(planPath, 'utf8'));
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		writeJson(resolve(fixture, '.github/release/npm-publication-v1.json'), plan);
		callback(fixture, policy, plan);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
