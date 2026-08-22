import { resolve } from 'node:path';
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

export function verifyNpmGeneratedProjectCapability({ root = process.cwd(), releaseDirectory = resolve(root, 'release') } = {}) {
	const publicationPlan = verifyNpmPublicationPlan(root);
	const file = registryReleaseAssetNameForPackage('virune', publicationPlan.currentVersion);
	const bytes = readRegularReleaseAsset(resolve(releaseDirectory, file), `$.registryCandidate.${file}`);
	return verifyNpmGeneratedProjectCapabilityTarball(bytes, publicationPlan, file);
}

export function verifyNpmGeneratedProjectCapabilityTarball(bytes, publicationPlan, file = undefined) {
	const expected = buildNpmGeneratedProjectCapability(publicationPlan);
	const releaseFile = file ?? registryReleaseAssetNameForPackage('virune', publicationPlan.currentVersion);
	const path = `$.registryCandidate.${releaseFile}.npmGeneratedProjectCapability`;
	const entries = readRegistryCandidateTarEntries(Buffer.from(bytes), `$.registryCandidate.${releaseFile}`);
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

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === resolve(new URL(import.meta.url).pathname)) {
	const result = verifyNpmGeneratedProjectCapability();
	process.stdout.write(`Verified npm generated-project capability for ${result.version ?? result.capability.version}.\n`);
}
