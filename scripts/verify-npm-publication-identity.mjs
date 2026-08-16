import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';

const PUBLICATION_MANIFEST = 'PUBLICATION-MANIFEST.json';
const RELEASE_PACKAGE_MANIFEST = 'MANIFEST.json';

export function releaseAssetNameForPackage(registryName, version) {
	const name = nonEmptyString(registryName, '$.registryName');
	const releaseVersion = parseReleaseVersion(version, '$.version').text;
	if (name === 'virune') return `virune-${releaseVersion}.tgz`;
	const scoped = /^@virune\/([a-z0-9][a-z0-9-]*)$/u.exec(name);
	assert(scoped !== null, '$.registryName', 'expected virune or an @virune/* package name');
	return `virune-${scoped[1]}-${releaseVersion}.tgz`;
}

export function registryPolicyForVersion(version, firstStableRegistryRelease, distTagPolicy) {
	const parsed = parseReleaseVersion(version, '$.version');
	const firstStable = parseReleaseVersion(firstStableRegistryRelease, '$.firstStableRegistryRelease');
	assert(firstStable.channel === 'stable', '$.firstStableRegistryRelease', 'expected a stable semantic version');
	const tags = record(distTagPolicy, '$.distTagPolicy');
	const stableTag = nonEmptyString(tags.stable, '$.distTagPolicy.stable');
	const prereleaseTag = nonEmptyString(tags.prerelease, '$.distTagPolicy.prerelease');
	assert(stableTag === 'latest', '$.distTagPolicy.stable', 'stable npm publication must use latest');
	assert(prereleaseTag === 'next', '$.distTagPolicy.prerelease', 'prerelease npm publication must use next');
	assert(tags.nightly === null, '$.distTagPolicy.nightly', 'nightly npm publication must remain disabled');
	const beforeFirstStable = compareVersionTuple(parsed.base, firstStable.base) < 0;
	if (parsed.channel === 'nightly' || beforeFirstStable) {
		return { channel: parsed.channel, registryVersionEligible: false, distTag: null };
	}
	return {
		channel: parsed.channel,
		registryVersionEligible: true,
		distTag: parsed.channel === 'stable' ? stableTag : prereleaseTag,
	};
}

export function buildNpmPublicationIdentityFromInputs({
	version,
	publicationReady,
	firstStableRegistryRelease,
	distTagPolicy,
	publishPackages,
	releaseManifest,
	releaseTarballs,
	assetBytes,
}) {
	const parsedVersion = parseReleaseVersion(version, '$.version');
	assert(typeof publicationReady === 'boolean', '$.publicationReady', 'expected a boolean');
	const packages = array(publishPackages, '$.publishPackages')
		.map((item, index) => publicationPackage(item, `$.publishPackages[${index}]`, parsedVersion.text))
		.sort((left, right) => compareText(left.registryName, right.registryName));
	assert(packages.length > 0, '$.publishPackages', 'at least one npm publication package is required');
	assertUnique(packages.map(item => item.registryName), '$.publishPackages', 'registryName');
	assertUnique(packages.map(item => item.releaseAsset), '$.publishPackages', 'release asset');

	const actualTarballs = array(releaseTarballs, '$.releaseTarballs')
		.map((value, index) => releaseAssetFilename(value, `$.releaseTarballs[${index}]`))
		.sort(compareText);
	assertUnique(actualTarballs, '$.releaseTarballs', 'tarball');
	const expectedTarballs = packages.map(item => item.releaseAsset).sort(compareText);
	assert(
		JSON.stringify(actualTarballs) === JSON.stringify(expectedTarballs),
		'$.releaseTarballs',
		`expected exact npm tarball set ${expectedTarballs.join(', ')}`,
	);

	const manifest = record(releaseManifest, '$.releaseManifest');
	assertExactKeys(manifest, ['schemaVersion', 'version', 'packages'], '$.releaseManifest');
	assert(manifest.schemaVersion === 1, '$.releaseManifest.schemaVersion', 'expected release package manifest schemaVersion 1');
	assert(manifest.version === parsedVersion.text, '$.releaseManifest.version', `expected ${parsedVersion.text}`);
	const manifestPackages = array(manifest.packages, '$.releaseManifest.packages')
		.map((item, index) => releaseManifestPackage(item, `$.releaseManifest.packages[${index}]`));
	assertUnique(manifestPackages.map(item => item.file), '$.releaseManifest.packages', 'file');
	const manifestFiles = manifestPackages.map(item => item.file).sort(compareText);
	assert(
		JSON.stringify(manifestFiles) === JSON.stringify(expectedTarballs),
		'$.releaseManifest.packages',
		`expected exact npm package manifest set ${expectedTarballs.join(', ')}`,
	);
	const byFile = new Map(manifestPackages.map(item => [item.file, item]));
	const bytesByFile = record(assetBytes, '$.assetBytes');
	assertExactKeys(bytesByFile, expectedTarballs, '$.assetBytes');

	const identityPackages = packages.map(item => {
		const bytes = bytesByFile[item.releaseAsset];
		assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, `$.assetBytes.${item.releaseAsset}`, 'expected package bytes');
		const buffer = Buffer.from(bytes);
		const actual = {
			sha256: createHash('sha256').update(buffer).digest('hex'),
			bytes: buffer.byteLength,
		};
		const declared = byFile.get(item.releaseAsset);
		assert(declared.sha256 === actual.sha256, `$.releaseManifest.packages.${item.releaseAsset}.sha256`, 'does not match actual release tarball bytes');
		assert(declared.bytes === actual.bytes, `$.releaseManifest.packages.${item.releaseAsset}.bytes`, 'does not match actual release tarball byte size');
		return {
			registryName: item.registryName,
			releaseAsset: item.releaseAsset,
			sha256: actual.sha256,
			bytes: actual.bytes,
		};
	});
	const registryPolicy = registryPolicyForVersion(parsedVersion.text, firstStableRegistryRelease, distTagPolicy);
	return {
		schemaVersion: 1,
		version: parsedVersion.text,
		githubReleaseTag: `v${parsedVersion.text}`,
		publishSource: 'reviewed-release-tarball',
		publicationReady,
		registryVersionEligible: registryPolicy.registryVersionEligible,
		distTag: registryPolicy.distTag,
		packages: identityPackages,
	};
}

export function buildNpmPublicationIdentity({ root = process.cwd(), releaseDirectory = resolve(root, 'release') } = {}) {
	const publicationPlan = verifyNpmPublicationPlan(root);
	const releaseManifest = readJson(resolve(releaseDirectory, RELEASE_PACKAGE_MANIFEST));
	const releaseTarballs = readdirSync(releaseDirectory)
		.filter(file => file.endsWith('.tgz'))
		.sort(compareText);
	const assetBytes = Object.fromEntries(releaseTarballs.map(file => [file, readFileSync(resolve(releaseDirectory, file))]));
	return buildNpmPublicationIdentityFromInputs({
		version: publicationPlan.currentVersion,
		publicationReady: publicationPlan.publicationReady,
		firstStableRegistryRelease: publicationPlan.firstStableRegistryRelease,
		distTagPolicy: publicationPlan.distTagPolicy,
		publishPackages: publicationPlan.publishPackages,
		releaseManifest,
		releaseTarballs,
		assetBytes,
	});
}

export function writeNpmPublicationIdentity(options = {}) {
	const root = options.root ?? process.cwd();
	const releaseDirectory = options.releaseDirectory ?? resolve(root, 'release');
	const identity = buildNpmPublicationIdentity({ ...options, root, releaseDirectory });
	writeFileSync(resolve(releaseDirectory, PUBLICATION_MANIFEST), `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
	return identity;
}

export function verifyPublicationIdentityDocument(expected, actual) {
	assert(
		JSON.stringify(actual) === JSON.stringify(expected),
		'$.publicationManifest',
		'does not match the canonical publication identity derived from reviewed release tarballs',
	);
	return expected;
}

export function verifyNpmPublicationIdentity(options = {}) {
	const root = options.root ?? process.cwd();
	const releaseDirectory = options.releaseDirectory ?? resolve(root, 'release');
	const expected = buildNpmPublicationIdentity({ ...options, root, releaseDirectory });
	const actual = readJson(resolve(releaseDirectory, PUBLICATION_MANIFEST));
	verifyPublicationIdentityDocument(expected, actual);
	process.stdout.write(`Verified npm publication identity for ${expected.packages.length} reviewed release tarballs (${expected.version}).\n`);
	return expected;
}

function publicationPackage(value, path, version) {
	const item = record(value, path);
	assertExactKeys(item, ['workspaceName', 'registryName'], path);
	const workspaceName = packageName(item.workspaceName, `${path}.workspaceName`);
	const registryName = packageName(item.registryName, `${path}.registryName`);
	assert(workspaceName === registryName, path, 'registry package renaming is not supported by the reviewed release identity');
	return { registryName, releaseAsset: releaseAssetNameForPackage(registryName, version) };
}

function releaseManifestPackage(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['file', 'sha256', 'bytes'], path);
	const file = releaseAssetFilename(item.file, `${path}.file`);
	const sha256 = nonEmptyString(item.sha256, `${path}.sha256`);
	assert(/^[0-9a-f]{64}$/u.test(sha256), `${path}.sha256`, 'expected a lowercase SHA-256 digest');
	assert(Number.isInteger(item.bytes) && item.bytes > 0, `${path}.bytes`, 'expected a positive integer');
	return { file, sha256, bytes: item.bytes };
}

function releaseAssetFilename(value, path) {
	const file = nonEmptyString(value, path);
	assert(/^[a-z0-9][a-z0-9-]*-(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(?:0|[1-9]\d*)|-nightly\.\d{8}\.(?:0|[1-9]\d*))?\.tgz$/u.test(file), path, 'invalid canonical release tarball filename');
	assert(!file.includes('/') && !file.includes('\\') && !file.includes('..'), path, 'release tarball must be a canonical basename');
	return file;
}

function parseReleaseVersion(value, path) {
	const text = nonEmptyString(value, path);
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:(?:-(alpha|beta|rc)\.(0|[1-9]\d*))|(?:-nightly\.(\d{8})\.(0|[1-9]\d*)))?$/u.exec(text);
	assert(match !== null, path, 'expected stable, alpha, beta, rc, or nightly Virune semantic version');
	const base = match.slice(1, 4).map(Number);
	const channel = match[6] !== undefined ? 'nightly' : match[4] !== undefined ? 'prerelease' : 'stable';
	return { text, base, channel };
}

function compareVersionTuple(left, right) {
	for (let index = 0; index < 3; index += 1) {
		if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
	}
	return 0;
}

function packageName(value, path) {
	const name = nonEmptyString(value, path);
	assert(/^(?:@virune\/[a-z0-9][a-z0-9-]*|virune)$/u.test(name), path, 'expected virune or an @virune/* package name');
	return name;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}
function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
	return value;
}
function array(value, path) {
	assert(Array.isArray(value), path, 'expected an array');
	return value;
}
function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}
function assertExactKeys(value, expected, path) {
	const item = record(value, path);
	const actual = Object.keys(item).sort(compareText);
	const canonicalExpected = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(canonicalExpected), path, `expected keys ${canonicalExpected.join(', ')}`);
}
function assertUnique(values, path, name) {
	const seen = new Set();
	for (const value of values) {
		assert(!seen.has(value), path, `duplicate ${name} ${value}`);
		seen.add(value);
	}
}
function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}
function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

const argvPath = process.argv[1];
if (argvPath !== undefined && import.meta.url === pathToFileURL(resolve(argvPath)).href) {
	verifyNpmPublicationIdentity();
}
