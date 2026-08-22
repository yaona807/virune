import { gunzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function verifyReleaseLicenseArtifacts(root = repositoryRoot) {
	const releaseDirectory = resolve(root, 'release');
	const rootManifest = readJson(resolve(root, 'package.json'));
	const expectedLicense = nonEmptyString(rootManifest.license, 'root package license');
	const version = nonEmptyString(rootManifest.version, 'root package version');
	const rootName = nonEmptyString(rootManifest.name, 'root package name');
	const canonicalLicense = readFileSync(resolve(root, 'LICENSE'));
	const canonicalNotice = readFileSync(resolve(root, 'NOTICE'));
	const canonicalThirdPartyNotices = readFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'));

	const releasePackageManifest = readJson(resolve(releaseDirectory, 'package.json'));
	if (releasePackageManifest.license !== expectedLicense) {
		throw new Error(`release/package.json license ${JSON.stringify(releasePackageManifest.license)} does not match ${expectedLicense}`);
	}
	assertEqualBytes(readFileSync(resolve(releaseDirectory, 'LICENSE')), canonicalLicense, 'release/LICENSE');
	assertEqualBytes(readFileSync(resolve(releaseDirectory, 'NOTICE')), canonicalNotice, 'release/NOTICE');
	assertEqualBytes(
		readFileSync(resolve(releaseDirectory, 'THIRD_PARTY_NOTICES.md')),
		canonicalThirdPartyNotices,
		'release/THIRD_PARTY_NOTICES.md',
	);

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
		const manifestBytes = requireRegularFileEntry(entries, 'package/package.json', file);
		const manifest = JSON.parse(manifestBytes.toString('utf8'));
		if (manifest.license !== expectedLicense) {
			throw new Error(`${file} package license ${JSON.stringify(manifest.license)} does not match ${expectedLicense}`);
		}
		assertEqualBytes(requireRegularFileEntry(entries, 'package/LICENSE', file), canonicalLicense, `${file}: package/LICENSE`);
		assertEqualBytes(requireRegularFileEntry(entries, 'package/NOTICE', file), canonicalNotice, `${file}: package/NOTICE`);
	}

	const sbom = readJson(resolve(releaseDirectory, 'SBOM.cdx.json'));
	const rootComponent = sbom?.metadata?.component;
	if (rootComponent?.name !== rootName || rootComponent?.version !== version) {
		throw new Error(`SBOM root component identity must match ${rootName}@${version}`);
	}
	const rootLicenses = rootComponent?.licenses;
	if (!Array.isArray(rootLicenses) || rootLicenses.length !== 1 || rootLicenses[0]?.license?.id !== expectedLicense) {
		throw new Error(`SBOM root component license must be exactly ${expectedLicense}`);
	}
	verifySbomWorkspaceComponents(sbom, listWorkspacePackages(root), expectedLicense);

	console.log(`Release license artifacts verified: ${expectedLicense}, ${tarballs.length} npm packages.`);
	return { license: expectedLicense, packageCount: tarballs.length };
}

function listWorkspacePackages(root) {
	const packagesRoot = resolve(root, 'packages');
	const packages = readdirSync(packagesRoot, { withFileTypes: true })
		.filter(entry => entry.isDirectory() && existsSync(resolve(packagesRoot, entry.name, 'package.json')))
		.map(entry => {
			const path = `packages/${entry.name}`;
			const manifest = readJson(resolve(packagesRoot, entry.name, 'package.json'));
			return {
				path,
				name: nonEmptyString(manifest.name, `${path} package name`),
				version: nonEmptyString(manifest.version, `${path} package version`),
			};
		})
		.sort((left, right) => compareText(left.path, right.path));
	if (packages.length === 0) throw new Error('No package workspaces were found for SBOM license verification');
	return packages;
}

function verifySbomWorkspaceComponents(sbom, workspaces, expectedLicense) {
	const components = Array.isArray(sbom?.components) ? sbom.components : [];
	const workspacePaths = workspaces.map(workspace => workspace.path);
	const actualWorkspacePaths = [...new Set(components.flatMap(component => Array.isArray(component?.properties)
		? component.properties
			.filter(property => property?.name === 'virune:package-lock:path' && /^packages\/[^/]+$/u.test(property?.value ?? ''))
			.map(property => property.value)
		: []))].sort(compareText);
	if (JSON.stringify(actualWorkspacePaths) !== JSON.stringify(workspacePaths)) {
		throw new Error(`SBOM workspace component set must exactly match repository workspaces. expected=${JSON.stringify(workspacePaths)} actual=${JSON.stringify(actualWorkspacePaths)}`);
	}

	for (const workspace of workspaces) {
		const matches = components.filter(component => Array.isArray(component?.properties)
			&& component.properties.some(property => property?.name === 'virune:package-lock:path' && property?.value === workspace.path));
		if (matches.length !== 1) {
			throw new Error(`SBOM must contain exactly one component for ${workspace.path}; found ${matches.length}`);
		}
		const component = matches[0];
		if (component?.name !== workspace.name || component?.version !== workspace.version) {
			throw new Error(`SBOM ${workspace.path} component identity must match ${workspace.name}@${workspace.version}`);
		}
		const licenses = component?.licenses;
		if (!Array.isArray(licenses) || licenses.length !== 1 || licenses[0]?.license?.id !== expectedLicense) {
			throw new Error(`SBOM ${workspace.path} component license must be exactly ${expectedLicense}`);
		}
	}
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
		entries.set(fullName, {
			bytes: tar.subarray(dataStart, dataEnd),
			typeFlag: header[156],
		});
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	return entries;
}

function requireRegularFileEntry(entries, path, archive) {
	const value = entries.get(path);
	if (value === undefined) throw new Error(`${archive} is missing ${path}`);
	if (value.typeFlag !== 0 && value.typeFlag !== '0'.charCodeAt(0)) {
		throw new Error(`${archive} ${path} must be a regular file; tar typeflag=${JSON.stringify(String.fromCharCode(value.typeFlag))}`);
	}
	return value.bytes;
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

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) verifyReleaseLicenseArtifacts();