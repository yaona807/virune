import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';
import { auditNpmPackageFileSet } from './npm-package-contents-policy.mjs';
import {
	isRegularTarEntry,
	readRegistryCandidateTarEntries,
	readRegularReleaseAsset,
	verifyNpmPublicationIdentity,
} from './verify-npm-publication-identity.mjs';

export function verifyNpmReleaseCandidateContents({
	root = process.cwd(),
	releaseDirectory = resolve(root, 'release'),
	verifyIdentity = verifyNpmPublicationIdentity,
	readAsset = readRegularReleaseAsset,
} = {}) {
	const identity = verifyIdentity({ root, releaseDirectory });
	const packages = array(identity.packages, '$.publicationIdentity.packages')
		.map((value, index) => identityPackage(value, `$.publicationIdentity.packages[${index}]`))
		.sort((left, right) => compareText(left.registryName, right.registryName));
	assert(packages.length > 0, '$.publicationIdentity.packages', 'at least one reviewed Registry candidate is required');
	assertUnique(packages.map(item => item.registryName), '$.publicationIdentity.packages', 'registryName');
	assertUnique(packages.map(item => item.releaseAsset), '$.publicationIdentity.packages', 'releaseAsset');
	assert(identity.publishSource === 'reviewed-release-registry-candidate-tarball', '$.publicationIdentity.publishSource', 'exact reviewed Registry candidate source is required');
	const version = nonEmptyString(identity.version, '$.publicationIdentity.version');
	const audited = [];

	for (const item of packages) {
		const path = `$.registryCandidate.${item.releaseAsset}`;
		const bytes = readAsset(resolve(releaseDirectory, item.releaseAsset), path);
		assert(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array, path, 'expected package bytes');
		const buffer = Buffer.from(bytes);
		const sha256 = createHash('sha256').update(buffer).digest('hex');
		assert(sha256 === item.sha256, `${path}.sha256`, 'exact candidate bytes do not match reviewed publication identity');
		assert(buffer.byteLength === item.bytes, `${path}.bytes`, 'exact candidate byte size does not match reviewed publication identity');

		const entries = readRegistryCandidateTarEntries(buffer, path);
		assert(entries.size > 0, path, 'candidate tarball must contain entries');
		const manifestEntry = entries.get('package/package.json');
		assert(manifestEntry !== undefined && isRegularTarEntry(manifestEntry), `${path}.packageJson`, 'package/package.json must be a regular file');
		let manifestText;
		try {
			manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestEntry.bytes);
		} catch {
			throw new Error(`${path}.packageJson: invalid UTF-8 package.json`);
		}
		let manifest;
		try {
			manifest = record(JSON.parse(manifestText), `${path}.packageJson`);
		} catch (error) {
			throw new Error(`${path}.packageJson: invalid package.json: ${error instanceof Error ? error.message : String(error)}`);
		}
		assert(manifest.name === item.registryName, `${path}.packageJson.name`, `expected ${item.registryName}`);
		assert(manifest.version === version, `${path}.packageJson.version`, `expected ${version}`);

		const files = [];
		for (const [entryPath, entry] of entries) {
			assert(entryPath.startsWith('package/'), path, `tar entry must be under package/: ${entryPath}`);
			const relativePath = entryPath.slice('package/'.length);
			assert(relativePath.length > 0, path, 'package root directory entry is not a publishable file');
			assert(isRegularTarEntry(entry), path, `non-regular tar entry is forbidden: ${entryPath}`);
			files.push({ path: relativePath, size: entry.bytes.byteLength });
		}
		const fileEvidence = auditNpmPackageFileSet({
			manifest,
			files,
			manifestPath: `${path}.packageJson`,
			filesPath: `${path}.files`,
		});
		audited.push({
			registryName: item.registryName,
			releaseAsset: item.releaseAsset,
			sha256,
			bytes: buffer.byteLength,
			...fileEvidence,
		});
	}

	return {
		schemaVersion: 1,
		stage: 'exact-reviewed-registry-candidate-contents-audit',
		version,
		packageCount: audited.length,
		packages: audited,
	};
}

function identityPackage(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['registryName', 'releaseAsset', 'sha256', 'bytes'], path);
	const registryName = nonEmptyString(item.registryName, `${path}.registryName`);
	assert(/^(?:virune|@virune\/[a-z0-9][a-z0-9-]*)$/u.test(registryName), `${path}.registryName`, 'expected virune or an @virune/* package name');
	const releaseAsset = nonEmptyString(item.releaseAsset, `${path}.releaseAsset`);
	assert(!releaseAsset.includes('/') && !releaseAsset.includes('\\') && !releaseAsset.includes('..') && releaseAsset.endsWith('.tgz'), `${path}.releaseAsset`, 'expected a canonical Registry candidate tarball basename');
	const sha256 = nonEmptyString(item.sha256, `${path}.sha256`);
	assert(/^[0-9a-f]{64}$/u.test(sha256), `${path}.sha256`, 'expected a lowercase SHA-256 digest');
	assert(Number.isInteger(item.bytes) && item.bytes > 0, `${path}.bytes`, 'expected a positive integer');
	return { registryName, releaseAsset, sha256, bytes: item.bytes };
}

function array(value, path) {
	assert(Array.isArray(value), path, 'expected an array');
	return value;
}
function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}
function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
	return value;
}
function assertExactKeys(value, expected, path) {
	const item = record(value, path);
	const actual = Object.keys(item).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(wanted), path, `expected keys ${wanted.join(', ')}`);
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
	const result = verifyNpmReleaseCandidateContents();
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
