import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const POLICY_PATH = '.github/release/npm-trusted-publishing-v1.json';
const EXPECTED_REPOSITORY = 'yaona807/virune';
const EXPECTED_WORKFLOW_FILE = 'release.yml';
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const POLICY_KEYS = Object.freeze([
	'schemaVersion',
	'status',
	'provider',
	'repository',
	'workflowFile',
	'runner',
	'registry',
	'minimumNodeVersion',
	'minimumNpmVersion',
	'requiredPermission',
	'forbiddenPublishCredentialEnv',
	'npmSideObservationRequired',
]);
const FORBIDDEN_ENV = Object.freeze(['NODE_AUTH_TOKEN', 'NPM_TOKEN']);

export async function verifyNpmTrustedPublishingWorkflow(root = repositoryRoot) {
	const policy = validateNpmTrustedPublishingPolicy(JSON.parse(await readFile(resolve(root, POLICY_PATH), 'utf8')));
	const workflowPath = resolve(root, '.github/workflows', policy.workflowFile);
	const source = await readFile(workflowPath, 'utf8');
	return validateNpmTrustedPublishingWorkflowSource(source, policy);
}

export function validateNpmTrustedPublishingPolicy(value) {
	const policy = record(value, '$.trustedPublishingPolicy');
	assertExactKeys(policy, POLICY_KEYS, '$.trustedPublishingPolicy');
	assert(policy.schemaVersion === 1, '$.trustedPublishingPolicy.schemaVersion', 'expected 1');
	assert(policy.status === 'repository-contract-only', '$.trustedPublishingPolicy.status', 'expected repository-contract-only until a separate npm-side observation is available');
	assert(policy.provider === 'github-actions', '$.trustedPublishingPolicy.provider', 'expected github-actions');
	assert(policy.repository === EXPECTED_REPOSITORY, '$.trustedPublishingPolicy.repository', `expected ${EXPECTED_REPOSITORY}`);
	assert(policy.workflowFile === EXPECTED_WORKFLOW_FILE, '$.trustedPublishingPolicy.workflowFile', `expected ${EXPECTED_WORKFLOW_FILE}`);
	const runner = nonEmptyString(policy.runner, '$.trustedPublishingPolicy.runner');
	assert(/^ubuntu-[0-9]{2}\.04$/u.test(runner), '$.trustedPublishingPolicy.runner', 'expected an explicit GitHub-hosted Ubuntu runner label');
	assert(policy.registry === PUBLIC_REGISTRY, '$.trustedPublishingPolicy.registry', `expected ${PUBLIC_REGISTRY}`);
	const minimumNodeVersion = strictSemver(policy.minimumNodeVersion, '$.trustedPublishingPolicy.minimumNodeVersion');
	const minimumNpmVersion = strictSemver(policy.minimumNpmVersion, '$.trustedPublishingPolicy.minimumNpmVersion');
	const requiredPermission = record(policy.requiredPermission, '$.trustedPublishingPolicy.requiredPermission');
	assertExactKeys(requiredPermission, ['id-token'], '$.trustedPublishingPolicy.requiredPermission');
	assert(requiredPermission['id-token'] === 'write', '$.trustedPublishingPolicy.requiredPermission.id-token', 'expected write');
	const forbiddenPublishCredentialEnv = stringArray(policy.forbiddenPublishCredentialEnv, '$.trustedPublishingPolicy.forbiddenPublishCredentialEnv');
	assertExactList(forbiddenPublishCredentialEnv, FORBIDDEN_ENV, '$.trustedPublishingPolicy.forbiddenPublishCredentialEnv');
	assert(policy.npmSideObservationRequired === true, '$.trustedPublishingPolicy.npmSideObservationRequired', 'npm-side live observation must remain required');
	return {
		schemaVersion: 1,
		status: policy.status,
		provider: policy.provider,
		repository: policy.repository,
		workflowFile: policy.workflowFile,
		runner,
		registry: policy.registry,
		minimumNodeVersion,
		minimumNpmVersion,
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
	assert(!runner.includes('self-hosted'), '$.workflow.jobs.release.runs-on', 'self-hosted runners are not supported by the npm Trusted Publishing contract');
	const nodeVersion = setupNodeVersion(releaseJob);
	assert(versionAtLeast(normalizeWorkflowVersion(nodeVersion), policy.minimumNodeVersion), '$.workflow.jobs.release.nodeVersion', `expected Node ${policy.minimumNodeVersion} or newer`);
	const commands = workflowRunCommands(releaseJob);
	const publishCommands = commands.filter(command => /(^|\n)\s*npm\s+(?:publish|stage\s+publish)(?:\s|$)/mu.test(command));
	assert(publishCommands.length === 0, '$.workflow.jobs.release.publish', 'repository-contract-only workflow must not contain npm publish or npm stage publish');
	for (const envName of policy.forbiddenPublishCredentialEnv) {
		assert(!hasEnvironmentBinding(lines, envName), `$.workflow.env.${envName}`, `${envName} must not be wired into the release workflow`);
	}
	const explicitNpmVersions = commands.flatMap(extractInstalledNpmVersions);
	assert(explicitNpmVersions.length <= 1, '$.workflow.jobs.release.npmVersion', 'expected at most one explicit npm CLI installation');
	if (explicitNpmVersions.length === 1) {
		assert(versionAtLeast(explicitNpmVersions[0], policy.minimumNpmVersion), '$.workflow.jobs.release.npmVersion', `expected npm ${policy.minimumNpmVersion} or newer`);
	}
	return {
		schemaVersion: 1,
		kind: 'npm-trusted-publishing-workflow-contract-v1',
		repository: policy.repository,
		workflowFile: policy.workflowFile,
		provider: policy.provider,
		runner,
		nodeVersion,
		explicitNpmVersion: explicitNpmVersions[0] ?? null,
		idTokenPermission: permissions['id-token'],
		publishCommandPresent: false,
		longLivedPublishCredentialWiringPresent: false,
		npmSideObservationRequired: true,
		publicationReady: false,
	};
}

export function versionAtLeast(actualValue, minimumValue) {
	const actual = strictSemver(actualValue, '$.actualVersion');
	const minimum = strictSemver(minimumValue, '$.minimumVersion');
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
	const prefix = ' '.repeat(indent);
	const expression = new RegExp(`^${prefix}${escapeRegExp(key)}:\\s*(.+?)\\s*$`, 'u');
	const values = lines.map(line => expression.exec(line)?.[1]).filter(value => value !== undefined);
	assert(values.length === 1, path, `expected exactly one ${key}`);
	return unquote(values[0]);
}

function setupNodeVersion(lines) {
	const setupIndexes = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (/^\s+- uses:\s*actions\/setup-node@[0-9a-f]{40}(?:\s+#.*)?$/u.test(lines[index])) setupIndexes.push(index);
	}
	assert(setupIndexes.length === 1, '$.workflow.jobs.release.setup-node', 'expected exactly one immutable actions/setup-node step');
	const start = setupIndexes[0];
	let nodeVersion;
	for (let index = start + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (/^\s+- (?:uses|name|run):/u.test(line)) break;
		const match = /^\s+node-version:\s*['"]?([^'"\s]+)['"]?\s*$/u.exec(line);
		if (match !== null) {
			assert(nodeVersion === undefined, '$.workflow.jobs.release.nodeVersion', 'duplicate node-version');
			nodeVersion = match[1];
		}
	}
	assert(nodeVersion !== undefined, '$.workflow.jobs.release.nodeVersion', 'actions/setup-node must pin node-version');
	return nodeVersion;
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
			const currentIndent = line.search(/\S/u);
			if (currentIndent <= indent) break;
			block.push(line.trimStart());
		}
		commands.push(block.join('\n'));
	}
	return commands;
}

function extractInstalledNpmVersions(command) {
	const versions = [];
	for (const line of command.split(/\r?\n/u)) {
		const match = /^\s*npm\s+install\s+(?:--global|-g)\s+npm@([0-9]+\.[0-9]+\.[0-9]+)\s*$/u.exec(line);
		if (match !== null) versions.push(strictSemver(match[1], '$.workflow.jobs.release.npmVersion'));
	}
	return versions;
}

function hasEnvironmentBinding(lines, name) {
	const expression = new RegExp(`^\\s+${escapeRegExp(name)}:\\s*`, 'u');
	return lines.some(line => expression.test(line));
}

function normalizeWorkflowVersion(value) {
	assert(typeof value === 'string' && /^[0-9]+(?:\.[0-9]+){0,2}$/u.test(value), '$.workflow.jobs.release.nodeVersion', 'expected a numeric Node version');
	const components = value.split('.');
	while (components.length < 3) components.push('0');
	return components.join('.');
}

function strictSemver(value, path) {
	assert(typeof value === 'string', path, 'expected a semantic version string');
	const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(value);
	assert(match !== null, path, 'expected exact major.minor.patch version');
	return match.slice(1).map(Number);
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
	process.stdout.write(`Verified npm Trusted Publishing repository contract for ${report.repository}/${report.workflowFile}; publication remains disabled pending npm-side observation.\n`);
}
