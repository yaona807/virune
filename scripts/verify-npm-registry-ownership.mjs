import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateNpmPublicationPlanShape } from './npm-publication-plan-contract.mjs';
import { parseReleaseVersion, registryPolicyForVersion } from './npm-publication-version-policy.mjs';
import { githubEvidenceSetIdentity } from './run-npm-publication-prewrite-gate.mjs';
import {
	bundledCliReleaseAssetName,
	registryReleaseAssetNameForPackage,
} from './verify-npm-publication-identity.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLICATION_PLAN_PATH = '.github/release/npm-publication-v1.json';
const OWNERSHIP_POLICY_PATH = '.github/release/npm-registry-ownership-v1.json';
const ROOT_MANIFEST_PATH = 'package.json';
const PUBLICATION_MANIFEST_PATH = resolve(repositoryRoot, 'release/PUBLICATION-MANIFEST.json');
const OUTPUT_PATH = resolve(repositoryRoot, '.cache/npm-registry-ownership/npm-registry-ownership-report.json');
const EVIDENCE_OUTPUT_PATH = resolve(repositoryRoot, '.cache/npm-registry-ownership/registry-ownership-evidence.json');
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const COLLECTOR_SOURCE = 'npm-cli-authenticated-readonly-v1';
const REPORT_KIND = 'npm-registry-ownership-v1';
const NPM_READ_TIMEOUT_MS = 60_000;
const OBSERVATION_RESULTS = Object.freeze([
	'complete',
	'policy-unconfigured',
	'whoami-failed',
	'scope-read-failed',
	'package-access-failed',
	'unsupported',
]);
const PACKAGE_STATES = Object.freeze(['owned', 'missing', 'conflict', 'unknown']);
const SCOPE_STATES = Object.freeze(['verified', 'conflict', 'unknown']);
const SAFE_NPM_ENV = new Set([
	'APPDATA',
	'CI',
	'COMSPEC',
	'HOME',
	'LANG',
	'LC_ALL',
	'LOCALAPPDATA',
	'NODE_AUTH_TOKEN',
	'NPM_CONFIG_USERCONFIG',
	'NPM_TOKEN',
	'PATH',
	'PATHEXT',
	'SYSTEMROOT',
	'TEMP',
	'TMP',
	'TMPDIR',
	'USERPROFILE',
	'WINDIR',
]);
const CLI_OPTIONS = Object.freeze([
	['--expected-commit=', 'reviewedCommit'],
	['--version=', 'releaseVersion'],
]);

export function validateNpmRegistryOwnershipPolicy(value, path = '$.ownershipPolicy') {
	const policy = record(value, path);
	assertExactKeys(policy, ['schemaVersion', 'registry', 'status', 'expectedPrincipal', 'scope'], path);
	assert(policy.schemaVersion === 1, `${path}.schemaVersion`, 'expected schemaVersion 1');
	assert(policy.registry === PUBLIC_REGISTRY, `${path}.registry`, `expected ${PUBLIC_REGISTRY}`);
	const status = oneOf(policy.status, ['unconfigured', 'configured'], `${path}.status`);
	const scope = npmScope(policy.scope, `${path}.scope`);
	let expectedPrincipal = null;
	if (status === 'unconfigured') {
		assert(policy.expectedPrincipal === null, `${path}.expectedPrincipal`, 'unconfigured policy must not guess an npm principal');
	} else {
		expectedPrincipal = npmUser(policy.expectedPrincipal, `${path}.expectedPrincipal`);
	}
	return { schemaVersion: 1, registry: PUBLIC_REGISTRY, status, expectedPrincipal, scope };
}

export function evaluateNpmRegistryOwnershipClassification({ publicationPlan, ownershipPolicy, observation } = {}) {
	const plan = validateNpmPublicationPlanShape(publicationPlan, '$.publicationPlan');
	const policy = validateNpmRegistryOwnershipPolicy(ownershipPolicy);
	const expectedPackages = publicationPackages(plan);
	assertPublicationScope(expectedPackages, policy.scope);
	const input = validateNpmRegistryOwnershipObservation(observation, {
		expectedPackages,
		registry: policy.registry,
	});
	const outcome = deriveOwnershipOutcome({
		collectorResult: input.result,
		policyStatus: policy.status,
		expectedPrincipal: policy.expectedPrincipal,
		observedPrincipal: input.principal,
		scopeAuthority: input.scopeAuthority,
		packages: input.packages,
	});
	return {
		state: outcome.state,
		collectorResult: input.result,
		expectedPrincipal: policy.expectedPrincipal,
		observedPrincipal: input.principal,
		scope: policy.scope,
		scopeAuthority: input.scopeAuthority,
		packages: input.packages.map(item => ({ ...item })),
		reasons: outcome.reasons,
	};
}

export function validateNpmRegistryOwnershipObservation(value, { expectedPackages, registry } = {}) {
	const expected = array(expectedPackages, '$.expectedPackages')
		.map((item, index) => npmPackage(item, `$.expectedPackages[${index}]`))
		.sort(compareText);
	assert(expected.length > 0, '$.expectedPackages', 'expected at least one publication package');
	assertUnique(expected, '$.expectedPackages', 'registryName');
	assert(registry === PUBLIC_REGISTRY, '$.registry', `expected ${PUBLIC_REGISTRY}`);
	const observation = record(value, '$.observation');
	assertExactKeys(observation, [
		'schemaVersion', 'source', 'registry', 'result', 'principal', 'scopeAuthority', 'packages',
	], '$.observation');
	assert(observation.schemaVersion === 1, '$.observation.schemaVersion', 'expected schemaVersion 1');
	assert(observation.source === COLLECTOR_SOURCE, '$.observation.source', `expected ${COLLECTOR_SOURCE}`);
	assert(observation.registry === PUBLIC_REGISTRY, '$.observation.registry', `expected ${PUBLIC_REGISTRY}`);
	const result = oneOf(observation.result, OBSERVATION_RESULTS, '$.observation.result');
	const principal = observation.principal === null ? null : npmUser(observation.principal, '$.observation.principal');
	const scopeAuthority = oneOf(observation.scopeAuthority, SCOPE_STATES, '$.observation.scopeAuthority');
	const packages = array(observation.packages, '$.observation.packages')
		.map((item, index) => ownershipPackage(item, `$.observation.packages[${index}]`))
		.sort((left, right) => compareText(left.registryName, right.registryName));
	assertUnique(packages.map(item => item.registryName), '$.observation.packages', 'registryName');
	assert(
		JSON.stringify(packages.map(item => item.registryName)) === JSON.stringify(expected),
		'$.observation.packages',
		`expected exact package set ${expected.join(', ')}`,
	);
	if (result === 'policy-unconfigured' || result === 'whoami-failed') {
		assert(principal === null, '$.observation.principal', `${result} must not infer an npm principal`);
		assert(scopeAuthority === 'unknown', '$.observation.scopeAuthority', `${result} must keep scope authority unknown`);
		assert(packages.every(item => item.state === 'unknown'), '$.observation.packages', `${result} must keep package state unknown`);
	}
	if (result === 'scope-read-failed') {
		assert(scopeAuthority === 'unknown', '$.observation.scopeAuthority', 'scope read failure must keep scope authority unknown');
		assert(packages.every(item => item.state === 'unknown'), '$.observation.packages', 'scope read failure must not synthesize package state');
	}
	if (result === 'package-access-failed') {
		assert(principal !== null, '$.observation.principal', 'package access failure requires the authenticated npm principal');
		assert(scopeAuthority === 'verified', '$.observation.scopeAuthority', 'package access failure occurs only after scope authority verification');
		assert(packages.every(item => item.state === 'unknown'), '$.observation.packages', 'package access failure must keep package state unknown');
	}
	return {
		schemaVersion: 1,
		source: COLLECTOR_SOURCE,
		registry: PUBLIC_REGISTRY,
		result,
		principal,
		scopeAuthority,
		packages,
	};
}

export function parseNpmWhoamiOutput(stdout) {
	const value = nonEmptyString(stdout, '$.npmWhoami.stdout').trim();
	assert(!value.includes('\n') && !value.includes('\r'), '$.npmWhoami.stdout', 'expected one npm username line');
	return npmUser(value, '$.npmWhoami.stdout');
}

export function parseNpmTeamMembersOutput(stdout) {
	const parsed = parseJsonText(stdout, '$.npmTeam.stdout');
	const members = array(parsed, '$.npmTeam.stdout')
		.map((item, index) => npmUser(item, `$.npmTeam.stdout[${index}]`))
		.sort(compareText);
	assertUnique(members, '$.npmTeam.stdout', 'npm username');
	return members;
}

export function parseNpmPackageAccessMap(stdout, expectedPackages) {
	const expected = array(expectedPackages, '$.expectedPackages')
		.map((item, index) => npmPackage(item, `$.expectedPackages[${index}]`))
		.sort(compareText);
	assert(expected.length > 0, '$.expectedPackages', 'expected at least one reviewed package');
	assertUnique(expected, '$.expectedPackages', 'registryName');
	const accessMap = record(parseJsonText(stdout, '$.npmAccess.stdout'), '$.npmAccess.stdout');
	return expected.map(registryName => {
		if (!Object.hasOwn(accessMap, registryName)) return { registryName, state: 'unknown' };
		const access = accessMap[registryName];
		if (access === 'read-write') return { registryName, state: 'owned' };
		if (access === 'read-only' || access === 'no-access') return { registryName, state: 'conflict' };
		throw new Error(`$.npmAccess.stdout.${registryName}: unsupported npm access level ${String(access)}`);
	});
}

export function parseNpmRegistryOwnershipArguments(argumentsList) {
	const args = array(argumentsList, '$.arguments');
	const parsed = {};
	for (const argument of args) {
		assert(typeof argument === 'string', '$.arguments', 'expected string arguments');
		const matches = CLI_OPTIONS.filter(([prefix]) => argument.startsWith(prefix));
		assert(matches.length === 1, '$.arguments', `unknown ownership collector argument ${argument}`);
		const [prefix, property] = matches[0];
		assert(parsed[property] === undefined, '$.arguments', `duplicate ${prefix.slice(0, -1)} argument`);
		const value = argument.slice(prefix.length);
		assert(value.length > 0, '$.arguments', `empty ${prefix.slice(0, -1)} argument`);
		parsed[property] = value;
	}
	return parsed;
}

export async function runNpmRegistryOwnershipCollector({ reviewedCommit, releaseVersion } = {}) {
	await invalidateOutputs();
	const commit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const version = parseReleaseVersion(releaseVersion, '$.releaseVersion').text;
	const evidenceSetId = githubEvidenceSetIdentity(process.env);
	verifyExactCleanCheckout(commit);
	assert(process.env.GITHUB_SHA === commit, '$.environment.GITHUB_SHA', `expected exact reviewed commit ${commit}`);

	const plan = validateNpmPublicationPlanShape(readReviewedJson(commit, PUBLICATION_PLAN_PATH), '$.publicationPlan');
	const policy = validateNpmRegistryOwnershipPolicy(readReviewedJson(commit, OWNERSHIP_POLICY_PATH));
	const rootManifest = readReviewedJson(commit, ROOT_MANIFEST_PATH);
	assert(rootManifest.version === version, '$.releaseVersion', `reviewed ${ROOT_MANIFEST_PATH} version is ${String(rootManifest.version)}, expected ${version}`);
	const expectedPackages = publicationPackages(plan);
	assertPublicationScope(expectedPackages, policy.scope);
	const releasePolicy = registryPolicyForVersion(
		version,
		nonEmptyString(plan.firstStableRegistryRelease, '$.publicationPlan.firstStableRegistryRelease'),
		record(plan.distTagPolicy, '$.publicationPlan.distTagPolicy'),
	);
	assert(releasePolicy.registryVersionEligible === true, '$.releaseVersion', 'ownership collector requires a Registry-eligible release version');
	const publicationManifestBytes = await readFile(PUBLICATION_MANIFEST_PATH);
	const publicationManifest = validatePublicationManifestForOwnership(publicationManifestBytes, {
		version,
		publicationReady: plan.publicationReady,
		distTag: releasePolicy.distTag,
		packages: plan.packages,
	});
	verifyExactCleanCheckout(commit);

	const observation = policy.status === 'configured'
		? collectLiveNpmObservation({ expectedPackages, policy })
		: unresolvedObservation('policy-unconfigured', expectedPackages);
	const classification = evaluateNpmRegistryOwnershipClassification({
		publicationPlan: plan,
		ownershipPolicy: policy,
		observation,
	});
	const report = buildLiveCollectorReport({
		classification,
		policy,
		reviewedCommit: commit,
		evidenceSetId,
		version,
		publicationManifest,
	});
	verifyExactCleanCheckout(commit);
	try {
		await persistJson(OUTPUT_PATH, report);
		const persistedReport = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
		validateNpmRegistryOwnershipReport(persistedReport, {
			publicationPlan: plan,
			ownershipPolicy: policy,
			reviewedCommit: commit,
			evidenceSetId,
			version,
			publicationManifest,
		});
		assert(isDeepStrictEqual(persistedReport, report), '$.ownershipReport', 'persisted ownership report differs from validated same-run report');
		if (report.state !== 'verified') return { report, evidence: null };
		verifyExactCleanCheckout(commit);
		const evidence = buildLiveRegistryOwnershipEvidence(report);
		await persistJson(EVIDENCE_OUTPUT_PATH, evidence);
		const persistedEvidence = JSON.parse(await readFile(EVIDENCE_OUTPUT_PATH, 'utf8'));
		assert(isDeepStrictEqual(persistedEvidence, evidence), '$.registryOwnershipEvidence', 'persisted registry-ownership evidence differs from same-run evidence');
		return { report, evidence };
	} catch (error) {
		await invalidateOutputs();
		throw error;
	}
}

export async function runNpmRegistryOwnershipCollectorCli(argumentsList) {
	await invalidateOutputs();
	const parsed = parseNpmRegistryOwnershipArguments(argumentsList);
	const result = await runNpmRegistryOwnershipCollector({
		reviewedCommit: parsed.reviewedCommit,
		releaseVersion: parsed.releaseVersion,
	});
	if (result.report.state !== 'verified') {
		throw new Error(`npm Registry ownership is ${result.report.state}: ${result.report.reasons.join(', ') || 'unresolved'}`);
	}
	return result;
}

export function validateNpmRegistryOwnershipReport(value, {
	publicationPlan,
	ownershipPolicy,
	reviewedCommit,
	evidenceSetId,
	version,
	publicationManifest,
} = {}) {
	const plan = validateNpmPublicationPlanShape(publicationPlan, '$.publicationPlan');
	const policy = validateNpmRegistryOwnershipPolicy(ownershipPolicy);
	const commit = fullCommitSha(reviewedCommit, '$.expected.reviewedCommit');
	const execution = evidenceSetIdentity(evidenceSetId, '$.expected.evidenceSetId');
	const releaseVersion = parseReleaseVersion(version, '$.expected.version').text;
	const manifest = publicationManifestIdentity(publicationManifest, '$.expected.publicationManifest');
	const expectedPackages = publicationPackages(plan);
	assertPublicationScope(expectedPackages, policy.scope);
	const report = record(value, '$.ownershipReport');
	assertExactKeys(report, [
		'schemaVersion', 'kind', 'collectorSource', 'collectorExecutionId', 'state',
		'reviewedCommit', 'evidenceSetId', 'version', 'registry', 'policyStatus', 'expectedPrincipal',
		'observedPrincipal', 'scope', 'scopeAuthority', 'collectorResult', 'publicationManifest',
		'packages', 'reasons',
	], '$.ownershipReport');
	assert(report.schemaVersion === 1, '$.ownershipReport.schemaVersion', 'expected schemaVersion 1');
	assert(report.kind === REPORT_KIND, '$.ownershipReport.kind', `expected ${REPORT_KIND}`);
	assert(report.collectorSource === COLLECTOR_SOURCE, '$.ownershipReport.collectorSource', `expected ${COLLECTOR_SOURCE}`);
	assert(report.reviewedCommit === commit, '$.ownershipReport.reviewedCommit', `expected ${commit}`);
	assert(report.evidenceSetId === execution, '$.ownershipReport.evidenceSetId', `expected ${execution}`);
	assert(report.version === releaseVersion, '$.ownershipReport.version', `expected ${releaseVersion}`);
	assert(report.registry === PUBLIC_REGISTRY, '$.ownershipReport.registry', `expected ${PUBLIC_REGISTRY}`);
	assert(report.policyStatus === policy.status, '$.ownershipReport.policyStatus', `expected ${policy.status}`);
	assert(report.expectedPrincipal === policy.expectedPrincipal, '$.ownershipReport.expectedPrincipal', `expected reviewed principal ${String(policy.expectedPrincipal)}`);
	assert(report.scope === policy.scope, '$.ownershipReport.scope', `expected ${policy.scope}`);
	const reportManifest = publicationManifestIdentity(report.publicationManifest, '$.ownershipReport.publicationManifest');
	assert(isDeepStrictEqual(reportManifest, manifest), '$.ownershipReport.publicationManifest', 'must match exact publication manifest identity');
	const expectedCollectorId = collectorExecutionIdentity({
		reviewedCommit: commit,
		evidenceSetId: execution,
		version: releaseVersion,
		publicationManifest: manifest,
	});
	assert(report.collectorExecutionId === expectedCollectorId, '$.ownershipReport.collectorExecutionId', `expected ${expectedCollectorId}`);
	const observation = {
		schemaVersion: 1,
		source: COLLECTOR_SOURCE,
		registry: PUBLIC_REGISTRY,
		result: report.collectorResult,
		principal: report.observedPrincipal,
		scopeAuthority: report.scopeAuthority,
		packages: report.packages,
	};
	const classification = evaluateNpmRegistryOwnershipClassification({ publicationPlan: plan, ownershipPolicy: policy, observation });
	assert(report.state === classification.state, '$.ownershipReport.state', `expected derived state ${classification.state}`);
	assert(JSON.stringify(report.reasons) === JSON.stringify(classification.reasons), '$.ownershipReport.reasons', `expected derived reasons ${classification.reasons.join(', ') || '<none>'}`);
	assert(JSON.stringify(report.packages) === JSON.stringify(classification.packages), '$.ownershipReport.packages', 'expected canonical package classification');
	return report;
}

export function validatePublicationManifestForOwnership(bytes, {
	version,
	publicationReady,
	distTag,
	packages: planPackages,
} = {}) {
	const buffer = exactBytes(bytes, '$.publicationManifestBytes');
	const releaseVersion = parseReleaseVersion(version, '$.releaseVersion').text;
	assert(typeof publicationReady === 'boolean', '$.publicationReady', 'expected a boolean');
	const document = record(parseJsonText(buffer.toString('utf8'), '$.publicationManifest'), '$.publicationManifest');
	assertExactKeys(document, [
		'schemaVersion', 'version', 'githubReleaseTag', 'publishSource', 'bundledCliReleaseAsset',
		'publicationReady', 'registryVersionEligible', 'distTag', 'packages',
	], '$.publicationManifest');
	assert(document.schemaVersion === 1, '$.publicationManifest.schemaVersion', 'expected schemaVersion 1');
	assert(document.version === releaseVersion, '$.publicationManifest.version', `expected ${releaseVersion}`);
	assert(document.githubReleaseTag === `v${releaseVersion}`, '$.publicationManifest.githubReleaseTag', `expected v${releaseVersion}`);
	assert(document.publishSource === 'reviewed-release-registry-candidate-tarball', '$.publicationManifest.publishSource', 'unexpected publication source');
	assert(document.bundledCliReleaseAsset === bundledCliReleaseAssetName(releaseVersion), '$.publicationManifest.bundledCliReleaseAsset', 'unexpected bundled CLI release asset');
	assert(document.publicationReady === publicationReady, '$.publicationManifest.publicationReady', `expected reviewed source readiness ${String(publicationReady)}`);
	assert(document.registryVersionEligible === true, '$.publicationManifest.registryVersionEligible', 'ownership collection requires a Registry-eligible candidate identity');
	assert(document.distTag === distTag, '$.publicationManifest.distTag', `expected ${String(distTag)}`);
	const expectedNames = array(planPackages, '$.publicationPlan.packages')
		.map((item, index) => nonEmptyString(record(item, `$.publicationPlan.packages[${index}]`).registryName, `$.publicationPlan.packages[${index}].registryName`))
		.sort(compareText);
	assertUnique(expectedNames, '$.publicationPlan.packages', 'registryName');
	const packages = array(document.packages, '$.publicationManifest.packages').map((item, index) => {
		const pkg = record(item, `$.publicationManifest.packages[${index}]`);
		assertExactKeys(pkg, ['registryName', 'releaseAsset', 'sha256', 'bytes'], `$.publicationManifest.packages[${index}]`);
		const registryName = npmPackage(pkg.registryName, `$.publicationManifest.packages[${index}].registryName`);
		assert(pkg.releaseAsset === registryReleaseAssetNameForPackage(registryName, releaseVersion), `$.publicationManifest.packages[${index}].releaseAsset`, 'candidate filename drift');
		assert(typeof pkg.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(pkg.sha256), `$.publicationManifest.packages[${index}].sha256`, 'expected lowercase SHA-256');
		assert(Number.isSafeInteger(pkg.bytes) && pkg.bytes > 0, `$.publicationManifest.packages[${index}].bytes`, 'expected positive safe integer byte size');
		return registryName;
	});
	assertUnique(packages, '$.publicationManifest.packages', 'registryName');
	packages.sort(compareText);
	assert(JSON.stringify(packages) === JSON.stringify(expectedNames), '$.publicationManifest.packages', `expected exact Registry package set ${expectedNames.join(', ')}`);
	return {
		sha256: createHash('sha256').update(buffer).digest('hex'),
		bytes: buffer.byteLength,
	};
}

function collectLiveNpmObservation({ expectedPackages, policy }) {
	const unknownPackages = () => expectedPackages.map(registryName => ({ registryName, state: 'unknown' }));
	const whoami = runNpmReadOnly(['whoami']);
	if (!whoami.ok) return unresolvedObservation('whoami-failed', expectedPackages);
	let principal;
	try {
		principal = parseNpmWhoamiOutput(whoami.stdout);
	} catch {
		return unresolvedObservation('unsupported', expectedPackages);
	}
	if (principal !== policy.expectedPrincipal) {
		return {
			schemaVersion: 1,
			source: COLLECTOR_SOURCE,
			registry: PUBLIC_REGISTRY,
			result: 'complete',
			principal,
			scopeAuthority: 'unknown',
			packages: unknownPackages(),
		};
	}
	const team = runNpmReadOnly(['team', 'ls', `${policy.scope}:developers`, '--json']);
	if (!team.ok) return unresolvedObservation('scope-read-failed', expectedPackages, principal);
	let members;
	try {
		members = parseNpmTeamMembersOutput(team.stdout);
	} catch {
		return unresolvedObservation('unsupported', expectedPackages, principal);
	}
	if (!members.includes(principal)) {
		return {
			schemaVersion: 1,
			source: COLLECTOR_SOURCE,
			registry: PUBLIC_REGISTRY,
			result: 'complete',
			principal,
			scopeAuthority: 'conflict',
			packages: unknownPackages(),
		};
	}
	const access = runNpmReadOnly(['access', 'list', 'packages', principal, '--json']);
	if (!access.ok) {
		return {
			schemaVersion: 1,
			source: COLLECTOR_SOURCE,
			registry: PUBLIC_REGISTRY,
			result: 'package-access-failed',
			principal,
			scopeAuthority: 'verified',
			packages: unknownPackages(),
		};
	}
	let packages;
	try {
		packages = parseNpmPackageAccessMap(access.stdout, expectedPackages);
	} catch {
		return {
			schemaVersion: 1,
			source: COLLECTOR_SOURCE,
			registry: PUBLIC_REGISTRY,
			result: 'unsupported',
			principal,
			scopeAuthority: 'verified',
			packages: unknownPackages(),
		};
	}
	return {
		schemaVersion: 1,
		source: COLLECTOR_SOURCE,
		registry: PUBLIC_REGISTRY,
		result: 'complete',
		principal,
		scopeAuthority: 'verified',
		packages,
	};
}

function unresolvedObservation(result, expectedPackages, principal = null) {
	return {
		schemaVersion: 1,
		source: COLLECTOR_SOURCE,
		registry: PUBLIC_REGISTRY,
		result,
		principal,
		scopeAuthority: 'unknown',
		packages: expectedPackages.map(registryName => ({ registryName, state: 'unknown' })),
	};
}

function buildLiveCollectorReport({ classification, policy, reviewedCommit, evidenceSetId, version, publicationManifest }) {
	const manifest = publicationManifestIdentity(publicationManifest, '$.publicationManifest');
	return {
		schemaVersion: 1,
		kind: REPORT_KIND,
		collectorSource: COLLECTOR_SOURCE,
		collectorExecutionId: collectorExecutionIdentity({ reviewedCommit, evidenceSetId, version, publicationManifest: manifest }),
		state: classification.state,
		reviewedCommit,
		evidenceSetId,
		version,
		registry: PUBLIC_REGISTRY,
		policyStatus: policy.status,
		expectedPrincipal: classification.expectedPrincipal,
		observedPrincipal: classification.observedPrincipal,
		scope: classification.scope,
		scopeAuthority: classification.scopeAuthority,
		collectorResult: classification.collectorResult,
		publicationManifest: manifest,
		packages: classification.packages.map(item => ({ ...item })),
		reasons: [...classification.reasons],
	};
}

function buildLiveRegistryOwnershipEvidence(report) {
	assert(report.kind === REPORT_KIND, '$.ownershipReport.kind', 'canonical evidence requires the live collector report kind');
	assert(report.collectorSource === COLLECTOR_SOURCE, '$.ownershipReport.collectorSource', 'canonical evidence requires the live collector source');
	assert(report.state === 'verified', '$.ownershipReport.state', 'only verified ownership may emit registry-ownership evidence');
	assert(report.collectorResult === 'complete', '$.ownershipReport.collectorResult', 'canonical evidence requires a complete live collector result');
	assert(report.policyStatus === 'configured', '$.ownershipReport.policyStatus', 'canonical evidence requires configured reviewed ownership policy');
	assert(report.expectedPrincipal !== null && report.observedPrincipal === report.expectedPrincipal, '$.ownershipReport.observedPrincipal', 'canonical evidence requires exact reviewed principal');
	assert(report.scopeAuthority === 'verified', '$.ownershipReport.scopeAuthority', 'canonical evidence requires verified scope authority');
	assert(report.packages.every(item => item.state === 'owned'), '$.ownershipReport.packages', 'canonical evidence requires read-write access to every reviewed package');
	return {
		schemaVersion: 1,
		requirement: 'registry-ownership',
		result: 'passed',
		reviewedCommit: report.reviewedCommit,
		evidenceSetId: report.evidenceSetId,
		version: report.version,
		publicationManifestSha256: report.publicationManifest.sha256,
		publicationManifestBytes: report.publicationManifest.bytes,
	};
}

function deriveOwnershipOutcome({ collectorResult, policyStatus, expectedPrincipal, observedPrincipal, scopeAuthority, packages }) {
	let state = 'unknown';
	const reasons = [];
	if (policyStatus !== 'configured' || expectedPrincipal === null) {
		reasons.push('expected-principal-unconfigured');
	} else if (collectorResult !== 'complete') {
		reasons.push(`collector-${collectorResult}`);
	} else if (observedPrincipal !== expectedPrincipal) {
		state = 'conflict';
		reasons.push('principal-mismatch');
	} else if (scopeAuthority === 'conflict') {
		state = 'conflict';
		reasons.push('scope-authority-conflict');
	} else if (packages.some(item => item.state === 'conflict')) {
		state = 'conflict';
		reasons.push('package-write-authority-conflict');
	} else if (scopeAuthority === 'unknown' || packages.some(item => item.state === 'unknown')) {
		reasons.push('ownership-unknown');
	} else if (packages.some(item => item.state === 'missing')) {
		state = 'bootstrap-required';
		reasons.push('package-bootstrap-required');
	} else {
		assert(scopeAuthority === 'verified', '$.observation.scopeAuthority', 'verified ownership requires verified scope authority');
		assert(packages.every(item => item.state === 'owned'), '$.observation.packages', 'verified ownership requires every package to be owned');
		state = 'verified';
	}
	reasons.sort(compareText);
	return { state, reasons };
}

function publicationPackages(plan) {
	const names = array(plan.packages, '$.publicationPlan.packages')
		.map((item, index) => npmPackage(record(item, `$.publicationPlan.packages[${index}]`).registryName, `$.publicationPlan.packages[${index}].registryName`))
		.sort(compareText);
	assert(names.length > 0, '$.publicationPlan.packages', 'expected at least one Registry package');
	assertUnique(names, '$.publicationPlan.packages', 'registryName');
	return names;
}

function assertPublicationScope(packages, scope) {
	const scoped = packages.filter(name => name.startsWith('@'));
	assert(scoped.length > 0, '$.publicationPlan.packages', 'expected reviewed scoped Registry packages');
	assert(scoped.every(name => name.startsWith(`${scope}/`)), '$.ownershipPolicy.scope', `expected publication scope ${scope}`);
}

function collectorExecutionIdentity({ reviewedCommit, evidenceSetId, version, publicationManifest }) {
	const commit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const execution = evidenceSetIdentity(evidenceSetId, '$.evidenceSetId');
	const releaseVersion = parseReleaseVersion(version, '$.version').text;
	const manifest = publicationManifestIdentity(publicationManifest, '$.publicationManifest');
	return createHash('sha256')
		.update(`${COLLECTOR_SOURCE}\0${commit}\0${execution}\0${releaseVersion}\0${manifest.sha256}\0${manifest.bytes}`)
		.digest('hex');
}

function runNpmReadOnly(args) {
	const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const result = spawnSync(command, [
		...args,
		`--registry=${PUBLIC_REGISTRY}`,
		'--loglevel=error',
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 1024 * 1024,
		env: npmReadEnvironment(process.env),
		timeout: NPM_READ_TIMEOUT_MS,
		windowsHide: true,
	});
	return {
		ok: result.error === undefined && result.status === 0,
		stdout: typeof result.stdout === 'string' ? result.stdout : '',
	};
}

function npmReadEnvironment(environment) {
	return Object.fromEntries(Object.entries(environment).filter(([name, value]) => SAFE_NPM_ENV.has(name) && typeof value === 'string'));
}

function readReviewedJson(reviewedCommit, path) {
	const result = spawnSync('git', ['show', `${reviewedCommit}:${path}`], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
	});
	if (result.error !== undefined) throw new Error(`Failed to read reviewed ${path} from ${reviewedCommit}: ${result.error.message}`);
	if ((result.status ?? 1) !== 0) throw new Error(`Failed to read reviewed ${path} from ${reviewedCommit}: ${result.stderr.trim()}`);
	try {
		return JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`Reviewed ${path} is malformed JSON at ${reviewedCommit}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function verifyExactCleanCheckout(reviewedCommit) {
	const head = git(['rev-parse', 'HEAD']);
	assert(head === reviewedCommit, '$.reviewedCommit', `checkout HEAD ${head} does not match reviewed commit ${reviewedCommit}`);
	const status = git(['status', '--porcelain=v1', '--untracked-files=normal']);
	assert(status.length === 0, '$.checkout', 'working tree must be clean during npm Registry ownership collection');
}

function git(args) {
	const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
	if (result.error !== undefined) throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
	if ((result.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
	return result.stdout.trim();
}

async function persistJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`, 'utf8');
}

async function invalidateOutputs() {
	await rm(OUTPUT_PATH, { force: true });
	await rm(EVIDENCE_OUTPUT_PATH, { force: true });
}

function publicationManifestIdentity(value, path) {
	const manifest = record(value, path);
	assertExactKeys(manifest, ['sha256', 'bytes'], path);
	assert(typeof manifest.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(manifest.sha256), `${path}.sha256`, 'expected lowercase SHA-256');
	assert(Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0, `${path}.bytes`, 'expected positive safe integer byte size');
	return { sha256: manifest.sha256, bytes: manifest.bytes };
}

function ownershipPackage(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['registryName', 'state'], path);
	return {
		registryName: npmPackage(item.registryName, `${path}.registryName`),
		state: oneOf(item.state, PACKAGE_STATES, `${path}.state`),
	};
}

function npmUser(value, path) {
	assert(typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,213}$/u.test(value), path, 'expected a canonical lowercase npm username');
	return value;
}

function npmScope(value, path) {
	assert(typeof value === 'string' && /^@[a-z0-9][a-z0-9._-]{0,213}$/u.test(value), path, 'expected a canonical lowercase npm scope');
	return value;
}

function npmPackage(value, path) {
	assert(typeof value === 'string' && /^(?:[a-z0-9][a-z0-9._-]*|@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/u.test(value), path, 'expected a canonical lowercase npm package name');
	return value;
}

function evidenceSetIdentity(value, path) {
	const identity = nonEmptyString(value, path);
	assert(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(identity), path, 'invalid evidence set identity');
	return identity;
}

function fullCommitSha(value, path) {
	assert(typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value), path, 'expected a full lowercase commit SHA');
	return value;
}

function exactBytes(value, path) {
	assert(Buffer.isBuffer(value) || value instanceof Uint8Array, path, 'expected exact bytes');
	const buffer = Buffer.from(value);
	assert(buffer.byteLength > 0, path, 'must not be empty');
	return buffer;
}

function parseJsonText(value, path) {
	assert(typeof value === 'string', path, 'expected UTF-8 text');
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new Error(`${path}: malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function oneOf(value, allowed, path) {
	assert(allowed.includes(value), path, `expected one of ${allowed.join(', ')}`);
	return value;
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function array(value, path) {
	assert(Array.isArray(value), path, 'expected an array');
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

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const result = await runNpmRegistryOwnershipCollectorCli(process.argv.slice(2));
	process.stdout.write(`Verified npm Registry ownership for ${result.report.version} at ${result.report.reviewedCommit}.\n`);
}
