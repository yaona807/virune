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
		policy => { policy.observation.failureDecisions.partial = 'resume-publication'; },
		policy => { delete policy.observation.failureDecisions.timeout; },
		policy => { policy.observation.failureDecisions.contradictory = 'halt-and-reobserve'; },
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

test('exact recovery requires every immutable reviewed identity dimension', () => {
	for (const mutation of [
		identity => identity.pop(),
		identity => { identity[2] = 'sha1-only'; },
		identity => { [identity[4], identity[5]] = [identity[5], identity[4]]; },
	]) {
		withFixture((fixture, policy) => {
			mutation(policy.packageVersionPhase.requiredObservedIdentity);
			writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
			assert.throws(
				() => verifyNpmPublicationRecoveryPolicy(fixture),
				/expected exact recovery identity dimensions/u,
			);
		});
	}
});

test('exact recovery identity dimensions have canonical comparison rules and exclude mutable tag state', () => {
	for (const mutation of [
		rules => { rules.downloadedTarballSha256 = 'presence-only'; },
		rules => { rules.registryDistIntegrity = 'trust-metadata-without-bytes'; },
		rules => { delete rules.sourceCommit; },
		rules => { rules.provenanceWorkflow = 'any-workflow'; },
		rules => { rules.canonicalDistTag = 'must-equal-reviewed-release-version'; },
	]) {
		withFixture((fixture, policy) => {
			mutation(policy.packageVersionPhase.identityMatchRules);
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

test('all-exact state performs no further Registry mutation', () => {
	withFixture((fixture, policy) => {
		const state = policy.packageVersionPhase.states.find(item => item.state === 'all-exact-observed');
		state.decision = 'advance-to-dist-tag-phase';
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /complete-package-version-publication\/none/u);
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

test('canonical dist-tags are applied by npm publish with dependency-safe CLI-last ordering and no downgrade', () => {
	for (const mutation of [
		policy => { policy.distTagPolicy.application = 'separate-dist-tag-command'; },
		policy => { policy.distTagPolicy.dependencySafeOrderRequired = false; },
		policy => { policy.distTagPolicy.cliLastRequired = false; },
		policy => { policy.distTagPolicy.targetVersionOrdering = 'lexical'; },
		policy => { policy.distTagPolicy.canonicalTagDowngradeAllowed = true; },
		policy => { policy.distTagPolicy.separateDistTagMutationAllowed = true; },
		policy => { policy.distTagPolicy.traditionalTokenTagRepairAllowed = true; },
		policy => { policy.distTagPolicy.incompatibleExistingTagDecision = 'repair-with-token'; },
	]) {
		withFixture((fixture, policy) => {
			mutation(policy);
			writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
			assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture));
		});
	}
});

test('recovery canonical tags stay synchronized with the publication plan', () => {
	withFixture((fixture, policy, plan) => {
		policy.distTagPolicy.canonicalStableTag = 'stable';
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /stable publication must use latest/u);
		assert.equal(plan.distTagPolicy.stable, 'latest');
	});
	withFixture((fixture, policy) => {
		policy.distTagPolicy.canonicalPrereleaseTag = 'beta';
		writeJson(resolve(fixture, '.github/release/npm-publication-recovery-v1.json'), policy);
		assert.throws(() => verifyNpmPublicationRecoveryPolicy(fixture), /prerelease publication must use next/u);
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
