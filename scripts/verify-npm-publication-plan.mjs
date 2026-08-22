import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyNpmPublicationRecoveryPolicy } from './verify-npm-publication-recovery.mjs';

const PLAN_PATH = '.github/release/npm-publication-v1.json';
const REPOSITORY_URL = 'git+https://github.com/yaona807/virune.git';
const HOMEPAGE = 'https://github.com/yaona807/virune#readme';
const BUGS_URL = 'https://github.com/yaona807/virune/issues';
const CANONICAL_WORKSPACES = ['packages/*'];
const RETRO_PUBLISH_BOUNDARY = '1.0.0';
const FIRST_STABLE_REGISTRY_RELEASE = '1.1.0';
const REQUIRED_PREPUBLICATION_BLOCKERS = [
	'clean-registry-install-smoke',
	'documentation-sync',
	'generated-project-registry-smoke',
	'package-publication-enablement',
	'public-registry-verification',
	'publication-gate-integration',
	'registry-ownership',
	'release-identity-integration',
	'trusted-publishing',
];
const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const RUNTIME_DEPENDENCY_SECTIONS = new Set(['dependencies', 'peerDependencies', 'optionalDependencies']);

export function verifyNpmPublicationPlan(root = process.cwd()) {
	const plan = readJson(resolve(root, PLAN_PATH));
	const rootManifest = readJson(resolve(root, 'package.json'));
	assertExactKeys(plan, [
		'schemaVersion',
		'stage',
		'publicationReady',
		'unresolvedRequirements',
		'forbidRegistryPublishThroughVersion',
		'firstStableRegistryRelease',
		'distTagPolicy',
		'trustedPublishingRequired',
		'publicVerificationRequired',
		'sameReviewedReleaseIdentityRequired',
		'packages',
		'excludedWorkspacePackages',
	], '$');
	assert(plan.schemaVersion === 1, '$.schemaVersion', 'expected schemaVersion 1');
	assert(plan.stage === 'prepublication-audit', '$.stage', 'expected prepublication-audit stage');
	assert(plan.publicationReady === false, '$.publicationReady', 'prepublication audit must not claim publication readiness');
	const unresolvedRequirements = array(plan.unresolvedRequirements, '$.unresolvedRequirements')
		.map((value, index) => nonEmptyString(value, `$.unresolvedRequirements[${index}]`))
		.sort(compareText);
	assertUnique(unresolvedRequirements, '$.unresolvedRequirements', 'requirement');
	assert(
		JSON.stringify(unresolvedRequirements) === JSON.stringify(REQUIRED_PREPUBLICATION_BLOCKERS),
		'$.unresolvedRequirements',
		`expected unresolved prepublication requirements ${REQUIRED_PREPUBLICATION_BLOCKERS.join(', ')}`,
	);
	assert(plan.trustedPublishingRequired === true, '$.trustedPublishingRequired', 'must remain true');
	assert(plan.publicVerificationRequired === true, '$.publicVerificationRequired', 'must remain true');
	assert(plan.sameReviewedReleaseIdentityRequired === true, '$.sameReviewedReleaseIdentityRequired', 'must remain true');
	verifyNpmPublicationRecoveryPolicy(root);
	const forbiddenThroughText = nonEmptyString(plan.forbidRegistryPublishThroughVersion, '$.forbidRegistryPublishThroughVersion');
	const firstStableText = nonEmptyString(plan.firstStableRegistryRelease, '$.firstStableRegistryRelease');
	const forbiddenThrough = semver(forbiddenThroughText, '$.forbidRegistryPublishThroughVersion');
	const firstStable = semver(firstStableText, '$.firstStableRegistryRelease');
	assert(forbiddenThroughText === RETRO_PUBLISH_BOUNDARY, '$.forbidRegistryPublishThroughVersion', `expected ${RETRO_PUBLISH_BOUNDARY} retro-publish boundary`);
	assert(firstStableText === FIRST_STABLE_REGISTRY_RELEASE, '$.firstStableRegistryRelease', `expected first stable npm release ${FIRST_STABLE_REGISTRY_RELEASE}`);
	assert(compareSemver(firstStable, forbiddenThrough) > 0, '$.firstStableRegistryRelease', 'must be later than the forbidden retro-publish boundary');
	const distTagPolicy = record(plan.distTagPolicy, '$.distTagPolicy');
	assertExactKeys(distTagPolicy, ['stable', 'prerelease', 'nightly'], '$.distTagPolicy');
	const stableDistTag = npmDistTag(distTagPolicy.stable, '$.distTagPolicy.stable');
	const prereleaseDistTag = npmDistTag(distTagPolicy.prerelease, '$.distTagPolicy.prerelease');
	assert(stableDistTag === 'latest', '$.distTagPolicy.stable', 'stable npm releases must use the latest dist-tag');
	assert(prereleaseDistTag === 'next', '$.distTagPolicy.prerelease', 'prerelease npm releases must use the next dist-tag');
	assert(stableDistTag !== prereleaseDistTag, '$.distTagPolicy', 'stable and prerelease dist-tags must be distinct');
	assert(distTagPolicy.nightly === null, '$.distTagPolicy.nightly', 'nightly releases must not be published to npm in this policy');
	assert(rootManifest.private === true, '$root.private', 'monorepo root must remain private');
	assert(rootManifest.version === plan.forbidRegistryPublishThroughVersion, '$root.version', 'prepublication plan must be updated deliberately when the repository version advances');
	const rootWorkspaces = array(rootManifest.workspaces, '$root.workspaces')
		.map((value, index) => nonEmptyString(value, `$root.workspaces[${index}]`));
	assert(
		JSON.stringify(rootWorkspaces) === JSON.stringify(CANONICAL_WORKSPACES),
		'$root.workspaces',
		`expected canonical workspace layout ${CANONICAL_WORKSPACES.join(', ')}`,
	);
	const reviewedLicense = nonEmptyString(rootManifest.license, '$root.license');
	const reviewedNodeEngine = nonEmptyString(rootManifest.engines?.node, '$root.engines.node');

	const publishPackages = array(plan.packages, '$.packages')
		.map((value, index) => publicationPackage(value, `$.packages[${index}]`))
		.sort((left, right) => compareText(left.directory, right.directory));
	const excludedPackages = array(plan.excludedWorkspacePackages, '$.excludedWorkspacePackages')
		.map((value, index) => excludedPackage(value, `$.excludedWorkspacePackages[${index}]`))
		.sort((left, right) => compareText(left.directory, right.directory));
	assertUnique(publishPackages.map(item => item.directory), '$.packages', 'directory');
	assertUnique(publishPackages.map(item => item.workspaceName), '$.packages', 'workspaceName');
	assertUnique(publishPackages.map(item => item.registryName), '$.packages', 'registryName');
	assertUnique(excludedPackages.map(item => item.directory), '$.excludedWorkspacePackages', 'directory');
	assertUnique(excludedPackages.map(item => item.workspaceName), '$.excludedWorkspacePackages', 'workspaceName');

	const directoryOverlap = publishPackages.filter(item => excludedPackages.some(excluded => excluded.directory === item.directory));
	assert(directoryOverlap.length === 0, '$', `workspace cannot be both publishable and excluded: ${directoryOverlap.map(item => item.directory).join(', ')}`);
	const workspaceNameOverlap = publishPackages.filter(item => excludedPackages.some(excluded => excluded.workspaceName === item.workspaceName));
	assert(workspaceNameOverlap.length === 0, '$', `workspace package cannot be both publishable and excluded: ${workspaceNameOverlap.map(item => item.workspaceName).join(', ')}`);

	const declaredDirectories = new Set([...publishPackages, ...excludedPackages].map(item => item.directory));
	const workspaceDirectories = listWorkspacePackageDirectories(root);
	const undeclared = workspaceDirectories.filter(directory => !declaredDirectories.has(directory));
	const missing = [...declaredDirectories].filter(directory => !workspaceDirectories.includes(directory));
	assert(undeclared.length === 0, '$', `workspace package missing from publication plan: ${undeclared.join(', ')}`);
	assert(missing.length === 0, '$', `publication plan references missing workspace package: ${missing.join(', ')}`);

	const manifests = new Map();
	for (const item of [...publishPackages, ...excludedPackages]) {
		const manifest = readJson(resolve(root, 'packages', item.directory, 'package.json'));
		assert(manifest.name === item.workspaceName, `$.${item.directory}.name`, `expected workspace package name ${item.workspaceName}`);
		assert(manifest.version === rootManifest.version, `$.${item.directory}.version`, 'must match the reviewed root release version');
		assert(manifest.private === true, `$.${item.directory}.private`, 'prepublication audit requires private:true until the publication-enablement change');
		assert(manifest.license === reviewedLicense, `$.${item.directory}.license`, `must match reviewed root license ${reviewedLicense}`);
		manifests.set(item.workspaceName, manifest);
	}

	const workspaceNames = new Set(manifests.keys());
	const excludedWorkspaceNames = new Set(excludedPackages.map(item => item.workspaceName));
	for (const item of publishPackages) {
		const manifest = manifests.get(item.workspaceName);
		assert(item.registryName === item.workspaceName, `$.packages.${item.directory}.registryName`, 'registry package renaming is not modeled by the current release packaging path');
		assert(manifest.repository?.type === 'git', `$.${item.directory}.repository.type`, 'expected git repository metadata');
		assert(manifest.repository?.url === REPOSITORY_URL, `$.${item.directory}.repository.url`, 'unexpected repository URL');
		assert(manifest.repository?.directory === `packages/${item.directory}`, `$.${item.directory}.repository.directory`, 'unexpected repository directory');
		assert(manifest.homepage === HOMEPAGE, `$.${item.directory}.homepage`, 'unexpected homepage');
		assert(manifest.bugs?.url === BUGS_URL, `$.${item.directory}.bugs.url`, 'unexpected bugs URL');
		const files = array(manifest.files, `$.${item.directory}.files`)
			.map((value, index) => nonEmptyString(value, `$.${item.directory}.files[${index}]`));
		assert(files.length > 0, `$.${item.directory}.files`, 'files allowlist is required');
		assertUnique(files, `$.${item.directory}.files`, 'file');
		for (const requiredLicenseFile of ['LICENSE', 'NOTICE']) {
			assert(files.includes(requiredLicenseFile), `$.${item.directory}.files`, `required license file ${requiredLicenseFile} is missing`);
		}
		assert(hasPackageExports(manifest.exports), `$.${item.directory}.exports`, 'non-empty exports metadata is required');
		assert(manifest.engines?.node === reviewedNodeEngine, `$.${item.directory}.engines.node`, `must match reviewed root Node engine ${reviewedNodeEngine}`);
		assert(manifest.publishConfig === undefined, `$.${item.directory}.publishConfig`, 'publishConfig must be introduced only in the publication-enablement change');
		if (item.role === 'cli-dependency') {
			assert(manifest.bin === undefined, `$.${item.directory}.bin`, 'CLI dependency packages must not expose npm executables');
		}
		for (const section of DEPENDENCY_SECTIONS) {
			const rawDependencies = manifest[section];
			if (rawDependencies === undefined) continue;
			const dependencies = record(rawDependencies, `$.${item.directory}.${section}`);
			for (const [dependency, version] of Object.entries(dependencies)) {
				const isKnownWorkspace = workspaceNames.has(dependency);
				const claimsViruneNamespace = dependency === 'virune' || dependency.startsWith('@virune/');
				if (!isKnownWorkspace && !claimsViruneNamespace) continue;
				assert(isKnownWorkspace, `$.${item.directory}.${section}.${dependency}`, 'Virune dependency must refer to a workspace package declared by the publication plan');
				assert(version === rootManifest.version, `$.${item.directory}.${section}.${dependency}`, 'internal Virune dependencies must use the exact reviewed release version');
				if (RUNTIME_DEPENDENCY_SECTIONS.has(section)) {
					assert(!excludedWorkspaceNames.has(dependency), `$.${item.directory}.${section}.${dependency}`, 'publishable package cannot require an excluded workspace package at install/runtime');
				}
			}
		}
	}

	const cli = publishPackages.find(item => item.role === 'cli');
	assert(cli !== undefined, '$.packages', 'exactly one CLI publication package is required');
	assert(publishPackages.filter(item => item.role === 'cli').length === 1, '$.packages', 'exactly one CLI publication package is required');
	const cliManifest = manifests.get(cli.workspaceName);
	assert(cli.workspaceName === 'virune', '$.packages', 'canonical CLI workspace package must be virune');
	assert(cli.registryName === 'virune', '$.packages', 'canonical CLI registry name must be virune');
	assertExactKeys(cliManifest.bin, ['virune'], `$.${cli.directory}.bin`);
	assert(cliManifest.bin.virune === './dist/src/entry.js', `$.${cli.directory}.bin.virune`, 'canonical virune executable mapping is required');
	for (const item of publishPackages.filter(item => item.role === 'cli-dependency')) {
		assert(cliManifest.dependencies?.[item.workspaceName] === rootManifest.version, `$.${cli.directory}.dependencies.${item.workspaceName}`, 'CLI must depend on every planned npm package dependency at the exact release version');
	}

	return {
		schemaVersion: 1,
		stage: plan.stage,
		publicationReady: false,
		unresolvedRequirements,
		currentVersion: rootManifest.version,
		forbidRegistryPublishThroughVersion: forbiddenThroughText,
		firstStableRegistryRelease: firstStableText,
		distTagPolicy: {
			stable: stableDistTag,
			prerelease: prereleaseDistTag,
			nightly: null,
		},
		publishPackages: publishPackages.map(item => ({ workspaceName: item.workspaceName, registryName: item.registryName })),
		excludedWorkspacePackages: excludedPackages.map(item => item.workspaceName),
	};
}

function publicationPackage(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['directory', 'workspaceName', 'registryName', 'role'], path);
	return {
		directory: identifier(item.directory, `${path}.directory`),
		workspaceName: packageName(item.workspaceName, `${path}.workspaceName`),
		registryName: packageName(item.registryName, `${path}.registryName`),
		role: oneOf(item.role, ['cli', 'cli-dependency'], `${path}.role`),
	};
}

function excludedPackage(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['directory', 'workspaceName', 'reason'], path);
	return {
		directory: identifier(item.directory, `${path}.directory`),
		workspaceName: packageName(item.workspaceName, `${path}.workspaceName`),
		reason: nonEmptyString(item.reason, `${path}.reason`),
	};
}

function listWorkspacePackageDirectories(root) {
	return readdirSync(resolve(root, 'packages'), { withFileTypes: true })
		.filter(entry => entry.isDirectory() && existsSync(resolve(root, 'packages', entry.name, 'package.json')))
		.map(entry => entry.name)
		.sort(compareText);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function semver(value, path) {
	const text = nonEmptyString(value, path);
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(text);
	assert(match !== null, path, 'expected a stable x.y.z semantic version');
	return match.slice(1).map(Number);
}

function compareSemver(left, right) {
	for (let index = 0; index < 3; index += 1) {
		if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
	}
	return 0;
}

function npmDistTag(value, path) {
	const tag = nonEmptyString(value, path);
	assert(/^[a-z0-9][a-z0-9._-]*$/u.test(tag), path, 'invalid npm dist-tag');
	return tag;
}

function packageName(value, path) {
	const name = nonEmptyString(value, path);
	assert(/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(name), path, 'invalid npm package name');
	return name;
}

function identifier(value, path) {
	const text = nonEmptyString(value, path);
	assert(/^[a-z0-9][a-z0-9-]*$/u.test(text), path, 'invalid workspace directory');
	return text;
}

function oneOf(value, values, path) {
	assert(typeof value === 'string' && values.includes(value), path, `expected one of ${values.join(', ')}`);
	return value;
}

function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
	return value;
}

function array(value, path) {
	assert(Array.isArray(value), path, 'expected an array');
	return value;
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function hasPackageExports(value) {
	if (typeof value === 'string') return value.trim().length > 0;
	return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function assertExactKeys(value, expected, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	const actual = Object.keys(value).sort(compareText);
	const canonicalExpected = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(canonicalExpected), path, `expected keys ${canonicalExpected.join(', ')}`);
}

function assertUnique(values, path, name) {
	const sorted = [...values].sort(compareText);
	for (let index = 1; index < sorted.length; index += 1) {
		assert(sorted[index] !== sorted[index - 1], path, `duplicate ${name} ${sorted[index]}`);
	}
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

const argvPath = process.argv[1];
if (argvPath !== undefined && import.meta.url === pathToFileURL(resolve(argvPath)).href) {
	const result = verifyNpmPublicationPlan();
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
