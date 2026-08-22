import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseReleaseVersion, registryPolicyForVersion } from './npm-publication-version-policy.mjs';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';

export { registryPolicyForVersion } from './npm-publication-version-policy.mjs';

const PUBLICATION_MANIFEST = 'PUBLICATION-MANIFEST.json';
const RELEASE_PACKAGE_MANIFEST = 'MANIFEST.json';
const CANDIDATE_DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const TAR_BLOCK_SIZE = 512;
const TAR_CHECKSUM_OFFSET = 148;
const TAR_CHECKSUM_LENGTH = 8;
const TAR_SIZE_OFFSET = 124;
const TAR_SIZE_LENGTH = 12;

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
		const sourceManifest = findWorkspaceManifest(root, pkg.workspaceName);
		verifyRegistryCandidateTarball(assetBytes[file], publicationPlan.currentVersion, pkg.registryName, file, {
			...legal,
			expectedManifest: sourceManifest,
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
	const entries = readRegistryCandidateTarEntries(Buffer.from(bytes), path);
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
	if (legal.expectedManifest !== undefined) {
		const sourceManifest = structuredClone(record(legal.expectedManifest, `${path}.expectedManifest`));
		assert(sourceManifest.private === true, `${path}.expectedManifest.private`, 'reviewed source workspace must remain private:true');
		delete sourceManifest.private;
		assert(
			canonicalJson(manifest) === canonicalJson(sourceManifest),
			`${path}.packageJson`,
			'must match the reviewed source manifest with only private removed',
		);
	}
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

function findWorkspaceManifest(root, workspaceName) {
	const packagesDirectory = resolve(root, 'packages');
	const matches = [];
	for (const entry of readdirSync(packagesDirectory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
		if (!entry.isDirectory()) continue;
		const manifestPath = resolve(packagesDirectory, entry.name, 'package.json');
		if (!existsSync(manifestPath)) continue;
		const manifest = readJson(manifestPath);
		if (manifest.name === workspaceName) matches.push(manifest);
	}
	assert(matches.length === 1, `$.sourceWorkspace.${workspaceName}`, `expected exactly one workspace manifest; found ${matches.length}`);
	return matches[0];
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

export function isRegularTarEntry(entry) {
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

export function readRegistryCandidateTarEntries(tgzBytes, path) {
	let tar;
	try {
		tar = gunzipSync(tgzBytes);
	} catch (error) {
		throw new Error(`${path}: invalid gzip tarball: ${error instanceof Error ? error.message : String(error)}`);
	}
	assert(tar.byteLength >= TAR_BLOCK_SIZE * 2, path, 'tar archive is missing the canonical two-block end marker');
	assert(tar.byteLength % TAR_BLOCK_SIZE === 0, path, 'tar archive byte length must be aligned to 512-byte blocks');

	const entries = new Map();
	let offset = 0;
	while (offset + TAR_BLOCK_SIZE <= tar.byteLength) {
		const header = tar.subarray(offset, offset + TAR_BLOCK_SIZE);
		if (isZeroTarBlock(header)) {
			const secondEndOffset = offset + TAR_BLOCK_SIZE;
			assert(secondEndOffset + TAR_BLOCK_SIZE <= tar.byteLength, path, 'tar archive is missing the canonical second end block');
			assert(isZeroTarBlock(tar.subarray(secondEndOffset, secondEndOffset + TAR_BLOCK_SIZE)), path, 'tar archive is missing the canonical second end block');
			assert(tar.subarray(secondEndOffset + TAR_BLOCK_SIZE).every(byte => byte === 0), path, 'tar archive contains non-zero data after the canonical end marker');
			return entries;
		}

		const block = offset / TAR_BLOCK_SIZE;
		const declaredChecksum = parseTarOctalField(header, TAR_CHECKSUM_OFFSET, TAR_CHECKSUM_LENGTH, path, `checksum for entry at block ${block}`);
		let actualChecksum = 0;
		for (let index = 0; index < TAR_BLOCK_SIZE; index += 1) {
			actualChecksum += index >= TAR_CHECKSUM_OFFSET && index < TAR_CHECKSUM_OFFSET + TAR_CHECKSUM_LENGTH ? 0x20 : header[index];
		}
		assert(declaredChecksum === actualChecksum, path, `invalid tar header checksum for entry at block ${block}`);

		const name = decodeTarPathField(header, 0, 100, path, 'entry name', { required: true });
		const prefix = decodeTarPathField(header, 345, 155, path, 'entry prefix');
		const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
		const size = parseTarOctalField(header, TAR_SIZE_OFFSET, TAR_SIZE_LENGTH, path, `size for ${fullName}`);
		const dataStart = offset + TAR_BLOCK_SIZE;
		const dataEnd = dataStart + size;
		const paddedSize = Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
		const nextOffset = dataStart + paddedSize;
		assert(Number.isSafeInteger(nextOffset) && nextOffset <= tar.byteLength, path, `truncated tar entry ${fullName}`);
		assert(tar.subarray(dataEnd, nextOffset).every(byte => byte === 0), path, `tar entry ${fullName} has non-zero padding bytes`);
		assert(!entries.has(fullName), path, `duplicate tar entry ${fullName}`);
		entries.set(fullName, { bytes: tar.subarray(dataStart, dataEnd), typeFlag: header[156] });
		offset = nextOffset;
	}

	throw new Error(`${path}: tar archive is missing the canonical two-block end marker`);
}

function parseTarOctalField(header, start, length, path, description) {
	const field = header.subarray(start, start + length);
	assert((field[0] & 0x80) === 0, path, `unsupported base-256 tar ${description}`);
	const text = field.toString('latin1');
	const core = text.replace(/[\0 ]+$/u, '').replace(/^ +/u, '');
	assert(core.length === 0 || /^[0-7]+$/u.test(core), path, `invalid octal tar ${description}`);
	if (core.length === 0) return 0;
	const value = Number.parseInt(core, 8);
	assert(Number.isSafeInteger(value) && value >= 0, path, `invalid tar ${description}`);
	return value;
}

function decodeTarPathField(header, start, length, path, description, { required = false } = {}) {
	const field = header.subarray(start, start + length);
	const nulIndex = field.indexOf(0);
	const bytes = nulIndex === -1 ? field : field.subarray(0, nulIndex);
	if (nulIndex !== -1) {
		assert(field.subarray(nulIndex).every(byte => byte === 0), path, `non-zero data after NUL in tar ${description}`);
	}
	let text;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`${path}: invalid UTF-8 tar ${description}`);
	}
	if (required) assert(text.length > 0, path, `tar ${description} must not be empty`);
	return text;
}

function isZeroTarBlock(block) {
	return block.byteLength === TAR_BLOCK_SIZE && block.every(byte => byte === 0);
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

function packageName(value, path) {
	const name = nonEmptyString(value, path);
	assert(/^(?:@virune\/[a-z0-9][a-z0-9-]*|virune)$/u.test(name), path, 'expected virune or an @virune/* package name');
	return name;
}

function canonicalJson(value) {
	return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value !== null && typeof value === 'object') {
		return Object.fromEntries(Object.keys(value).sort(compareText).map(key => [key, canonicalValue(value[key])]));
	}
	return value;
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
