import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
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

export function verifyNpmGeneratedProjectCapability({ root = process.cwd(), releaseDirectory = resolve(root, 'release') } = {}) {
	const publicationPlan = verifyNpmPublicationPlan(root);
	const file = registryReleaseAssetNameForPackage('virune', publicationPlan.currentVersion);
	const bytes = readRegularReleaseAsset(resolve(releaseDirectory, file), `$.registryCandidate.${file}`);
	return verifyNpmGeneratedProjectCapabilityTarball(bytes, publicationPlan, file);
}

export function verifyNpmGeneratedProjectCapabilityTarball(bytes, publicationPlan, file = undefined) {
	const expected = buildNpmGeneratedProjectCapability(publicationPlan);
	const releaseFile = file ?? registryReleaseAssetNameForPackage('virune', publicationPlan.currentVersion);
	const candidatePath = `$.registryCandidate.${releaseFile}`;
	const path = `${candidatePath}.npmGeneratedProjectCapability`;
	const entries = readRegistryCandidateTarEntries(Buffer.from(bytes), candidatePath);
	verifyCliRuntimeVersions(entries, publicationPlan.currentVersion, candidatePath);
	const entry = entries.get(NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH);
	if (expected === null) {
		assert(entry === undefined, path, 'capability must be absent unless the reviewed publication plan authorizes Registry-generated projects');
		return { present: false, version: publicationPlan.currentVersion };
	}
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

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const result = verifyNpmGeneratedProjectCapability();
	process.stdout.write(`Verified npm generated-project capability for ${result.version ?? result.capability.version}.\n`);
}
