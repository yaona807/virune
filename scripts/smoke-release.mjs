import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const releaseDirectory = resolve('release');
const rootPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = rootPackage.version;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const expectedPackages = [
	`virune-runtime-${version}.tgz`,
	`virune-compiler-${version}.tgz`,
	`virune-formatter-${version}.tgz`,
	`virune-js-interop-${version}.tgz`,
	`virune-stdlib-${version}.tgz`,
	`virune-${version}.tgz`,
];
const internalPackageFiles = new Map([
	['@virune/runtime', `virune-runtime-${version}.tgz`],
	['@virune/compiler', `virune-compiler-${version}.tgz`],
	['@virune/formatter', `virune-formatter-${version}.tgz`],
	['@virune/js-interop', `virune-js-interop-${version}.tgz`],
	['@virune/stdlib', `virune-stdlib-${version}.tgz`],
]);

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
	const entries = new Map();
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
		const dataStart = offset + 512;
		entries.set(fullName, tar.subarray(dataStart, dataStart + size));
		offset = dataStart + Math.ceil(size / 512) * 512;
	}
	return entries;
};

const forbiddenEntries = [
	/constraint-registry/i,
	/(^|\/)protocol\.(?:js|d\.ts|js\.map)$/i,
];
for (const file of expectedPackages) {
	const entries = readTarEntries(bytesFor(file));
	const packageManifestBytes = entries.get('package/package.json');
	if (packageManifestBytes === undefined) throw new Error(`${file} does not contain package/package.json`);
	const packageManifest = JSON.parse(packageManifestBytes.toString('utf8'));
	if (packageManifest.private !== true) throw new Error(`${file} must be marked private to prevent npm publication.`);
	if ('publishConfig' in packageManifest) throw new Error(`${file} must not contain publishConfig.`);
	for (const entry of entries.keys()) {
		for (const forbidden of forbiddenEntries) {
			if (forbidden.test(entry)) throw new Error(`Stale removed ABI file found in ${file}: ${entry}`);
		}
	}
}

const cliFile = `virune-${version}.tgz`;
const cliEntries = readTarEntries(bytesFor(cliFile));
const cliManifestBytes = cliEntries.get('package/package.json');
if (cliManifestBytes === undefined) throw new Error(`${cliFile} does not contain package/package.json`);
const cliManifest = JSON.parse(cliManifestBytes.toString('utf8'));
if (cliManifest.private !== true) throw new Error(`${cliFile} must be marked private to prevent npm publication.`);
if ('publishConfig' in cliManifest) throw new Error(`${cliFile} must not contain publishConfig.`);
const expectedBundled = Object.keys(cliManifest.dependencies ?? {}).sort();
const actualBundled = [...(cliManifest.bundledDependencies ?? cliManifest.bundleDependencies ?? [])].sort();
if (JSON.stringify(actualBundled) !== JSON.stringify(expectedBundled)) {
	throw new Error(`${cliFile} must bundle every direct dependency.`);
}
for (const packageName of internalPackageFiles.keys()) {
	const packageManifestPath = `package/node_modules/${packageName}/package.json`;
	if (!cliEntries.has(packageManifestPath)) throw new Error(`${cliFile} is missing bundled package ${packageName}.`);
}

const smokeRoot = mkdtempSync(join(tmpdir(), 'virune-release-smoke-'));
try {
	const globalPrefix = resolve(smokeRoot, 'global');
	execFileSync(
		npmCommand,
		['install', '--global', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', globalPrefix, resolve(releaseDirectory, cliFile)],
		{ stdio: 'inherit' },
	);
	const globalPackageRoot = process.platform === 'win32'
		? resolve(globalPrefix, 'node_modules/virune')
		: resolve(globalPrefix, 'lib/node_modules/virune');
	const globalBin = process.platform === 'win32' ? resolve(globalPrefix, 'virune.cmd') : resolve(globalPrefix, 'bin/virune');
	if (!existsSync(globalBin)) throw new Error(`Global virune executable was not created: ${globalBin}`);
	const cliEntry = resolve(globalPackageRoot, 'dist/src/main.js');
	if (!existsSync(cliEntry)) throw new Error(`Installed CLI entry point is missing: ${cliEntry}`);
	const runCli = args => execFileSync(process.execPath, [cliEntry, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	const versionOutput = runCli(['--version']).trim();
	if (versionOutput !== `virune ${version}`) throw new Error(`Unexpected version output: ${versionOutput}`);

	const projectRoot = resolve(smokeRoot, 'project');
	runCli(['init', projectRoot]);
	const projectManifestPath = resolve(projectRoot, 'package.json');
	const projectManifest = JSON.parse(readFileSync(projectManifestPath, 'utf8'));
	projectManifest.dependencies['@virune/runtime'] = `file:${resolve(releaseDirectory, internalPackageFiles.get('@virune/runtime'))}`;
	projectManifest.dependencies['@virune/stdlib'] = `file:${resolve(releaseDirectory, internalPackageFiles.get('@virune/stdlib'))}`;
	projectManifest.devDependencies.virune = `file:${resolve(releaseDirectory, cliFile)}`;
	writeFileSync(projectManifestPath, `${JSON.stringify(projectManifest, null, 2)}\n`);
	execFileSync(
		npmCommand,
		['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
		{ cwd: projectRoot, stdio: 'inherit' },
	);
	if (!/Checked 1 module/u.test(runCli(['check', projectRoot]))) throw new Error('Installed release failed to check the generated project.');
	if (!/Built 1 module/u.test(runCli(['build', projectRoot]))) throw new Error('Installed release failed to build the generated project.');
	if (!/Hello from Virune/u.test(runCli(['run', projectRoot]))) throw new Error('Installed release failed to run the generated project.');
} finally {
	rmSync(smokeRoot, { recursive: true, force: true });
}

console.log(`Release smoke passed: ${manifest.files.length} files, ${expectedPackages.length} npm packages, offline clean install.`);
