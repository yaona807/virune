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
	assert(oneOf(plan.stage, ['prepublication-audit', 'publication-candidate'], `${path}.stage`) !== undefined, `${path}.stage`, 'invalid stage');
	assert(typeof plan.publicationReady === 'boolean', `${path}.publicationReady`, 'expected a boolean');

	const distTagPolicy = record(plan.distTagPolicy, `${path}.distTagPolicy`);
	assertExactKeys(distTagPolicy, DIST_TAG_POLICY_KEYS, `${path}.distTagPolicy`);

	const packages = array(plan.packages, `${path}.packages`).map((item, index) => {
		const packagePath = `${path}.packages[${index}]`;
		const packageValue = record(item, packagePath);
		assertExactKeys(packageValue, PACKAGE_KEYS, packagePath);
		const directory = identifier(packageValue.directory, `${packagePath}.directory`);
		const workspaceName = packageName(packageValue.workspaceName, `${packagePath}.workspaceName`);
		const registryName = packageName(packageValue.registryName, `${packagePath}.registryName`);
		const role = oneOf(packageValue.role, ['cli', 'cli-dependency'], `${packagePath}.role`);
		assert(registryName === workspaceName, `${packagePath}.registryName`, 'registry package name must match workspace package identity');
		return { directory, workspaceName, registryName, role };
	});
	assert(packages.length > 0, `${path}.packages`, 'at least one publication package is required');
	assertUnique(packages.map(item => item.directory), `${path}.packages`, 'directory');
	assertUnique(packages.map(item => item.workspaceName), `${path}.packages`, 'workspaceName');
	assertUnique(packages.map(item => item.registryName), `${path}.packages`, 'registryName');
	assert(packages.filter(item => item.role === 'cli').length === 1, `${path}.packages`, 'exactly one CLI publication package is required');
	const cli = packages.find(item => item.role === 'cli');
	assert(cli.workspaceName === 'virune' && cli.registryName === 'virune', `${path}.packages`, 'canonical CLI publication package must be virune');

	const excluded = array(plan.excludedWorkspacePackages, `${path}.excludedWorkspacePackages`).map((item, index) => {
		const excludedPath = `${path}.excludedWorkspacePackages[${index}]`;
		const excludedValue = record(item, excludedPath);
		assertExactKeys(excludedValue, EXCLUDED_PACKAGE_KEYS, excludedPath);
		return {
			directory: identifier(excludedValue.directory, `${excludedPath}.directory`),
			workspaceName: packageName(excludedValue.workspaceName, `${excludedPath}.workspaceName`),
			reason: nonEmptyString(excludedValue.reason, `${excludedPath}.reason`),
		};
	});
	assertUnique(excluded.map(item => item.directory), `${path}.excludedWorkspacePackages`, 'directory');
	assertUnique(excluded.map(item => item.workspaceName), `${path}.excludedWorkspacePackages`, 'workspaceName');
	const directoryOverlap = packages.filter(item => excluded.some(excludedItem => excludedItem.directory === item.directory));
	assert(directoryOverlap.length === 0, path, `workspace cannot be both publishable and excluded: ${directoryOverlap.map(item => item.directory).join(', ')}`);
	const nameOverlap = packages.filter(item => excluded.some(excludedItem => excludedItem.workspaceName === item.workspaceName));
	assert(nameOverlap.length === 0, path, `workspace package cannot be both publishable and excluded: ${nameOverlap.map(item => item.workspaceName).join(', ')}`);
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

function identifier(value, path) {
	const text = nonEmptyString(value, path);
	assert(/^[a-z0-9][a-z0-9-]*$/u.test(text), path, 'invalid workspace directory');
	return text;
}

function packageName(value, path) {
	const name = nonEmptyString(value, path);
	assert(/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(name), path, 'invalid npm package name');
	return name;
}

function oneOf(value, values, path) {
	assert(typeof value === 'string' && values.includes(value), path, `expected one of ${values.join(', ')}`);
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

function assertUnique(values, path, label) {
	assert(new Set(values).size === values.length, path, `duplicate ${label}`);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
