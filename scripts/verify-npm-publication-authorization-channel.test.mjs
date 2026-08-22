import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
} from './npm-publication-authorization-contract.mjs';
import { evaluateNpmPublicationAuthorization } from './verify-npm-publication-authorization.mjs';

const version = '1.1.0';
const reviewedCommit = 'c'.repeat(40);
const evidenceSetId = 'github-actions:stable-release:1';

function plan() {
	return {
		schemaVersion: 1,
		stage: 'publication-candidate',
		publicationReady: true,
		unresolvedRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
		authorization: {
			schemaVersion: 1,
			reportKind: 'npm-publication-authorization-v1',
			evidenceSchemaVersion: 1,
			evidenceSetBindingRequired: true,
			preWriteRequirements: [...NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS],
			postWriteCompletionRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
		},
		forbidRegistryPublishThroughVersion: '1.0.0',
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
		trustedPublishingRequired: true,
		publicVerificationRequired: true,
		sameReviewedReleaseIdentityRequired: true,
		packages: [{ directory: 'cli', workspaceName: 'virune', registryName: 'virune', role: 'cli' }],
		excludedWorkspacePackages: [],
	};
}

function manifest(distTag = 'latest') {
	return {
		schemaVersion: 1,
		version,
		githubReleaseTag: `v${version}`,
		publishSource: 'reviewed-release-registry-candidate-tarball',
		bundledCliReleaseAsset: `virune-${version}.tgz`,
		publicationReady: true,
		registryVersionEligible: true,
		distTag,
		packages: [{
			registryName: 'virune',
			releaseAsset: `virune-npm-${version}.tgz`,
			sha256: 'a'.repeat(64),
			bytes: 123,
		}],
	};
}

function bytes(document = manifest()) {
	return Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function evidence(publicationBytes) {
	const sha256 = createHash('sha256').update(publicationBytes).digest('hex');
	return NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS.map(requirement => ({
		schemaVersion: 1,
		requirement,
		result: 'passed',
		reviewedCommit,
		evidenceSetId,
		version,
		publicationManifestSha256: sha256,
		publicationManifestBytes: publicationBytes.byteLength,
	}));
}

test('stable first Registry release authorizes only the canonical latest dist-tag', () => {
	const publicationBytes = bytes();
	const report = evaluateNpmPublicationAuthorization({
		publicationPlan: plan(),
		releaseVersion: version,
		reviewedCommit,
		evidenceSetId,
		publicationManifestBytes: publicationBytes,
		evidence: evidence(publicationBytes),
	});
	assert.equal(report.publicationReady, true);
	assert.equal(report.version, version);

	const wrongTagBytes = bytes(manifest('next'));
	assert.throws(() => evaluateNpmPublicationAuthorization({
		publicationPlan: plan(),
		releaseVersion: version,
		reviewedCommit,
		evidenceSetId,
		publicationManifestBytes: wrongTagBytes,
		evidence: evidence(wrongTagBytes),
	}), /expected latest/u);
});
