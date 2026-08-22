import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const POLICY_PATH = '.github/release/npm-trusted-publishing-v1.json';
const EXPECTED_REPOSITORY = 'yaona807/virune';
const EXPECTED_WORKFLOW_FILE = 'release.yml';
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const FORBIDDEN_ENV = Object.freeze(['NODE_AUTH_TOKEN', 'NPM_TOKEN']);
const POLICY_KEYS = Object.freeze([
	'schemaVersion', 'status', 'provider', 'repository', 'workflowFile', 'runner', 'registry',
	'minimumNodeVersion', 'minimumNpmVersion', 'allowedPublishAction', 'requiredPermission',
	'forbiddenPublishCredentialEnv', 'npmSideObservationRequired',
]);

export async function verifyNpmTrustedPublishingWorkflow(root = repositoryRoot) {
	const policy = validateNpmTrustedPublishingPolicy(JSON.parse(await readFile(resolve(root, POLICY_PATH), 'utf8')));
	const source = await readFile(resolve(root, '.github/workflows', policy.workflowFile), 'utf8');
	return validateNpmTrustedPublishingWorkflowSource(source, policy);
}

export function validateNpmTrustedPublishingPolicy(value) {
	const policy = record(value, '$.trustedPublishingPolicy');
	assertExactKeys(policy, POLICY_KEYS, '$.trustedPublishingPolicy');
	assert(policy.schemaVersion === 1, '$.trustedPublishingPolicy.schemaVersion', 'expected 1');
	const status = oneOf(policy.status, ['repository-contract-only', 'publication-workflow'], '$.trustedPublishingPolicy.status');
	assert(policy.provider === 'github-actions', '$.trustedPublishingPolicy.provider', 'expected github-actions');
	assert(policy.repository === EXPECTED_REPOSITORY, '$.trustedPublishingPolicy.repository', `expected ${EXPECTED_REPOSITORY}`);
	assert(policy.workflowFile === EXPECTED_WORKFLOW_FILE, '$.trustedPublishingPolicy.workflowFile', `expected ${EXPECTED_WORKFLOW_FILE}`);
	const runner = nonEmptyString(policy.runner, '$.trustedPublishingPolicy.runner');
	assert(/^ubuntu-[0-9]{2}\.04$/u.test(runner), '$.trustedPublishingPolicy.runner', 'expected an explicit GitHub-hosted Ubuntu runner label');
	assert(policy.registry === PUBLIC_REGISTRY, '$.trustedPublishingPolicy.registry', `expected ${PUBLIC_REGISTRY}`);
	const minimumNodeVersion = semverText(policy.minimumNodeVersion, '$.trustedPublishingPolicy.minimumNodeVersion');
	const minimumNpmVersion = semverText(policy.minimumNpmVersion, '$.trustedPublishingPolicy.minimumNpmVersion');
	assert(policy.allowedPublishAction === 'publish', '$.trustedPublishingPolicy.allowedPublishAction', 'expected publish');
	const requiredPermission = record(policy.requiredPermission, '$.trustedPublishingPolicy.requiredPermission');
	assertExactKeys(requiredPermission, ['id-token'], '$.trustedPublishingPolicy.requiredPermission');
	assert(requiredPermission['id-token'] === 'write', '$.trustedPublishingPolicy.requiredPermission.id-token', 'expected write');
	const forbiddenPublishCredentialEnv = stringArray(policy.forbiddenPublishCredentialEnv, '$.trustedPublishingPolicy.forbiddenPublishCredentialEnv');
	assertExactList(forbiddenPublishCredentialEnv, FORBIDDEN_ENV, '$.trustedPublishingPolicy.forbiddenPublishCredentialEnv');
	assert(policy.npmSideObservationRequired === true, '$.trustedPublishingPolicy.npmSideObservationRequired', 'npm-side live observation must remain required');
	return {
		schemaVersion: 1,
		status,
		provider: 'github-actions',
		repository: EXPECTED_REPOSITORY,
		workflowFile: EXPECTED_WORKFLOW_FILE,
		runner,
		registry: PUBLIC_REGISTRY,
		minimumNodeVersion,
		minimumNpmVersion,
		allowedPublishAction: 'publish',
		requiredPermission: { 'id-token': 'write' },
		forbiddenPublishCredentialEnv: [...FORBIDDEN_ENV],
		npmSideObservationRequired: true,
	};
}

export function validateNpmTrustedPublishingWorkflowSource(source, policyValue) {
	assert(typeof source === 'string' && source.length > 0, '$.workflow', 'expected workflow source');
	assert(!source.includes('\t'), '$.workflow', 'tabs are not allowed');
	assert(source.endsWith('\n'), '$.workflow', 'workflow must end with a newline');
	const policy = validateNpmTrustedPublishingPolicy(policyValue);
	const lines = source.split(/\r?\n/u);
	const permissions = parseTopLevelPermissions(lines);
	assert(permissions['id-token'] === 'write', '$.workflow.permissions.id-token', 'Trusted Publishing contract requires id-token: write');
	const releaseJob = extractJob(lines, 'release');
	const runner = oneLineValue(releaseJob, 4, 'runs-on', '$.workflow.jobs.release.runs-on');
	assert(runner === policy.runner, '$.workflow.jobs.release.runs-on', `expected ${policy.runner}`);
	assert(!runner.includes('self-hosted'), '$.workflow.jobs.release.runs-on', 'self-hosted runners are not supported');
	const setupNode = setupNodeSettings(releaseJob);
	assert(versionAtLeast(normalizeWorkflowVersion(setupNode.nodeVersion), policy.minimumNodeVersion), '$.workflow.jobs.release.nodeVersion', `expected Node ${policy.minimumNodeVersion} or newer`);
	for (const envName of policy.forbiddenPublishCredentialEnv) {
		assert(!hasEnvironmentBinding(releaseJob, envName), `$.workflow.jobs.release.env.${envName}`, `${envName} must not be wired into the release workflow`);
	}
	assert(!hasUnapprovedSecretWiring(releaseJob), '$.workflow.jobs.release.secrets', 'only the GitHub token may be wired from GitHub secrets/context in this release job');
	assert(!hasExplicitAuthTokenConfiguration(releaseJob), '$.workflow.jobs.release.authentication', 'long-lived npm auth-token configuration is not permitted');
	assert(!hasDisabledProvenance(releaseJob), '$.workflow.jobs.release.provenance', 'npm provenance must not be explicitly disabled');

	const commands = workflowRunCommands(releaseJob);
	const explicitNpmVersions = commands.flatMap(extractInstalledNpmVersions);
	assert(explicitNpmVersions.length <= 1, '$.workflow.jobs.release.npmVersion', 'expected at most one explicit npm CLI installation');
	if (explicitNpmVersions.length === 1) {
		assert(versionAtLeast(explicitNpmVersions[0], policy.minimumNpmVersion), '$.workflow.jobs.release.npmVersion', `expected npm ${policy.minimumNpmVersion} or newer`);
	}
	const publicationInvocations = commands.flatMap(classifyPublicationInvocations);
	const active = policy.status === 'publication-workflow';
	if (!active) {
		assert(publicationInvocations.length === 0, '$.workflow.jobs.release.publish', 'repository-contract-only workflow must not contain npm publication commands');
	} else {
		assert(setupNode.registryUrl === policy.registry, '$.workflow.jobs.release.registry', `publication workflow must use ${policy.registry}`);
		assert(explicitNpmVersions.length === 1, '$.workflow.jobs.release.npmVersion', 'publication workflow must pin one exact npm CLI version');
		assert(publicationInvocations.length === 1, '$.workflow.jobs.release.publish', 'publication workflow must contain exactly one npm publication command');
		const publication = publicationInvocations[0];
		assert(publication.canonical === true, '$.workflow.jobs.release.publish', 'publication must use a direct canonical npm command');
		assert(publication.action === policy.allowedPublishAction, '$.workflow.jobs.release.publish', `expected allowed action ${policy.allowedPublishAction}`);
	}

	return {
		schemaVersion: 1,
		kind: 'npm-trusted-publishing-workflow-contract-v1',
		status: policy.status,
		repository: policy.repository,
		workflowFile: policy.workflowFile,
		provider: policy.provider,
		runner,
		nodeVersion: setupNode.nodeVersion,
		registryUrl: setupNode.registryUrl,
		explicitNpmVersion: explicitNpmVersions[0] ?? null,
		idTokenPermission: permissions['id-token'],
		publishAction: active ? publicationInvocations[0].action : null,
		workflowPublicationBoundaryPresent: active,
		longLivedPublishCredentialWiringPresent: false,
		npmSideObservationRequired: true,
		publicationReady: false,
	};
}

export function versionAtLeast(actualValue, minimumValue) {
	const actual = semverComponents(actualValue, '$.actualVersion');
	const minimum = semverComponents(minimumValue, '$.minimumVersion');
	for (let index = 0; index < 3; index += 1) {
		if (actual[index] > minimum[index]) return true;
		if (actual[index] < minimum[index]) return false;
	}
	return true;
}

function parseTopLevelPermissions(lines) {
	const index = lines.findIndex(line => line === 'permissions:');
	assert(index !== -1, '$.workflow.permissions', 'missing top-level permissions block');
	const permissions = {};
	for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
		const line = lines[cursor];
		if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue;
		if (!line.startsWith(' ')) break;
		const match = /^  ([a-z][a-z0-9-]*):\s*(read|write|none)\s*$/u.exec(line);
		assert(match !== null, '$.workflow.permissions', `unsupported permission syntax at line ${cursor + 1}`);
		assert(permissions[match[1]] === undefined, '$.workflow.permissions', `duplicate permission ${match[1]}`);
		permissions[match[1]] = match[2];
	}
	return permissions;
}

function extractJob(lines, name) {
	const jobsIndex = lines.findIndex(line => line === 'jobs:');
	assert(jobsIndex !== -1, '$.workflow.jobs', 'missing jobs block');
	const start = lines.findIndex((line, index) => index > jobsIndex && line === `  ${name}:`);
	assert(start !== -1, `$.workflow.jobs.${name}`, `missing ${name} job`);
	const block = [];
	for (let cursor = start + 1; cursor < lines.length; cursor += 1) {
		const line = lines[cursor];
		if (/^  [^\s].*:\s*$/u.test(line)) break;
		block.push(line);
	}
	assert(block.length > 0, `$.workflow.jobs.${name}`, 'job block must not be empty');
	return block;
}

function oneLineValue(lines, indent, key, path) {
	const expression = new RegExp(`^${' '.repeat(indent)}${escapeRegExp(key)}:\\s*(.+?)\\s*$`, 'u');
	const values = lines.map(line => expression.exec(line)?.[1]).filter(value => value !== undefined);
	assert(values.length === 1, path, `expected exactly one ${key}`);
	return unquote(values[0]);
}

function setupNodeSettings(lines) {
	const indexes = lines.map((line, index) => (/^\s+- uses:\s*actions\/setup-node@[0-9a-f]{40}(?:\s+#.*)?$/u.test(line) ? index : -1)).filter(index => index >= 0);
	assert(indexes.length === 1, '$.workflow.jobs.release.setup-node', 'expected exactly one immutable actions/setup-node step');
	let nodeVersion;
	let registryUrl = null;
	for (let index = indexes[0] + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (/^\s+- (?:uses|name|run):/u.test(line)) break;
		const nodeMatch = /^\s+node-version:\s*['"]?([^'"\s]+)['"]?\s*$/u.exec(line);
		if (nodeMatch !== null) {
			assert(nodeVersion === undefined, '$.workflow.jobs.release.nodeVersion', 'duplicate node-version');
			nodeVersion = nodeMatch[1];
		}
		const registryMatch = /^\s+registry-url:\s*['"]?([^'"\s]+)['"]?\s*$/u.exec(line);
		if (registryMatch !== null) {
			assert(registryUrl === null, '$.workflow.jobs.release.registry', 'duplicate registry-url');
			registryUrl = registryMatch[1];
		}
	}
	assert(nodeVersion !== undefined, '$.workflow.jobs.release.nodeVersion', 'actions/setup-node must pin node-version');
	return { nodeVersion, registryUrl };
}

function workflowRunCommands(lines) {
	const commands = [];
	for (let index = 0; index < lines.length; index += 1) {
		const inline = /^\s+run:\s*(.*?)\s*$/u.exec(lines[index]);
		if (inline === null) continue;
		if (inline[1] !== '|') {
			commands.push(unquote(inline[1]));
			continue;
		}
		const indent = lines[index].search(/\S/u);
		const block = [];
		for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
			const line = lines[cursor];
			if (line.trim().length === 0) {
				block.push('');
				continue;
			}
			if (line.search(/\S/u) <= indent) break;
			block.push(line.trimStart());
		}
		commands.push(block.join('\n'));
	}
	return commands;
}

function classifyPublicationInvocations(command) {
	const results = [];
	for (const rawLine of command.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!/\bnpm\b/u.test(line) || !/\bpublish\b/u.test(line)) continue;
		if (/^npm\s+publish(?:\s|$)/u.test(line)) results.push({ action: 'publish', canonical: true });
		else if (/^npm\s+stage\s+publish(?:\s|$)/u.test(line)) results.push({ action: 'stage-publish', canonical: true });
		else results.push({ action: 'unsupported', canonical: false });
	}
	return results;
}

function extractInstalledNpmVersions(command) {
	const versions = [];
	for (const line of command.split(/\r?\n/u)) {
		const match = /^\s*npm\s+install\s+(?:--global|-g)\s+npm@([0-9]+\.[0-9]+\.[0-9]+)\s*$/u.exec(line);
		if (match !== null) versions.push(semverText(match[1], '$.workflow.jobs.release.npmVersion'));
	}
	return versions;
}

function hasEnvironmentBinding(lines, name) {
	const expression = new RegExp(`^\\s+${escapeRegExp(name)}:\\s*`, 'u');
	return lines.some(line => expression.test(line));
}

function hasUnapprovedSecretWiring(lines) {
	return lines.some(line => {
		if (!line.includes('${{ secrets.')) return false;
		return !/^\s+(?:GITHUB_TOKEN|GH_TOKEN):\s*\$\{\{\s*(?:secrets\.GITHUB_TOKEN|github\.token)\s*\}\}\s*$/u.test(line);
	});
}

function hasExplicitAuthTokenConfiguration(lines) {
	return workflowRunCommands(lines).some(command => /(?:_authToken|npm\s+config\s+set\s+[^\n]*auth)/iu.test(command));
}

function hasDisabledProvenance(lines) {
	return lines.some(line => /^\s+NPM_CONFIG_PROVENANCE:\s*['"]?false['"]?\s*$/u.test(line))
		|| workflowRunCommands(lines).some(command => /(?:^|\s)--provenance=false(?:\s|$)/u.test(command));
}

function normalizeWorkflowVersion(value) {
	assert(typeof value === 'string' && /^[0-9]+(?:\.[0-9]+){0,2}$/u.test(value), '$.workflow.jobs.release.nodeVersion', 'expected a numeric Node version');
	const components = value.split('.');
	while (components.length < 3) components.push('0');
	return components.join('.');
}

function semverText(value, path) {
	semverComponents(value, path);
	return value;
}

function semverComponents(value, path) {
	assert(typeof value === 'string', path, 'expected a semantic version string');
	const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(value);
	assert(match !== null, path, 'expected exact major.minor.patch version');
	return match.slice(1).map(Number);
}

function oneOf(value, allowed, path) {
	assert(typeof value === 'string' && allowed.includes(value), path, `expected one of ${allowed.join(', ')}`);
	return value;
}

function stringArray(value, path) {
	assert(Array.isArray(value) && value.length > 0, path, 'expected a non-empty array');
	return value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
}

function assertExactList(actual, expected, path) {
	assert(actual.length === expected.length, path, `expected exact list ${expected.join(', ')}`);
	for (let index = 0; index < expected.length; index += 1) assert(actual[index] === expected[index], `${path}[${index}]`, `expected ${expected[index]}`);
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty string');
	return value;
}

function assertExactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(wanted), path, `expected exact keys ${wanted.join(', ')}`);
}

function unquote(value) {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return value.slice(1, -1);
	return value;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const report = await verifyNpmTrustedPublishingWorkflow();
	process.stdout.write(`Verified npm Trusted Publishing repository contract for ${report.repository}/${report.workflowFile}; publication authority remains disabled pending npm-side observation.\n`);
}
