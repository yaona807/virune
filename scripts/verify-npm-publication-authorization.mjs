import { createHash } from 'node:crypto';
import {
	NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
	validateNpmPublicationAuthorizationContract,
} from './npm-publication-authorization-contract.mjs';
import {
	bundledCliReleaseAssetName,
	registryReleaseAssetNameForPackage,
} from './verify-npm-publication-identity.mjs';
import { registryPolicyForVersion } from './npm-publication-version-policy.mjs';

export function evaluateNpmPublicationAuthorization({
	publicationPlan,
	reviewedCommit,
	evidenceSetId,
	publicationManifestBytes,
	evidence,
} = {}) {
	const plan = record(publicationPlan, '$.publicationPlan');
	const commit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const execution = evidenceSetIdentity(evidenceSetId, '$.evidenceSetId');
	const authorization = validateNpmPublicationAuthorizationContract(plan.authorization, '$.publicationPlan.authorization');
	assert(plan.stage === 'publication-candidate', '$.publicationPlan.stage', 'source must be in publication-candidate stage');
	assert(plan.publicationReady === true, '$.publicationPlan.publicationReady', 'reviewed source declaration must be publicationReady:true');
	const version = nonEmptyString(plan.currentVersion, '$.publicationPlan.currentVersion');
	const unresolved = requirementList(plan.unresolvedRequirements, '$.publicationPlan.unresolvedRequirements');
	assert(
		JSON.stringify(unresolved) === JSON.stringify(NPM_PUBLICATION_POST_WRITE_REQUIREMENTS),
		'$.publicationPlan.unresolvedRequirements',
		`publication-candidate must leave only post-write completion requirements unresolved: ${NPM_PUBLICATION_POST_WRITE_REQUIREMENTS.join(', ')}`,
	);
	const registryPolicy = registryPolicyForVersion(
		version,
		nonEmptyString(plan.firstStableRegistryRelease, '$.publicationPlan.firstStableRegistryRelease'),
		record(plan.distTagPolicy, '$.publicationPlan.distTagPolicy'),
	);
	assert(registryPolicy.registryVersionEligible === true, '$.publicationPlan.currentVersion', 'publication-candidate version must be Registry-eligible');

	const manifestBytes = exactBytes(publicationManifestBytes, '$.publicationManifestBytes');
	const manifestIdentity = validatePublicationManifestForAuthorization(manifestBytes, {
		version,
		distTag: registryPolicy.distTag,
		publishPackages: plan.publishPackages,
	});
	const evidenceRecords = validateAuthorizationEvidence(evidence, {
		contract: authorization,
		reviewedCommit: commit,
		evidenceSetId: execution,
		version,
		publicationManifestSha256: manifestIdentity.sha256,
		publicationManifestBytes: manifestIdentity.bytes,
	});
	return {
		schemaVersion: 1,
		kind: authorization.reportKind,
		publicationReady: true,
		reviewedCommit: commit,
		evidenceSetId: execution,
		version,
		publicationManifest: {
			sha256: manifestIdentity.sha256,
			bytes: manifestIdentity.bytes,
		},
		satisfiedPreWriteRequirements: evidenceRecords.map(item => item.requirement),
		remainingPostWriteCompletionRequirements: [...authorization.postWriteCompletionRequirements],
	};
}

export function validatePublicationManifestForAuthorization(bytes, { version, distTag, publishPackages }) {
	const buffer = exactBytes(bytes, '$.publicationManifestBytes');
	let parsed;
	try {
		parsed = JSON.parse(buffer.toString('utf8'));
	} catch (error) {
		throw new Error(`$.publicationManifest: malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	const manifest = record(parsed, '$.publicationManifest');
	assertExactKeys(manifest, [
		'schemaVersion',
		'version',
		'githubReleaseTag',
		'publishSource',
		'bundledCliReleaseAsset',
		'publicationReady',
		'registryVersionEligible',
		'distTag',
		'packages',
	], '$.publicationManifest');
	assert(manifest.schemaVersion === 1, '$.publicationManifest.schemaVersion', 'expected schemaVersion 1');
	assert(manifest.version === version, '$.publicationManifest.version', `expected ${version}`);
	assert(manifest.githubReleaseTag === `v${version}`, '$.publicationManifest.githubReleaseTag', `expected v${version}`);
	assert(manifest.publishSource === 'reviewed-release-registry-candidate-tarball', '$.publicationManifest.publishSource', 'unexpected publication source');
	assert(manifest.bundledCliReleaseAsset === bundledCliReleaseAssetName(version), '$.publicationManifest.bundledCliReleaseAsset', 'unexpected bundled CLI release asset');
	assert(manifest.publicationReady === true, '$.publicationManifest.publicationReady', 'reviewed publication manifest must declare publicationReady:true');
	assert(manifest.registryVersionEligible === true, '$.publicationManifest.registryVersionEligible', 'reviewed publication manifest must be Registry-eligible');
	assert(manifest.distTag === distTag, '$.publicationManifest.distTag', `expected ${String(distTag)}`);

	const expectedNames = array(publishPackages, '$.publicationPlan.publishPackages')
		.map((item, index) => nonEmptyString(record(item, `$.publicationPlan.publishPackages[${index}]`).registryName, `$.publicationPlan.publishPackages[${index}].registryName`))
		.sort(compareText);
	assertUnique(expectedNames, '$.publicationPlan.publishPackages', 'registryName');
	const packages = array(manifest.packages, '$.publicationManifest.packages').map((item, index) => {
		const pkg = record(item, `$.publicationManifest.packages[${index}]`);
		assertExactKeys(pkg, ['registryName', 'releaseAsset', 'sha256', 'bytes'], `$.publicationManifest.packages[${index}]`);
		const registryName = nonEmptyString(pkg.registryName, `$.publicationManifest.packages[${index}].registryName`);
		const releaseAsset = nonEmptyString(pkg.releaseAsset, `$.publicationManifest.packages[${index}].releaseAsset`);
		assert(releaseAsset === registryReleaseAssetNameForPackage(registryName, version), `$.publicationManifest.packages[${index}].releaseAsset`, 'candidate filename drift');
		const sha256 = nonEmptyString(pkg.sha256, `$.publicationManifest.packages[${index}].sha256`);
		assert(/^[0-9a-f]{64}$/u.test(sha256), `$.publicationManifest.packages[${index}].sha256`, 'expected lowercase SHA-256');
		assert(Number.isSafeInteger(pkg.bytes) && pkg.bytes > 0, `$.publicationManifest.packages[${index}].bytes`, 'expected positive safe integer byte size');
		return { registryName, releaseAsset, sha256, bytes: pkg.bytes };
	});
	assertUnique(packages.map(item => item.registryName), '$.publicationManifest.packages', 'registryName');
	assertUnique(packages.map(item => item.releaseAsset), '$.publicationManifest.packages', 'releaseAsset');
	const actualNames = packages.map(item => item.registryName).sort(compareText);
	assert(
		JSON.stringify(actualNames) === JSON.stringify(expectedNames),
		'$.publicationManifest.packages',
		`expected exact Registry package set ${expectedNames.join(', ')}`,
	);
	return {
		sha256: createHash('sha256').update(buffer).digest('hex'),
		bytes: buffer.byteLength,
	};
}

export function validateAuthorizationEvidence(evidence, {
	contract,
	reviewedCommit,
	evidenceSetId,
	version,
	publicationManifestSha256,
	publicationManifestBytes,
}) {
	const records = array(evidence, '$.evidence').map((item, index) => {
		const path = `$.evidence[${index}]`;
		const recordValue = record(item, path);
		assertExactKeys(recordValue, [
			'schemaVersion',
			'requirement',
			'result',
			'reviewedCommit',
			'evidenceSetId',
			'version',
			'publicationManifestSha256',
			'publicationManifestBytes',
		], path);
		assert(recordValue.schemaVersion === contract.evidenceSchemaVersion, `${path}.schemaVersion`, `expected ${contract.evidenceSchemaVersion}`);
		const requirement = nonEmptyString(recordValue.requirement, `${path}.requirement`);
		assert(recordValue.result === 'passed', `${path}.result`, 'only passed evidence can authorize publication');
		assert(recordValue.reviewedCommit === reviewedCommit, `${path}.reviewedCommit`, `expected ${reviewedCommit}`);
		assert(recordValue.evidenceSetId === evidenceSetId, `${path}.evidenceSetId`, `expected current evidence set ${evidenceSetId}`);
		assert(recordValue.version === version, `${path}.version`, `expected ${version}`);
		assert(recordValue.publicationManifestSha256 === publicationManifestSha256, `${path}.publicationManifestSha256`, 'must match exact reviewed publication manifest');
		assert(recordValue.publicationManifestBytes === publicationManifestBytes, `${path}.publicationManifestBytes`, 'must match exact reviewed publication manifest byte size');
		return { requirement };
	});
	assertUnique(records.map(item => item.requirement), '$.evidence', 'requirement');
	records.sort((left, right) => compareText(left.requirement, right.requirement));
	const actual = records.map(item => item.requirement);
	assert(
		JSON.stringify(actual) === JSON.stringify(NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS),
		'$.evidence',
		`expected exact pre-write evidence set ${NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS.join(', ')}`,
	);
	return records;
}

function requirementList(value, path) {
	const requirements = array(value, path).map((item, index) => nonEmptyString(item, `${path}[${index}]`));
	assertUnique(requirements, path, 'requirement');
	return requirements;
}

function exactBytes(value, path) {
	assert(Buffer.isBuffer(value) || value instanceof Uint8Array, path, 'expected exact bytes');
	const buffer = Buffer.from(value);
	assert(buffer.byteLength > 0, path, 'must not be empty');
	return buffer;
}

function fullCommitSha(value, path) {
	assert(typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value), path, 'expected a full lowercase commit SHA');
	return value;
}

function evidenceSetIdentity(value, path) {
	const identity = nonEmptyString(value, path);
	assert(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(identity), path, 'invalid evidence set identity');
	return identity;
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function array(value, path) {
	assert(Array.isArray(value), path, 'expected an array');
	return value;
}

function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
	return value;
}

function assertExactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(wanted), path, `expected exact keys ${wanted.join(', ')}`);
}

function assertUnique(values, path, label) {
	assert(new Set(values).size === values.length, path, `duplicate ${label}`);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
