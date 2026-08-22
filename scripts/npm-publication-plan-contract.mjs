export const NPM_PUBLICATION_PLAN_KEYS = Object.freeze([
	'schemaVersion',
	'stage',
	'publicationReady',
	'unresolvedRequirements',
	'authorization',
	'forbidRegistryPublishThroughVersion',
	'firstStableRegistryRelease',
	'distTagPolicy',
	'trustedPublishingRequired',
	'publicVerificationRequired',
	'sameReviewedReleaseIdentityRequired',
	'packages',
	'excludedWorkspacePackages',
]);

const DIST_TAG_POLICY_KEYS = Object.freeze(['stable', 'prerelease', 'nightly']);
const PACKAGE_KEYS = Object.freeze(['directory', 'workspaceName', 'registryName', 'role']);
const EXCLUDED_PACKAGE_KEYS = Object.freeze(['directory', 'workspaceName', 'reason']);

export function validateNpmPublicationPlanShape(value, path = '$') {
	const plan = record(value, path);
	assertExactKeys(plan, NPM_PUBLICATION_PLAN_KEYS, path);
	assert(plan.schemaVersion === 1, `${path}.schemaVersion`, 'expected schemaVersion 1');

	const distTagPolicy = record(plan.distTagPolicy, `${path}.distTagPolicy`);
	assertExactKeys(distTagPolicy, DIST_TAG_POLICY_KEYS, `${path}.distTagPolicy`);

	const packages = array(plan.packages, `${path}.packages`);
	for (let index = 0; index < packages.length; index += 1) {
		assertExactKeys(record(packages[index], `${path}.packages[${index}]`), PACKAGE_KEYS, `${path}.packages[${index}]`);
	}

	const excluded = array(plan.excludedWorkspacePackages, `${path}.excludedWorkspacePackages`);
	for (let index = 0; index < excluded.length; index += 1) {
		assertExactKeys(
			record(excluded[index], `${path}.excludedWorkspacePackages[${index}]`),
			EXCLUDED_PACKAGE_KEYS,
			`${path}.excludedWorkspacePackages[${index}]`,
		);
	}
	return plan;
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function array(value, path) {
	assert(Array.isArray(value), path, 'expected an array');
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
