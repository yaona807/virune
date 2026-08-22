import { parseReleaseVersion, registryPolicyForVersion } from './npm-publication-version-policy.mjs';

export const NPM_GENERATED_PROJECT_CAPABILITY_RELATIVE_PATH = 'dist/src/npm-generated-project-capability.json';
export const NPM_GENERATED_PROJECT_CAPABILITY_TAR_PATH = `package/${NPM_GENERATED_PROJECT_CAPABILITY_RELATIVE_PATH}`;
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';
export const NPM_GENERATED_PROJECT_CAPABILITY_KIND = 'npm-generated-project-dependency-source-v1';

export function buildNpmGeneratedProjectCapability(publicationPlan) {
	const plan = record(publicationPlan, '$.publicationPlan');
	const stage = oneOf(plan.stage, ['prepublication-audit', 'publication-candidate'], '$.publicationPlan.stage');
	assert(typeof plan.publicationReady === 'boolean', '$.publicationPlan.publicationReady', 'expected a boolean');
	if (stage === 'prepublication-audit') {
		assert(plan.publicationReady === false, '$.publicationPlan.publicationReady', 'prepublication audit must not claim publication readiness');
	} else {
		assert(plan.publicationReady === true, '$.publicationPlan.publicationReady', 'publication-candidate requires publicationReady:true');
	}
	const version = parseReleaseVersion(plan.currentVersion, '$.publicationPlan.currentVersion').text;
	const firstStableRegistryRelease = nonEmptyString(plan.firstStableRegistryRelease, '$.publicationPlan.firstStableRegistryRelease');
	const distTagPolicy = record(plan.distTagPolicy, '$.publicationPlan.distTagPolicy');
	const versionPolicy = registryPolicyForVersion(version, firstStableRegistryRelease, distTagPolicy);
	if (stage !== 'publication-candidate') return null;
	assert(versionPolicy.registryVersionEligible === true, '$.publicationPlan.currentVersion', 'publication-candidate must be Registry-eligible');
	return {
		schemaVersion: 1,
		kind: NPM_GENERATED_PROJECT_CAPABILITY_KIND,
		version,
		registry: PUBLIC_NPM_REGISTRY,
		dependencySource: 'npm',
	};
}

export function validateNpmGeneratedProjectCapability(value, expectedVersion) {
	const version = parseReleaseVersion(expectedVersion, '$.expectedVersion').text;
	const capability = record(value, '$.npmGeneratedProjectCapability');
	assertExactKeys(capability, ['schemaVersion', 'kind', 'version', 'registry', 'dependencySource'], '$.npmGeneratedProjectCapability');
	assert(capability.schemaVersion === 1, '$.npmGeneratedProjectCapability.schemaVersion', 'expected 1');
	assert(capability.kind === NPM_GENERATED_PROJECT_CAPABILITY_KIND, '$.npmGeneratedProjectCapability.kind', `expected ${NPM_GENERATED_PROJECT_CAPABILITY_KIND}`);
	assert(capability.version === version, '$.npmGeneratedProjectCapability.version', `expected ${version}`);
	assert(capability.registry === PUBLIC_NPM_REGISTRY, '$.npmGeneratedProjectCapability.registry', `expected ${PUBLIC_NPM_REGISTRY}`);
	assert(capability.dependencySource === 'npm', '$.npmGeneratedProjectCapability.dependencySource', 'expected npm');
	return {
		schemaVersion: 1,
		kind: NPM_GENERATED_PROJECT_CAPABILITY_KIND,
		version,
		registry: PUBLIC_NPM_REGISTRY,
		dependencySource: 'npm',
	};
}

export function canonicalNpmGeneratedProjectCapabilityBytes(value, expectedVersion = value?.version) {
	const capability = validateNpmGeneratedProjectCapability(value, expectedVersion);
	return Buffer.from(`${JSON.stringify(capability, null, '\t')}\n`, 'utf8');
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function oneOf(value, allowed, path) {
	assert(typeof value === 'string' && allowed.includes(value), path, `expected one of ${allowed.join(', ')}`);
	return value;
}

function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
	return value;
}

function assertExactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(wanted), path, `expected exact keys ${wanted.join(', ')}`);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
