import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnNpmSync } from './npm-cli.mjs';
import { readRegularReleaseAsset, verifyNpmPublicationIdentity } from './verify-npm-publication-identity.mjs';
import { verifyRegistryPackage } from './verify-public-npm-registry.mjs';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const EXPECTED_REPOSITORY = 'yaona807/virune';
const EXPECTED_REPOSITORY_URL = 'https://github.com/yaona807/virune';
const EXPECTED_WORKFLOW = '.github/workflows/release.yml';
const MINIMUM_NODE = [22, 14, 0];
const MINIMUM_NPM = [11, 12, 0];
const SLSA_V1 = 'https://slsa.dev/provenance/v1';
const INTOTO_V1 = 'https://in-toto.io/Statement/v1';
const GITHUB_BUILD_TYPE = 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1';
const GITHUB_BUILDER = 'https://github.com/actions/runner/github-hosted';

export const NPM_PUBLICATION_ORDER = [
	'@virune/runtime',
	'@virune/compiler',
	'@virune/formatter',
	'@virune/js-interop',
	'@virune/stdlib',
	'virune',
];

export const NPM_INTERNAL_DEPENDENCIES = {
	'@virune/runtime': [],
	'@virune/compiler': ['@virune/runtime'],
	'@virune/formatter': ['@virune/compiler'],
	'@virune/js-interop': ['@virune/compiler'],
	'@virune/stdlib': ['@virune/runtime'],
	virune: ['@virune/runtime', '@virune/compiler', '@virune/formatter', '@virune/js-interop', '@virune/stdlib'],
};

export async function publishNpmRelease({
	root = process.cwd(),
	releaseDirectory = resolve(root, 'release'),
	expectedCommit = process.env.GITHUB_SHA,
	fetchImpl = fetch,
	runNpm = runNpmCommand,
	env = process.env,
} = {}) {
	const identity = verifyNpmPublicationIdentity({ root, releaseDirectory });
	if (identity.registryVersionEligible !== true) {
		return { version: identity.version, eligible: false, published: [], skipped: [] };
	}
	assert(identity.publicationReady === true, '$.publicationReady', 'Registry-eligible release is not publication-ready');
	assert(identity.distTag === 'latest' || identity.distTag === 'next', '$.distTag', 'expected canonical latest or next dist-tag');
	const commit = fullCommitSha(expectedCommit, '$.expectedCommit');
	assertTrustedPublishingEnvironment(env, commit);
	assertNoTraditionalNpmCredentials(env);
	const npmVersion = npmCliVersion(runNpm, env);
	verifyTrustedPublishingToolchain({ nodeVersion: process.versions.node, npmVersion });

	const isolationRoot = mkdtempSync(join(tmpdir(), 'virune-npm-publish-'));
	try {
		const publicationEnv = isolatedNpmEnvironment(env, isolationRoot);
		const candidates = orderedPublicationCandidates(identity.packages);
		return await executePublication(identity, candidates, {
			observe: candidate => observeRegistryCandidate(candidate, identity.version, identity.distTag, { fetchImpl }),
			verifyProvenance: candidate => verifyExistingNpmProvenance(candidate.registryName, identity.version, commit, {
				runNpm,
				env: publicationEnv,
			}),
			publish: candidate => publishCandidate(candidate, identity.version, identity.distTag, releaseDirectory, {
				runNpm,
				env: publicationEnv,
				cwd: isolationRoot,
			}),
		});
	} finally {
		rmSync(isolationRoot, { recursive: true, force: true });
	}
}

export async function executePublication(identity, candidates, { observe, verifyProvenance, publish }) {
	const initial = new Map();
	for (const candidate of candidates) initial.set(candidate.registryName, await observe(candidate));
	validateObservedDependencyClosure(initial);
	for (const candidate of candidates) {
		if (initial.get(candidate.registryName).state === 'exact') await verifyProvenance(candidate);
	}

	const byName = new Map(candidates.map(candidate => [candidate.registryName, candidate]));
	const published = [];
	const skipped = [];
	for (const candidate of candidates) {
		const state = initial.get(candidate.registryName);
		if (state.state === 'exact') {
			skipped.push(candidate.registryName);
			continue;
		}
		assert(state.state === 'missing', `$.registry.${candidate.registryName}`, 'unexpected publication state');

		for (const dependencyName of NPM_INTERNAL_DEPENDENCIES[candidate.registryName]) {
			const dependency = byName.get(dependencyName);
			assert(dependency !== undefined, `$.packages.${candidate.registryName}`, `missing publication candidate for dependency ${dependencyName}`);
			const dependencyState = await observe(dependency);
			assert(
				dependencyState.state === 'exact',
				`$.registry.${candidate.registryName}`,
				`dependency ${dependencyName} is no longer exact immediately before publication`,
			);
		}

		const beforeWrite = await observe(candidate);
		if (beforeWrite.state === 'exact') {
			await verifyProvenance(candidate);
			skipped.push(candidate.registryName);
			continue;
		}
		assert(beforeWrite.state === 'missing', `$.registry.${candidate.registryName}`, 'pre-write Registry state is neither exact nor missing');

		await publish(candidate);
		const after = await observe(candidate);
		assert(after.state === 'exact', `$.registry.${candidate.registryName}`, 'publish did not converge to the exact reviewed Registry identity');
		await verifyProvenance(candidate);
		published.push(candidate.registryName);
	}

	const final = new Map();
	for (const candidate of candidates) final.set(candidate.registryName, await observe(candidate));
	validateObservedDependencyClosure(final);
	for (const candidate of candidates) {
		assert(final.get(candidate.registryName).state === 'exact', `$.registry.${candidate.registryName}`, 'final complete-set Registry observation is not exact');
		await verifyProvenance(candidate);
	}
	return { version: identity.version, eligible: true, published, skipped };
}

export function orderedPublicationCandidates(packages) {
	const byName = new Map(packages.map(candidate => [candidate.registryName, candidate]));
	assert(byName.size === packages.length, '$.packages', 'duplicate Registry package name');
	assert(byName.size === NPM_PUBLICATION_ORDER.length, '$.packages', 'unexpected Registry package count');
	for (const name of NPM_PUBLICATION_ORDER) assert(byName.has(name), '$.packages', `missing canonical package ${name}`);
	for (const name of byName.keys()) assert(NPM_PUBLICATION_ORDER.includes(name), '$.packages', `unexpected Registry package ${name}`);
	return NPM_PUBLICATION_ORDER.map(name => byName.get(name));
}

export async function observeRegistryCandidate(candidate, version, distTag, {
	fetchImpl = fetch,
	verifyExisting = verifyRegistryPackage,
} = {}) {
	const packageUrl = `${PUBLIC_REGISTRY}${encodeURIComponent(candidate.registryName)}`;
	const versionUrl = `${packageUrl}/${encodeURIComponent(version)}`;
	const [metadata, packument] = await Promise.all([
		fetchOptionalJson(versionUrl, fetchImpl, `${candidate.registryName}@${version}`),
		fetchOptionalJson(packageUrl, fetchImpl, candidate.registryName),
	]);
	if (metadata === null) {
		if (packument === null) return { state: 'missing' };
		assert(packument.name === candidate.registryName, `$.registry.${candidate.registryName}.packument.name`, `expected ${candidate.registryName}`);
		const versions = record(packument.versions, `$.registry.${candidate.registryName}.packument.versions`);
		assert(!Object.hasOwn(versions, version), `$.registry.${candidate.registryName}`, 'version endpoint is missing while packument contains the target version');
		const tags = record(packument['dist-tags'], `$.registry.${candidate.registryName}.dist-tags`);
		const canonicalTarget = tags[distTag];
		if (canonicalTarget !== undefined) {
			const current = parseRegistryReleaseVersion(canonicalTarget, `$.registry.${candidate.registryName}.dist-tags.${distTag}`);
			assert(Object.hasOwn(versions, current.text), `$.registry.${candidate.registryName}.dist-tags.${distTag}`, `canonical tag target ${current.text} is absent from packument versions`);
			const target = parseRegistryReleaseVersion(version, '$.version');
			assert(
				compareRegistryReleaseVersions(current, target) < 0,
				`$.registry.${candidate.registryName}.dist-tags.${distTag}`,
				`canonical tag target ${current.text} is not older than publication target ${target.text}; refusing a stale or contradictory tag update`,
			);
		}
		return { state: 'missing' };
	}
	assert(packument !== null, `$.registry.${candidate.registryName}`, 'version metadata exists while package document is missing');
	assert(metadata.name === candidate.registryName, `$.registry.${candidate.registryName}.name`, `expected ${candidate.registryName}`);
	assert(metadata.version === version, `$.registry.${candidate.registryName}.version`, `expected ${version}`);
	const verified = await verifyExisting(candidate, version, distTag, { fetchImpl });
	return { state: 'exact', verified };
}

export function validateObservedDependencyClosure(observations) {
	for (const name of NPM_PUBLICATION_ORDER) {
		const state = observations.get(name);
		assert(state !== undefined, `$.registry.${name}`, 'missing complete-set observation');
		if (state.state !== 'exact') continue;
		for (const dependency of NPM_INTERNAL_DEPENDENCIES[name]) {
			assert(observations.get(dependency)?.state === 'exact', `$.registry.${name}`, `exact package requires exact dependency ${dependency}`);
		}
	}
	return true;
}

export function npmPublishArguments(tarballPath, distTag) {
	assert(distTag === 'latest' || distTag === 'next', '$.distTag', 'expected latest or next');
	return [
		'publish',
		tarballPath,
		`--registry=${PUBLIC_REGISTRY}`,
		'--access=public',
		`--tag=${distTag}`,
		'--ignore-scripts',
	];
}

export function verifyCandidateTarballAtWriteBoundary(candidate, tarballPath) {
	const bytes = readRegularReleaseAsset(tarballPath, `$.publish.${candidate.registryName}.tarball`);
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	assert(sha256 === candidate.sha256, `$.publish.${candidate.registryName}.sha256`, 'tarball changed after reviewed publication identity verification');
	assert(bytes.byteLength === candidate.bytes, `$.publish.${candidate.registryName}.bytes`, 'tarball byte size changed after reviewed publication identity verification');
	return { sha256, bytes: bytes.byteLength };
}

export function validateTrustedPublishingProvenance(auditReport, { registryName, version, expectedCommit }) {
	const report = record(auditReport, '$.audit');
	for (const field of ['invalid', 'missing']) {
		const failures = Array.isArray(report[field]) ? report[field] : [];
		assert(!failures.some(item => item?.name === registryName && item?.version === version), '$.audit', `${registryName}@${version} failed npm signature/provenance verification`);
	}
	const verified = array(report.verified, '$.audit.verified').filter(item => item?.name === registryName && item?.version === version);
	assert(verified.length === 1, '$.audit.verified', `expected exactly one verified entry for ${registryName}@${version}`);
	const bundles = array(verified[0].attestationBundles, '$.audit.verified.attestationBundles');
	const provenance = bundles.filter(item => item?.predicateType === SLSA_V1);
	assert(provenance.length === 1, '$.audit.verified.attestationBundles', 'expected exactly one SLSA v1 provenance bundle');
	const envelope = record(record(provenance[0].bundle, '$.provenance.bundle').dsseEnvelope, '$.provenance.bundle.dsseEnvelope');
	const payloadText = Buffer.from(nonEmptyString(envelope.payload, '$.provenance.bundle.dsseEnvelope.payload'), 'base64').toString('utf8');
	let statement;
	try {
		statement = JSON.parse(payloadText);
	} catch (error) {
		throw new Error(`$.provenance: malformed DSSE payload: ${error instanceof Error ? error.message : String(error)}`);
	}
	const document = record(statement, '$.provenance.statement');
	assert(document._type === INTOTO_V1, '$.provenance.statement._type', `expected ${INTOTO_V1}`);
	assert(document.predicateType === SLSA_V1, '$.provenance.statement.predicateType', `expected ${SLSA_V1}`);
	const predicate = record(document.predicate, '$.provenance.statement.predicate');
	const build = record(predicate.buildDefinition, '$.provenance.statement.predicate.buildDefinition');
	assert(build.buildType === GITHUB_BUILD_TYPE, '$.provenance.statement.predicate.buildDefinition.buildType', 'expected GitHub Actions workflow build type');
	const workflow = record(record(build.externalParameters, '$.provenance.statement.predicate.buildDefinition.externalParameters').workflow, '$.provenance.statement.predicate.buildDefinition.externalParameters.workflow');
	assert(workflow.repository === EXPECTED_REPOSITORY_URL, '$.provenance.workflow.repository', `expected ${EXPECTED_REPOSITORY_URL}`);
	assert(workflow.path === EXPECTED_WORKFLOW, '$.provenance.workflow.path', `expected ${EXPECTED_WORKFLOW}`);
	nonEmptyString(workflow.ref, '$.provenance.workflow.ref');
	const dependencies = array(build.resolvedDependencies, '$.provenance.statement.predicate.buildDefinition.resolvedDependencies');
	const source = dependencies.filter(item => item?.digest?.gitCommit === expectedCommit && typeof item?.uri === 'string' && item.uri.startsWith(`git+${EXPECTED_REPOSITORY_URL}@`));
	assert(source.length === 1, '$.provenance.resolvedDependencies', `expected exact source commit ${expectedCommit}`);
	const runDetails = record(predicate.runDetails, '$.provenance.statement.predicate.runDetails');
	assert(record(runDetails.builder, '$.provenance.statement.predicate.runDetails.builder').id === GITHUB_BUILDER, '$.provenance.builder.id', `expected ${GITHUB_BUILDER}`);
	return true;
}

export function assertTrustedPublishingEnvironment(env, expectedCommit) {
	assert(env.GITHUB_ACTIONS === 'true', '$env.GITHUB_ACTIONS', 'npm publication is restricted to GitHub Actions');
	assert(env.RUNNER_ENVIRONMENT === 'github-hosted', '$env.RUNNER_ENVIRONMENT', 'npm Trusted Publishing requires the GitHub-hosted release runner');
	assert(env.GITHUB_REPOSITORY === EXPECTED_REPOSITORY, '$env.GITHUB_REPOSITORY', `expected ${EXPECTED_REPOSITORY}`);
	assert(env.GITHUB_SHA === expectedCommit, '$env.GITHUB_SHA', 'expected release commit must equal GitHub Actions head');
	assert(env.GITHUB_EVENT_NAME === 'push', '$env.GITHUB_EVENT_NAME', 'canonical release workflow must run from a push event');
	const githubRef = nonEmptyString(env.GITHUB_REF, '$env.GITHUB_REF');
	const workflowRef = nonEmptyString(env.GITHUB_WORKFLOW_REF, '$env.GITHUB_WORKFLOW_REF');
	const expectedWorkflowPrefix = `${EXPECTED_REPOSITORY}/${EXPECTED_WORKFLOW}@`;
	assert(workflowRef.startsWith(expectedWorkflowPrefix), '$env.GITHUB_WORKFLOW_REF', `expected ${EXPECTED_WORKFLOW}`);
	assert(workflowRef.slice(expectedWorkflowPrefix.length) === githubRef, '$env.GITHUB_WORKFLOW_REF', 'workflow ref must equal the exact release ref');
	nonEmptyString(env.ACTIONS_ID_TOKEN_REQUEST_URL, '$env.ACTIONS_ID_TOKEN_REQUEST_URL');
	nonEmptyString(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, '$env.ACTIONS_ID_TOKEN_REQUEST_TOKEN');
	return true;
}

export function assertNoTraditionalNpmCredentials(env) {
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined || value === '') continue;
		const upper = key.toUpperCase();
		const forbidden = upper === 'NPM_TOKEN'
			|| upper === 'NODE_AUTH_TOKEN'
			|| (upper.startsWith('NPM_CONFIG_') && (upper.includes('AUTHTOKEN') || upper.includes('AUTH_TOKEN') || upper.endsWith('_AUTH')));
		assert(!forbidden, `$env.${key}`, 'traditional npm publication credentials are forbidden on the normal Trusted Publishing path');
	}
	return true;
}

export function verifyTrustedPublishingToolchain({ nodeVersion, npmVersion }) {
	assertVersionAtLeast(nodeVersion, MINIMUM_NODE, '$toolchain.node');
	assertVersionAtLeast(npmVersion, MINIMUM_NPM, '$toolchain.npm');
	return true;
}

async function verifyExistingNpmProvenance(registryName, version, expectedCommit, { runNpm, env }) {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-provenance-'));
	try {
		writeFileSync(resolve(root, 'package.json'), `${JSON.stringify({ name: 'virune-provenance-check', version: '0.0.0', private: true, dependencies: { [registryName]: version } }, null, 2)}\n`);
		const install = runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${PUBLIC_REGISTRY}`], { cwd: root, env, encoding: 'utf8' });
		assertCommandSuccess(install, `npm install ${registryName}@${version}`);
		const audit = runNpm(['audit', 'signatures', '--json', '--include-attestations', `--registry=${PUBLIC_REGISTRY}`], { cwd: root, env, encoding: 'utf8' });
		let report;
		try {
			report = JSON.parse(audit.stdout ?? '');
		} catch (error) {
			throw new Error(`npm audit signatures returned malformed JSON for ${registryName}@${version}: ${error instanceof Error ? error.message : String(error)}`);
		}
		validateTrustedPublishingProvenance(report, { registryName, version, expectedCommit });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function publishCandidate(candidate, _version, distTag, releaseDirectory, { runNpm, env, cwd }) {
	const tarballPath = resolve(releaseDirectory, candidate.releaseAsset);
	verifyCandidateTarballAtWriteBoundary(candidate, tarballPath);
	const result = runNpm(npmPublishArguments(tarballPath, distTag), { cwd, env, encoding: 'utf8' });
	assertCommandSuccess(result, `npm publish ${candidate.registryName}`);
}

function npmCliVersion(runNpm, env) {
	const result = runNpm(['--version'], { env, encoding: 'utf8' });
	assertCommandSuccess(result, 'npm --version');
	return String(result.stdout ?? '').trim();
}

export function isolatedNpmEnvironment(baseEnv, root) {
	const env = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		const upper = key.toUpperCase();
		if (upper.startsWith('NPM_CONFIG_') || upper === 'NPM_TOKEN' || upper === 'NODE_AUTH_TOKEN') continue;
		if (upper === 'HOME' || upper === 'USERPROFILE' || upper === 'XDG_CONFIG_HOME') continue;
		if (value !== undefined) env[key] = value;
	}
	const userConfig = resolve(root, 'user.npmrc');
	const globalConfig = resolve(root, 'global.npmrc');
	const cache = resolve(root, 'cache');
	writeFileSync(userConfig, `registry=${PUBLIC_REGISTRY}\nreplace-registry-host=never\n`);
	writeFileSync(globalConfig, '');
	env.HOME = root;
	env.USERPROFILE = root;
	env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
	env.NPM_CONFIG_USERCONFIG = userConfig;
	env.NPM_CONFIG_GLOBALCONFIG = globalConfig;
	env.NPM_CONFIG_CACHE = cache;
	env.NPM_CONFIG_REGISTRY = PUBLIC_REGISTRY;
	env.NPM_CONFIG_REPLACE_REGISTRY_HOST = 'never';
	return env;
}

function runNpmCommand(argumentsList, options) {
	return spawnNpmSync(argumentsList, { ...options, maxBuffer: 64 * 1024 * 1024 });
}

async function fetchOptionalJson(url, fetchImpl, label) {
	let response;
	try {
		response = await fetchImpl(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
	} catch (error) {
		throw new Error(`Public npm Registry request failed for ${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (response?.status === 404) return null;
	if (!response?.ok) throw new Error(`Public npm Registry request failed for ${label}: HTTP ${response?.status ?? 'unknown'}`);
	try {
		return await response.json();
	} catch (error) {
		throw new Error(`Public npm Registry returned malformed JSON for ${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function parseRegistryReleaseVersion(value, path) {
	const text = nonEmptyString(value, path);
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/u.exec(text);
	assert(match !== null, path, 'expected stable, alpha, beta, or rc Virune semantic version');
	return {
		text,
		base: match.slice(1, 4).map(Number),
		prerelease: match[4] === undefined ? null : { channel: match[4], number: Number(match[5]) },
	};
}

function compareRegistryReleaseVersions(left, right) {
	for (let index = 0; index < 3; index += 1) {
		if (left.base[index] !== right.base[index]) return left.base[index] < right.base[index] ? -1 : 1;
	}
	if (left.prerelease === null && right.prerelease === null) return 0;
	if (left.prerelease === null) return 1;
	if (right.prerelease === null) return -1;
	const channels = { alpha: 0, beta: 1, rc: 2 };
	if (channels[left.prerelease.channel] !== channels[right.prerelease.channel]) {
		return channels[left.prerelease.channel] < channels[right.prerelease.channel] ? -1 : 1;
	}
	if (left.prerelease.number === right.prerelease.number) return 0;
	return left.prerelease.number < right.prerelease.number ? -1 : 1;
}

function assertCommandSuccess(result, label) {
	if (result?.error !== undefined) throw new Error(`${label} failed: ${result.error.message}`);
	if ((result?.status ?? 1) !== 0) throw new Error(`${label} exited with ${result?.status ?? 'unknown'}\n${result?.stdout ?? ''}\n${result?.stderr ?? ''}`);
}

function assertVersionAtLeast(value, minimum, path) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(String(value).trim());
	assert(match !== null, path, `expected semantic version, got ${String(value)}`);
	const actual = match.slice(1, 4).map(Number);
	for (let index = 0; index < minimum.length; index += 1) {
		if (actual[index] > minimum[index]) return;
		if (actual[index] < minimum[index]) throw new Error(`${path}: requires >=${minimum.join('.')}, got ${actual.join('.')}`);
	}
}

function fullCommitSha(value, path) {
	assert(typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value), path, 'expected a full lowercase commit SHA');
	return value;
}
function nonEmptyString(value, path) { assert(typeof value === 'string' && value.length > 0, path, 'expected a non-empty string'); return value; }
function array(value, path) { assert(Array.isArray(value), path, 'expected an array'); return value; }
function record(value, path) { assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object'); return value; }
function assert(condition, path, message) { if (!condition) throw new Error(`${path}: ${message}`); }

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
	const expectedCommit = process.argv.find(argument => argument.startsWith('--expected-commit='))?.slice('--expected-commit='.length);
	const result = await publishNpmRelease({ expectedCommit });
	if (result.eligible) process.stdout.write(`npm publication converged for ${result.version}: published ${result.published.length}, skipped ${result.skipped.length}.\n`);
	else process.stdout.write(`npm Registry publication is not enabled for ${result.version}; no Registry writes performed.\n`);
}
