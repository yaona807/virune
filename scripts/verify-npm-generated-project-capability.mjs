import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	bundledCliReleaseAssetName,
	isRegularTarEntry,
	readRegularReleaseAsset,
	readRegistryCandidateTarEntries,
	registryReleaseAssetNameForPackage,
} from './verify-npm-publication-identity.mjs';
import {
	NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH,
	buildNpmGeneratedProjectCapability,
	canonicalNpmGeneratedProjectCapabilityBytes,
	validateNpmGeneratedProjectCapability,
} from './npm-generated-project-capability.mjs';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';

const CLI_RUNTIME_ENTRIES = Object.freeze([
	'package/dist/src/main.js',
	'package/dist/src/main-core.js',
]);
const CAPABILITY_PORTABLE_PATH = portablePathKey(NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH);

export function verifyNpmGeneratedProjectCapability({ root = process.cwd(), releaseDirectory = resolve(root, 'release') } = {}) {
	const publicationPlan = verifyNpmPublicationPlan(root);
	const version = publicationPlan.currentVersion;
	const registryCliFile = registryReleaseAssetNameForPackage('virune', version);
	const prohibitedFiles = [
		bundledCliReleaseAssetName(version),
		...publicationPlan.publishPackages
			.filter(item => item.registryName !== 'virune')
			.map(item => registryReleaseAssetNameForPackage(item.registryName, version)),
	];
	const files = [registryCliFile, ...prohibitedFiles];
	const assets = Object.fromEntries(files.map(file => [
		file,
		readRegularReleaseAsset(resolve(releaseDirectory, file), `$.releaseArtifact.${file}`),
	]));
	return verifyNpmGeneratedProjectCapabilityReleaseSet({ publicationPlan, assets });
}

export function verifyNpmGeneratedProjectCapabilityReleaseSet({ publicationPlan, assets }) {
	const version = publicationPlan.currentVersion;
	const registryCliFile = registryReleaseAssetNameForPackage('virune', version);
	const prohibitedFiles = [
		bundledCliReleaseAssetName(version),
		...publicationPlan.publishPackages
			.filter(item => item.registryName !== 'virune')
			.map(item => registryReleaseAssetNameForPackage(item.registryName, version)),
	].sort(compareText);
	const expectedFiles = [registryCliFile, ...prohibitedFiles].sort(compareText);
	const actualFiles = Object.keys(record(assets, '$.assets')).sort(compareText);
	assert(JSON.stringify(actualFiles) === JSON.stringify(expectedFiles), '$.assets', `expected exact capability-audit artifact set ${expectedFiles.join(', ')}`);
	const result = verifyNpmGeneratedProjectCapabilityTarball(assets[registryCliFile], publicationPlan, registryCliFile);
	for (const file of prohibitedFiles) verifyCapabilityAbsentFromTarball(assets[file], file);
	return result;
}

export function verifyNpmGeneratedProjectCapabilityTarball(bytes, publicationPlan, file = undefined) {
	const expected = buildNpmGeneratedProjectCapability(publicationPlan);
	const releaseFile = file ?? registryReleaseAssetNameForPackage('virune', publicationPlan.currentVersion);
	const candidatePath = `$.registryCandidate.${releaseFile}`;
	const path = `${candidatePath}.npmGeneratedProjectCapability`;
	const entries = readRegistryCandidateTarEntries(Buffer.from(bytes), candidatePath);
	verifyCliRuntimeVersions(entries, publicationPlan.currentVersion, candidatePath);
	const matchingPaths = capabilityPortablePaths(entries);
	if (expected === null) {
		assert(matchingPaths.length === 0, path, 'capability must be absent unless the reviewed publication plan authorizes Registry-generated projects');
		return { present: false, version: publicationPlan.currentVersion };
	}
	assert(
		matchingPaths.length === 1 && matchingPaths[0] === NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH,
		path,
		`capability must use the one canonical portable path ${NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH}`,
	);
	const entry = entries.get(NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH);
	assert(entry !== undefined && isRegularTarEntry(entry), path, `${NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH} must be a regular file`);
	let parsed;
	try {
		parsed = JSON.parse(entry.bytes.toString('utf8'));
	} catch (error) {
		throw new Error(`${path}: malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	const capability = validateNpmGeneratedProjectCapability(parsed, publicationPlan.currentVersion);
	const canonical = canonicalNpmGeneratedProjectCapabilityBytes(capability, publicationPlan.currentVersion);
	assert(entry.bytes.equals(canonical), path, 'capability bytes must use canonical deterministic JSON encoding');
	assert(JSON.stringify(capability) === JSON.stringify(expected), path, 'capability does not match the reviewed publication plan');
	return { present: true, capability };
}

export function verifyCapabilityAbsentFromTarball(bytes, file) {
	const path = `$.releaseArtifact.${file}`;
	const entries = readRegistryCandidateTarEntries(Buffer.from(bytes), path);
	assert(
		capabilityPortablePaths(entries).length === 0,
		`${path}.npmGeneratedProjectCapability`,
		'capability is authorized only in the exact virune Registry candidate artifact',
	);
}

function capabilityPortablePaths(entries) {
	return [...entries.keys()].filter(path => portablePathKey(path) === CAPABILITY_PORTABLE_PATH);
}

function portablePathKey(value) {
	return value.normalize('NFC').toLowerCase();
}

function verifyCliRuntimeVersions(entries, version, path) {
	for (const entryPath of CLI_RUNTIME_ENTRIES) {
		const entry = entries.get(entryPath);
		assert(entry !== undefined && isRegularTarEntry(entry), `${path}.${entryPath}`, `${entryPath} must be a regular file`);
		const source = entry.bytes.toString('utf8');
		const matches = [...source.matchAll(/const VERSION = (['"])([^'"]+)\1;/gu)];
		assert(matches.length === 1, `${path}.${entryPath}`, `expected exactly one embedded VERSION declaration; found ${matches.length}`);
		assert(matches[0][2] === version, `${path}.${entryPath}`, `embedded VERSION ${matches[0][2]} does not match ${version}`);
	}
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const result = verifyNpmGeneratedProjectCapability();
	process.stdout.write(`Verified npm generated-project capability for ${result.version ?? result.capability.version}.\n`);
}
