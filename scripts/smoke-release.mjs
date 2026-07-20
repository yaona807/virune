import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const releaseDirectory = resolve('release');
const rootPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = rootPackage.version;
const expectedPackages = [
	`virune-runtime-${version}.tgz`,
	`virune-compiler-${version}.tgz`,
	`virune-formatter-${version}.tgz`,
	`virune-js-interop-${version}.tgz`,
	`virune-stdlib-${version}.tgz`,
	`virune-${version}.tgz`,
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const bytesFor = file => readFileSync(resolve(releaseDirectory, file));

for (const file of expectedPackages) {
	if (!existsSync(resolve(releaseDirectory, file))) throw new Error(`Missing release package: ${file}`);
}

const manifestPath = resolve(releaseDirectory, 'RELEASE-MANIFEST.json');
if (!existsSync(manifestPath)) throw new Error('RELEASE-MANIFEST.json is missing.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.version !== version || !Array.isArray(manifest.files)) {
	throw new Error('Invalid release manifest header.');
}

const listed = new Set();
for (const entry of manifest.files) {
	if (!entry || typeof entry.file !== 'string' || typeof entry.sha256 !== 'string' || !Number.isInteger(entry.bytes)) {
		throw new Error('Invalid release manifest entry.');
	}
	if (listed.has(entry.file)) throw new Error(`Duplicate manifest entry: ${entry.file}`);
	listed.add(entry.file);
	const path = resolve(releaseDirectory, entry.file);
	if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Manifest file is missing: ${entry.file}`);
	const bytes = readFileSync(path);
	if (bytes.byteLength !== entry.bytes) throw new Error(`Size mismatch for ${entry.file}`);
	if (sha256(bytes) !== entry.sha256) throw new Error(`SHA-256 mismatch for ${entry.file}`);
}

const actualManifestFiles = readdirSync(releaseDirectory)
	.filter(file => file !== 'RELEASE-MANIFEST.json' && file !== 'SHA256SUMS')
	.sort();
for (const file of actualManifestFiles) {
	if (!listed.has(file)) throw new Error(`Unlisted release file: ${file}`);
}

const checksumPath = resolve(releaseDirectory, 'SHA256SUMS');
if (!existsSync(checksumPath)) throw new Error('SHA256SUMS is missing.');
const checksumLines = readFileSync(checksumPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
const checksumEntries = new Map();
for (const line of checksumLines) {
	const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
	if (!match) throw new Error(`Invalid SHA256SUMS line: ${line}`);
	if (checksumEntries.has(match[2])) throw new Error(`Duplicate SHA256SUMS entry: ${match[2]}`);
	checksumEntries.set(match[2], match[1]);
}
for (const file of readdirSync(releaseDirectory).filter(file => file !== 'SHA256SUMS').sort()) {
	const expected = checksumEntries.get(file);
	if (!expected) throw new Error(`SHA256SUMS is missing ${file}`);
	if (sha256(bytesFor(file)) !== expected) throw new Error(`SHA256SUMS mismatch for ${file}`);
}

const vscodeManifestPath = resolve(releaseDirectory, 'VSCODE-MANIFEST.json');
if (existsSync(vscodeManifestPath)) {
	const vscodeManifest = JSON.parse(readFileSync(vscodeManifestPath, 'utf8'));
	if (vscodeManifest.schemaVersion !== 1 || vscodeManifest.version !== manifest.version || typeof vscodeManifest.file !== 'string') {
		throw new Error('Invalid VSCODE-MANIFEST.json.');
	}
	const vscodePath = resolve(releaseDirectory, vscodeManifest.file);
	if (!existsSync(vscodePath) || !statSync(vscodePath).isFile()) throw new Error(`VSIX is missing: ${vscodeManifest.file}`);
	const vscodeBytes = readFileSync(vscodePath);
	if (vscodeBytes.byteLength !== vscodeManifest.bytes || sha256(vscodeBytes) !== vscodeManifest.sha256) {
		throw new Error(`VSIX integrity mismatch: ${vscodeManifest.file}`);
	}
}

const readTarEntries = tgzBytes => {
	const tar = gunzipSync(tgzBytes);
	const names = [];
	let offset = 0;
	while (offset + 512 <= tar.byteLength) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every(byte => byte === 0)) break;
		const stringField = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
		const name = stringField(0, 100);
		const prefix = stringField(345, 155);
		const fullName = prefix ? `${prefix}/${name}` : name;
		const sizeText = stringField(124, 12).trim();
		const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
		if (!Number.isFinite(size) || size < 0) throw new Error(`Invalid tar size in ${fullName}`);
		names.push(fullName);
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return names;
};

const forbiddenEntries = [
	/constraint-registry/i,
	/(^|\/)protocol\.(?:js|d\.ts|js\.map)$/i,
];
for (const file of expectedPackages) {
	const entries = readTarEntries(bytesFor(file));
	for (const entry of entries) {
		for (const forbidden of forbiddenEntries) {
			if (forbidden.test(entry)) throw new Error(`Stale removed ABI file found in ${file}: ${entry}`);
		}
	}
}

console.log(`Release smoke passed: ${manifest.files.length} files, ${expectedPackages.length} npm packages.`);
