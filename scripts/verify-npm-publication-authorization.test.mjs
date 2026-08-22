import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
	NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_REQUIREMENTS,
	validateNpmPublicationAuthorizationContract,
} from './npm-publication-authorization-contract.mjs';
import { evaluateNpmPublicationAuthorization } from './verify-npm-publication-authorization.mjs';

const reviewedCommit = 'a'.repeat(40);
const evidenceSetId = 'github-actions:32550000000:1';
const version = '1.1.0-rc.1';

function authorizationContract() {
	return {
		schemaVersion: 1,
		reportKind: NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
		evidenceSchemaVersion: 1,
		evidenceSetBindingRequired: true,
		preWriteRequirements: [...NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS],
		postWriteCompletionRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
	};
}

function publicationPlan() {
	return {
		stage: 'publication-candidate',
		publicationReady: true,
		unresolvedRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
		currentVersion: version,
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
		publishPackages: [
			{ workspaceName: '@virune/runtime', registryName: '@virune/runtime' },
			{ workspaceName: 'virune', registryName: 'virune' },
		],
		authorization: authorizationContract(),
	};
}

function publicationManifest() {
	return {
		schemaVersion: 1,
		version,
		githubReleaseTag: `v${version}`,
		publishSource: 'reviewed-release-registry-candidate-tarball',
		bundledCliReleaseAsset: `virune-${version}.tgz`,
		publicationReady: true,
		registryVersionEligible: true,
		distTag: 'next',
		packages: [
			{ registryName: 'virune', releaseAsset: `virune-npm-${version}.tgz`, sha256: '1'.repeat(64), bytes: 101 },
			{ registryName: '@virune/runtime', releaseAsset: `virune-runtime-${version}.tgz`, sha256: '2'.repeat(64), bytes: 202 },
		],
	};
}

function manifestBytes(manifest = publicationManifest()) {
	return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function evidenceFor(bytes = manifestBytes(), overrides = {}) {
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS.map(requirement => ({
		schemaVersion: 1,
		requirement,
		result: 'passed',
		reviewedCommit,
		evidenceSetId,
		version,
		publicationManifestSha256: sha256,
		publicationManifestBytes: bytes.byteLength,
		...overrides,
	}));
}

function input(overrides = {}) {
	const bytes = overrides.publicationManifestBytes ?? manifestBytes();
	return {
		publicationPlan: publicationPlan(),
		reviewedCommit,
		evidenceSetId,
		publicationManifestBytes: bytes,
		evidence: evidenceFor(bytes),
		...overrides,
	};
}

test('canonical authorization contract partitions the complete publication requirement set', () => {
	const contract = validateNpmPublicationAuthorizationContract(authorizationContract());
	assert.equal(contract.reportKind, NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND);
	assert.deepEqual(
		[...contract.preWriteRequirements, ...contract.postWriteCompletionRequirements].sort(),
		[...NPM_PUBLICATION_REQUIREMENTS],
	);
	assert.equal(contract.preWriteRequirements.some(item => contract.postWriteCompletionRequirements.includes(item)), false);
});

test('authorization report requires both reviewed source readiness and complete exact-run evidence', () => {
	const report = evaluateNpmPublicationAuthorization(input());
	assert.deepEqual(report, {
		schemaVersion: 1,
		kind: NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
		publicationReady: true,
		reviewedCommit,
		evidenceSetId,
		version,
		publicationManifest: {
			sha256: createHash('sha256').update(manifestBytes()).digest('hex'),
			bytes: manifestBytes().byteLength,
		},
		satisfiedPreWriteRequirements: [...NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS],
		remainingPostWriteCompletionRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
	});
});

test('source declaration alone cannot authorize publication', () => {
	assert.throws(() => evaluateNpmPublicationAuthorization(input({ evidence: [] })), /expected exact pre-write evidence set/u);
	const falsePlan = publicationPlan();
	falsePlan.publicationReady = false;
	assert.throws(() => evaluateNpmPublicationAuthorization(input({ publicationPlan: falsePlan })), /publicationReady:true/u);
	const wrongStage = publicationPlan();
	wrongStage.stage = 'prepublication-audit';
	assert.throws(() => evaluateNpmPublicationAuthorization(input({ publicationPlan: wrongStage })), /publication-candidate/u);
});

test('publication-candidate source state leaves exactly post-write requirements unresolved', () => {
	for (const mutate of [
		plan => plan.unresolvedRequirements.push('trusted-publishing'),
		plan => plan.unresolvedRequirements.pop(),
		plan => { plan.unresolvedRequirements = [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS].reverse(); },
	]) {
		const plan = publicationPlan();
		mutate(plan);
		assert.throws(() => evaluateNpmPublicationAuthorization(input({ publicationPlan: plan })), /post-write completion requirements/u);
	}
});

test('post-write requirements cannot be moved into the pre-write authorization contract', () => {
	for (const mutate of [
		contract => { contract.preWriteRequirements[0] = 'public-registry-verification'; },
		contract => { contract.postWriteCompletionRequirements = contract.postWriteCompletionRequirements.filter(item => item !== 'public-registry-verification'); },
		contract => { contract.preWriteRequirements.push('clean-registry-install-smoke'); },
	]) {
		const contract = authorizationContract();
		mutate(contract);
		assert.throws(() => validateNpmPublicationAuthorizationContract(contract));
	}
});

test('reviewed publication manifest identity must agree with the source declaration', () => {
	for (const mutate of [
		manifest => { manifest.publicationReady = false; },
		manifest => { manifest.registryVersionEligible = false; },
		manifest => { manifest.version = '1.1.0-rc.2'; },
		manifest => { manifest.githubReleaseTag = 'v1.1.0-rc.2'; },
		manifest => { manifest.distTag = 'latest'; },
		manifest => { manifest.packages.pop(); },
		manifest => { manifest.packages[0].registryName = '@virune/unknown'; },
		manifest => { manifest.packages.push(structuredClone(manifest.packages[0])); },
		manifest => { manifest.unreviewed = true; },
	]) {
		const manifest = publicationManifest();
		mutate(manifest);
		const bytes = manifestBytes(manifest);
		assert.throws(() => evaluateNpmPublicationAuthorization(input({
			publicationManifestBytes: bytes,
			evidence: evidenceFor(bytes),
		})));
	}
	assert.throws(() => evaluateNpmPublicationAuthorization(input({ publicationManifestBytes: Buffer.from('{') })), /malformed JSON/u);
});

test('unknown, missing, duplicate, failed, stale or mismatched evidence fails closed', () => {
	const mutations = [
		evidence => evidence.pop(),
		evidence => { evidence[0].requirement = 'unknown-requirement'; },
		evidence => { evidence[1].requirement = evidence[0].requirement; },
		evidence => { evidence[0].result = 'failed'; },
		evidence => { evidence[0].reviewedCommit = 'b'.repeat(40); },
		evidence => { evidence[0].evidenceSetId = 'github-actions:older-run:1'; },
		evidence => { evidence[0].version = '1.1.0-rc.2'; },
		evidence => { evidence[0].publicationManifestSha256 = '0'.repeat(64); },
		evidence => { evidence[0].publicationManifestBytes += 1; },
		evidence => { evidence[0].unexpected = true; },
	];
	for (const mutate of mutations) {
		const bytes = manifestBytes();
		const evidence = evidenceFor(bytes);
		mutate(evidence);
		assert.throws(() => evaluateNpmPublicationAuthorization(input({ publicationManifestBytes: bytes, evidence })));
	}
});

test('an authorization evidence set cannot be reused by a later execution for the same release identity', () => {
	const bytes = manifestBytes();
	const oldEvidence = evidenceFor(bytes, { evidenceSetId: 'github-actions:32540000000:1' });
	assert.throws(() => evaluateNpmPublicationAuthorization(input({
		publicationManifestBytes: bytes,
		evidence: oldEvidence,
		evidenceSetId: 'github-actions:32550000000:2',
	})), /expected current evidence set/u);
});

test('authorization report ordering is deterministic across evidence input order', () => {
	const forward = evaluateNpmPublicationAuthorization(input());
	const reversedInput = input();
	reversedInput.evidence.reverse();
	const reversed = evaluateNpmPublicationAuthorization(reversedInput);
	assert.deepEqual(reversed, forward);
});

test('Registry-ineligible and nightly source versions cannot authorize publication', () => {
	for (const candidateVersion of ['1.0.0', '1.1.0-nightly.20260822.1']) {
		const plan = publicationPlan();
		plan.currentVersion = candidateVersion;
		assert.throws(() => evaluateNpmPublicationAuthorization(input({ publicationPlan: plan })), /Registry-eligible/u);
	}
});
