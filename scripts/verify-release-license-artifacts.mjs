import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function verifyReleaseLicenseArtifacts(root = repositoryRoot) {
	const releaseDirectory = resolve(root, 'release');
	const rootManifest = readJson(resolve(root, 'package.json'));
	const expectedLicense = nonEmptyString(rootManifest.license, 'root package license');
	const version = nonEmptyString(rootManifest.version, 'root package version');
	const canonicalLicense = readFileSync(resolve(root, 'LICENSE'));
	const canonicalNotice = readFileSync(resolve(root, 'NOTICE'));

	assertEqualBytes(readFileSync(resolve(releaseDirectory, 'LICENSE')), canonicalLicense, 'release/LICENSE');
	assertEqualBytes(readFileSync(resolve(releaseDirectory, 'NOTICE')), canonicalNotice, 'release/NOTICE');

	const tarballs = [
		`virune-runtime-${version}.tgz`,
		`virune-compiler-${version}.tgz`,
		`virune-formatter-${version}.tgz`,
		`virune-js-interop-${version}.tgz`,
		`virune-stdlib-${version}.tgz`,
		`virune-${version}.tgz`,
	];
	for (const file of tarballs) {
		const entries = readTarEntries(readFileSync(resolve(releaseDirectory, file)));
		const manifestBytes = requireEntry(entries, 'package/package.json', file);
		const manifest = JSON.parse(manifestBytes.toString('utf8'));
		if (manifest.license !== expectedLicense) {
			throw new Error(`${file} package license ${JSON.stringify(manifest.license)} does not match ${expectedLicense}`);
		}
		assertEqualBytes(requireEntry(entries, 'package/LICENSE', file), canonicalLicense, `${file}: package/LICENSE`);
		assertEqualBytes(requireEntry(entries, 'package/NOTICE', file), canonicalNotice, `${file}: package/NOTICE`);
	}

	const sbom = readJson(resolve(releaseDirectory, 'SBOM.cdx.json'));
	const rootLicenses = sbom?.metadata?.component?.licenses;
	if (!Array.isArray(rootLicenses) || rootLicenses.length !== 1 || rootLicenses[0]?.license?.id !== expectedLicense) {
		throw new Error(`SBOM root component license must be exactly ${expectedLicense}`);
	}

	console.log(`Release license artifacts verified: ${expectedLicense}, ${tarballs.length} npm packages.`);
	return { license: expectedLicense, packageCount: tarballs.length };
}

function readTarEntries(tgzBytes) {
	const tar = gunzipSync(tgzBytes);
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
		if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid tar entry size for ${fullName}`);
		const dataStart = offset + 512;
		const dataEnd = dataStart + size;
		if (dataEnd > tar.byteLength) throw new Error(`Truncated tar entry ${fullName}`);
		if (entries.has(fullName)) throw new Error(`Duplicate tar entry ${fullName}`);
		entries.set(fullName, tar.subarray(dataStart, dataEnd));
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	return entries;
}

function requireEntry(entries, path, archive) {
	const value = entries.get(path);
	if (value === undefined) throw new Error(`${archive} is missing ${path}`);
	return value;
}

function assertEqualBytes(actual, expected, label) {
	if (!actual.equals(expected)) throw new Error(`${label} does not match the canonical repository file`);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function nonEmptyString(value, label) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) verifyReleaseLicenseArtifacts();
