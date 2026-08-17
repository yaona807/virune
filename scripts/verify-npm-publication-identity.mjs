import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';

const PUBLICATION_MANIFEST = 'PUBLICATION-MANIFEST.json';
const RELEASE_PACKAGE_MANIFEST = 'MANIFEST.json';
const CANDIDATE_DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

export function registryReleaseAssetNameForPackage(registryName, version) {
	const name = nonEmptyString(registryName, '$.registryName');
	const releaseVersion = parseReleaseVersion(version, '$.version').text;
	if (name === 'virune') return `virune-npm-${releaseVersion}.tgz`;
	const scoped = /^@virune\/([a-z0-9][a-z0-9-]*)$/u.exec(name);
	assert(scoped !== null, '$.registryName', 'expected virune or an @virune/* package name');
	return `virune-${scoped[1]}-${releaseVersion}.tgz`;
}

export function bundledCliReleaseAssetName(version) {
	const releaseVersion = parseReleaseVersion(version, '$.version').text;
	return `virune-${releaseVersion}.tgz`;
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
	const registryTarballs = packages.map(item => item.releaseAsset).sort(compareText);
	const bundledCliReleaseAsset = bundledCliReleaseAssetName(parsedVersion.text);
	const expectedTarballs = [...registryTarballs, bundledCliReleaseAsset].sort(compareText);
	assertUnique(expectedTarballs, '$.publishPackages', 'release tarball');
	assert(
		JSON.stringify(actualTarballs) === JSON.stringify(expectedTarballs),
		'$.releaseTarballs',
		`expected exact release tarball set ${expectedTarballs.join(', ')}`,
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
		`expected exact release package manifest set ${expectedTarballs.join(', ')}`,
	);
	const byFile = new Map(manifestPackages.map(item => [item.file, item]));
	const bytesByFile = record(assetBytes, '$.assetBytes');
	assertExactKeys(bytesByFile, expectedTarballs, '$.assetBytes');
	const actualByFile = new Map();
	for (const file of expectedTarballs) {
		const bytes = bytesByFile[file];
		assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, `$.assetBytes.${file}`, 'expected package bytes');
		const buffer = Buffer.from(bytes);
		const actual = { sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.byteLength };
		const declared = byFile.get(file);
		assert(declared.sha256 === actual.sha256, `$.releaseManifest.packages.${file}.sha256`, 'does not match actual release tarball bytes');
		assert(declared.bytes === actual.bytes, `$.releaseManifest.packages.${file}.bytes`, 'does not match actual release tarball byte size');
		actualByFile.set(file, actual);
	}

	const identityPackages = packages.map(item => {
		const actual = actualByFile.get(item.releaseAsset);
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
		publishSource: 'reviewed-release-registry-candidate-tarball',
		bundledCliReleaseAsset,
		publicationReady,
		registryVersionEligible: registryPolicy.registryVersionEligible,
		distTag: registryPolicy.distTag,
		packages: identityPackages,
	};
}

export function readRegularReleaseAsset(path, logicalPath, { noFollowFlag = constants.O_NOFOLLOW } = {}) {
	const portableNoFollowFlag = typeof noFollowFlag === 'number' ? noFollowFlag : 0;
	const fd = openSync(path, constants.O_RDONLY | portableNoFollowFlag);
	try {
		const opened = fstatSync(fd, { bigint: true });
		assert(opened.isFile(), logicalPath, 'release tarball must be a regular file');
		const bytes = readFileSync(fd);
		const current = lstatSync(path, { bigint: true });
		assert(current.isFile() && !current.isSymbolicLink(), logicalPath, 'release tarball must be a regular file');
		assert(current.dev === opened.dev && current.ino === opened.ino, logicalPath, 'release tarball path changed while being read');
		return bytes;
	} finally {
		closeSync(fd);
	}
}

export function buildNpmPublicationIdentity({ root = process.cwd(), releaseDirectory = resolve(root, 'release') } = {}) {
	const publicationPlan = verifyNpmPublicationPlan(root);
	const releaseManifest = readJson(resolve(releaseDirectory, RELEASE_PACKAGE_MANIFEST));
	const releaseTarballs = readdirSync(releaseDirectory)
		.filter(file => file.endsWith('.tgz'))
		.sort(compareText);
	const assetBytes = Object.fromEntries(releaseTarballs.map(file => [
		file,
		readRegularReleaseAsset(resolve(releaseDirectory, file), `$.releaseTarballs.${file}`),
	]));
	const rootManifest = readJson(resolve(root, 'package.json'));
	const legal = {
		expectedLicense: rootManifest.license,
		licenseBytes: readFileSync(resolve(root, 'LICENSE')),
		noticeBytes: readFileSync(resolve(root, 'NOTICE')),
	};
	for (const pkg of publicationPlan.publishPackages) {
		const file = registryReleaseAssetNameForPackage(pkg.registryName, publicationPlan.currentVersion);
		verifyRegistryCandidateTarball(assetBytes[file], publicationPlan.currentVersion, pkg.registryName, file, {
			...legal,
			requireEmbeddedCliVersion: pkg.registryName === 'virune',
		});
	}
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

export function verifyRegistryCandidateTarball(bytes, version, registryName, file = registryReleaseAssetNameForPackage(registryName, version), legal = {}) {
	const name = packageName(registryName, '$.registryName');
	const path = `$.registryCandidate.${file}`;
	assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, path, 'expected package bytes');
	const entries = readTarEntries(Buffer.from(bytes), path);
	const manifestEntry = entries.get('package/package.json');
	assert(manifestEntry !== undefined && isRegularTarEntry(manifestEntry), path, 'package/package.json must be a regular file');
	let manifest;
	try {
		manifest = record(JSON.parse(manifestEntry.bytes.toString('utf8')), `${path}.packageJson`);
	} catch (error) {
		throw new Error(`${path}: invalid package.json: ${error instanceof Error ? error.message : String(error)}`);
	}
	assert(manifest.name === name, `${path}.name`, `expected ${name}`);
	assert(manifest.version === version, `${path}.version`, `expected ${version}`);
	assert(manifest.private === undefined, `${path}.private`, 'reviewed Registry candidate must omit private so the exact tarball is publishable');
	assert(manifest.publishConfig === undefined, `${path}.publishConfig`, 'publishConfig must not be present before publication enablement');
	if (legal.expectedLicense !== undefined) assert(manifest.license === legal.expectedLicense, `${path}.license`, `expected ${legal.expectedLicense}`);
	verifyCanonicalLegalEntry(entries, 'package/LICENSE', legal.licenseBytes, `${path}.LICENSE`);
	verifyCanonicalLegalEntry(entries, 'package/NOTICE', legal.noticeBytes, `${path}.NOTICE`);
	if (legal.requireEmbeddedCliVersion === true) {
		assert(name === 'virune', path, 'embedded CLI version validation is only valid for the virune package');
		verifyEmbeddedCliVersion(entries, version, file);
	}
	assert(manifest.bundledDependencies === undefined && manifest.bundleDependencies === undefined, path, 'Registry candidate must not declare bundled dependencies');
	for (const entryPath of entries.keys()) {
		assert(!entryPath.startsWith('package/node_modules/'), path, `Registry candidate must not contain bundled dependency path ${entryPath}`);
	}
	for (const section of CANDIDATE_DEPENDENCY_SECTIONS) {
		if (manifest[section] === undefined) continue;
		const dependencies = record(manifest[section], `${path}.${section}`);
		for (const [dependency, dependencyVersion] of Object.entries(dependencies)) {
			if (dependency === 'virune' || dependency.startsWith('@virune/')) {
				assert(dependencyVersion === version, `${path}.${section}.${dependency}`, `expected exact release version ${version}`);
			}
		}
	}
	return { name: manifest.name, version: manifest.version, entryCount: entries.size };
}

export function verifyRegistryCliCandidateTarball(bytes, version, file = registryReleaseAssetNameForPackage('virune', version), legal = {}) {
	return verifyRegistryCandidateTarball(bytes, version, 'virune', file, legal);
}

function verifyEmbeddedCliVersion(entries, version, file) {
	const entry = entries.get('package/dist/src/main.js');
	assert(entry !== undefined && isRegularTarEntry(entry), `$.registryCli.${file}.dist/src/main.js`, 'package/dist/src/main.js must be a regular file');
	const source = entry.bytes.toString('utf8');
	const pattern = /const VERSION = (['"])([^'"]+)\1;/gu;
	const matches = [...source.matchAll(pattern)];
	assert(matches.length === 1, `$.registryCli.${file}.dist/src/main.js`, `expected exactly one embedded VERSION declaration; found ${matches.length}`);
	assert(matches[0][2] === version, `$.registryCli.${file}.dist/src/main.js`, `embedded VERSION ${matches[0][2]} does not match ${version}`);
}

function isRegularTarEntry(entry) {
	return entry.typeFlag === 0 || entry.typeFlag === '0'.charCodeAt(0);
}

function verifyCanonicalLegalEntry(entries, entryPath, expectedBytes, path) {
	const entry = entries.get(entryPath);
	assert(entry !== undefined && isRegularTarEntry(entry), path, `${entryPath} must be a regular file`);
	if (expectedBytes !== undefined) {
		const expected = Buffer.from(expectedBytes);
		assert(entry.bytes.equals(expected), path, `${entryPath} does not match the canonical repository file`);
	}
}

function readTarEntries(tgzBytes, path) {
	let tar;
	try {
		tar = gunzipSync(tgzBytes);
	} catch (error) {
		throw new Error(`${path}: invalid gzip tarball: ${error instanceof Error ? error.message : String(error)}`);
	}
	const entries = new Map();
	let offset = 0;
	while (offset + 512 <= tar.byteLength) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every(byte => byte === 0)) break;
		const stringField = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '');
		const name = stringField(0, 100);
		const prefix = stringField(345, 155);
		const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
		const sizeText = stringField(124, 12).trim();
		const size = sizeText.length > 0 ? Number.parseInt(sizeText, 8) : 0;
		assert(Number.isSafeInteger(size) && size >= 0, path, `invalid tar entry size for ${fullName}`);
		const dataStart = offset + 512;
		const dataEnd = dataStart + size;
		assert(dataEnd <= tar.byteLength, path, `truncated tar entry ${fullName}`);
		assert(!entries.has(fullName), path, `duplicate tar entry ${fullName}`);
		entries.set(fullName, { bytes: tar.subarray(dataStart, dataEnd), typeFlag: header[156] });
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	return entries;
}

function publicationPackage(value, path, version) {
	const item = record(value, path);
	assertExactKeys(item, ['workspaceName', 'registryName'], path);
	const workspaceName = packageName(item.workspaceName, `${path}.workspaceName`);
	const registryName = packageName(item.registryName, `${path}.registryName`);
	assert(workspaceName === registryName, path, 'registry package renaming is not supported by the reviewed release identity');
	return { registryName, releaseAsset: registryReleaseAssetNameForPackage(registryName, version) };
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
