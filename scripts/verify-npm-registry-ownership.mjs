import { validateNpmPublicationPlanShape } from './npm-publication-plan-contract.mjs';
import { parseReleaseVersion } from './npm-publication-version-policy.mjs';

export const NPM_REGISTRY_OWNERSHIP_REPORT_KIND = 'npm-registry-ownership-v1';
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const OBSERVATION_SOURCE = 'authenticated-npm-cli';
const COMPLETE = 'complete';
const OBSERVATION_RESULTS = Object.freeze([COMPLETE, 'authentication-failed', 'network-failed', 'unsupported']);
const PACKAGE_STATES = Object.freeze(['owned', 'missing', 'conflict', 'unknown']);
const SCOPE_STATES = Object.freeze(['verified', 'conflict', 'unknown']);
const REPORT_STATES = Object.freeze(['verified', 'bootstrap-required', 'conflict', 'unknown']);

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

export function evaluateNpmRegistryOwnership({
	publicationPlan,
	ownershipPolicy,
	observation,
	reviewedCommit,
	releaseVersion,
	evidenceSetId,
	publicationManifestSha256,
	publicationManifestBytes,
} = {}) {
	const plan = validateNpmPublicationPlanShape(publicationPlan, '$.publicationPlan');
	const policy = validateNpmRegistryOwnershipPolicy(ownershipPolicy);
	const identity = expectedIdentity({
		reviewedCommit,
		releaseVersion,
		evidenceSetId,
		publicationManifestSha256,
		publicationManifestBytes,
	});
	const expectedPackages = publicationPackages(plan);
	assertPublicationScope(expectedPackages, policy.scope);
	const input = validateOwnershipObservation(observation, {
		expectedPackages,
		registry: policy.registry,
		...identity,
	});
	const packages = input.result === COMPLETE
		? input.packages
		: expectedPackages.map(registryName => ({ registryName, state: 'unknown' }));
	const outcome = deriveOwnershipOutcome({
		observationResult: input.result,
		expectedPrincipal: policy.expectedPrincipal,
		observedPrincipal: input.principal,
		scopeAuthority: input.scopeAuthority,
		packages,
	});
	return {
		schemaVersion: 1,
		kind: NPM_REGISTRY_OWNERSHIP_REPORT_KIND,
		state: outcome.state,
		reviewedCommit: identity.reviewedCommit,
		evidenceSetId: identity.evidenceSetId,
		version: identity.version,
		registry: policy.registry,
		expectedPrincipal: policy.expectedPrincipal,
		observedPrincipal: input.principal,
		scope: policy.scope,
		scopeAuthority: input.scopeAuthority,
		observationResult: input.result,
		publicationManifest: {
			sha256: identity.publicationManifestSha256,
			bytes: identity.publicationManifestBytes,
		},
		observationId: input.observationId,
		packages: packages.map(item => ({ ...item })),
		reasons: outcome.reasons,
	};
}

export function buildRegistryOwnershipAuthorizationEvidence(reportValue, { publicationPlan } = {}) {
	const report = validateNpmRegistryOwnershipReport(reportValue);
	const plan = validateNpmPublicationPlanShape(publicationPlan, '$.publicationPlan');
	const expectedPackages = publicationPackages(plan);
	assertPublicationScope(expectedPackages, report.scope);
	const actualPackages = report.packages.map(item => item.registryName);
	assert(JSON.stringify(actualPackages) === JSON.stringify(expectedPackages), '$.ownershipReport.packages', `expected exact publication package set ${expectedPackages.join(', ')}`);
	assert(report.state === 'verified', '$.ownershipReport.state', 'only verified ownership may satisfy registry-ownership');
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

export function validateNpmRegistryOwnershipReport(value, path = '$.ownershipReport') {
	const report = record(value, path);
	assertExactKeys(report, [
		'schemaVersion',
		'kind',
		'state',
		'reviewedCommit',
		'evidenceSetId',
		'version',
		'registry',
		'expectedPrincipal',
		'observedPrincipal',
		'scope',
		'scopeAuthority',
		'observationResult',
		'publicationManifest',
		'observationId',
		'packages',
		'reasons',
	], path);
	assert(report.schemaVersion === 1, `${path}.schemaVersion`, 'expected schemaVersion 1');
	assert(report.kind === NPM_REGISTRY_OWNERSHIP_REPORT_KIND, `${path}.kind`, `expected ${NPM_REGISTRY_OWNERSHIP_REPORT_KIND}`);
	const state = oneOf(report.state, REPORT_STATES, `${path}.state`);
	const reviewedCommit = fullCommitSha(report.reviewedCommit, `${path}.reviewedCommit`);
	const evidenceSetId = evidenceSetIdentity(report.evidenceSetId, `${path}.evidenceSetId`);
	const version = releaseVersion(report.version, `${path}.version`);
	assert(report.registry === PUBLIC_REGISTRY, `${path}.registry`, `expected ${PUBLIC_REGISTRY}`);
	const expectedPrincipal = report.expectedPrincipal === null ? null : npmUser(report.expectedPrincipal, `${path}.expectedPrincipal`);
	const observedPrincipal = report.observedPrincipal === null ? null : npmUser(report.observedPrincipal, `${path}.observedPrincipal`);
	const scope = npmScope(report.scope, `${path}.scope`);
	const scopeAuthority = oneOf(report.scopeAuthority, SCOPE_STATES, `${path}.scopeAuthority`);
	const observationResult = oneOf(report.observationResult, OBSERVATION_RESULTS, `${path}.observationResult`);
	const manifest = publicationManifestIdentity(report.publicationManifest, `${path}.publicationManifest`);
	const observationId = observationIdentity(report.observationId, `${path}.observationId`);
	const packages = array(report.packages, `${path}.packages`).map((item, index) => ownershipPackage(item, `${path}.packages[${index}]`));
	assert(packages.length > 0, `${path}.packages`, 'expected at least one package');
	assertUnique(packages.map(item => item.registryName), `${path}.packages`, 'registryName');
	assertSorted(packages.map(item => item.registryName), `${path}.packages`, 'registryName');
	const reasons = array(report.reasons, `${path}.reasons`).map((item, index) => reason(item, `${path}.reasons[${index}]`));
	assertUnique(reasons, `${path}.reasons`, 'reason');
	assertSorted(reasons, `${path}.reasons`, 'reason');
	const outcome = deriveOwnershipOutcome({ observationResult, expectedPrincipal, observedPrincipal, scopeAuthority, packages });
	assert(state === outcome.state, `${path}.state`, `expected derived state ${outcome.state}`);
	assert(JSON.stringify(reasons) === JSON.stringify(outcome.reasons), `${path}.reasons`, `expected derived reasons ${outcome.reasons.join(', ') || '<none>'}`);
	return {
		schemaVersion: 1,
		kind: NPM_REGISTRY_OWNERSHIP_REPORT_KIND,
		state,
		reviewedCommit,
		evidenceSetId,
		version,
		registry: PUBLIC_REGISTRY,
		expectedPrincipal,
		observedPrincipal,
		scope,
		scopeAuthority,
		observationResult,
		publicationManifest: manifest,
		observationId,
		packages,
		reasons,
	};
}

export function validateOwnershipObservation(value, {
	expectedPackages,
	registry,
	reviewedCommit,
	version,
	evidenceSetId,
	publicationManifestSha256,
	publicationManifestBytes,
} = {}) {
	const expected = array(expectedPackages, '$.expectedPackages').map((item, index) => npmPackage(item, `$.expectedPackages[${index}]`)).sort(compareText);
	assert(expected.length > 0, '$.expectedPackages', 'expected at least one publication package');
	assertUnique(expected, '$.expectedPackages', 'registryName');
	assert(registry === PUBLIC_REGISTRY, '$.registry', `expected ${PUBLIC_REGISTRY}`);
	const identity = expectedIdentity({
		reviewedCommit,
		releaseVersion: version,
		evidenceSetId,
		publicationManifestSha256,
		publicationManifestBytes,
	});
	const observation = record(value, '$.observation');
	assertExactKeys(observation, [
		'schemaVersion',
		'source',
		'registry',
		'observationId',
		'reviewedCommit',
		'evidenceSetId',
		'version',
		'publicationManifestSha256',
		'publicationManifestBytes',
		'result',
		'principal',
		'scopeAuthority',
		'packages',
	], '$.observation');
	assert(observation.schemaVersion === 1, '$.observation.schemaVersion', 'expected schemaVersion 1');
	assert(observation.source === OBSERVATION_SOURCE, '$.observation.source', `expected ${OBSERVATION_SOURCE}`);
	assert(observation.registry === registry, '$.observation.registry', `expected ${registry}`);
	const observationId = observationIdentity(observation.observationId, '$.observation.observationId');
	assert(observation.reviewedCommit === identity.reviewedCommit, '$.observation.reviewedCommit', `expected ${identity.reviewedCommit}`);
	assert(observation.evidenceSetId === identity.evidenceSetId, '$.observation.evidenceSetId', `expected ${identity.evidenceSetId}`);
	assert(observation.version === identity.version, '$.observation.version', `expected ${identity.version}`);
	assert(observation.publicationManifestSha256 === identity.publicationManifestSha256, '$.observation.publicationManifestSha256', 'must match exact publication manifest SHA-256');
	assert(observation.publicationManifestBytes === identity.publicationManifestBytes, '$.observation.publicationManifestBytes', 'must match exact publication manifest byte size');
	const result = oneOf(observation.result, OBSERVATION_RESULTS, '$.observation.result');
	if (result !== COMPLETE) {
		assert(observation.principal === null, '$.observation.principal', 'failed observation must not infer a principal');
		assert(observation.scopeAuthority === 'unknown', '$.observation.scopeAuthority', 'failed observation must keep scope authority unknown');
		assert(Array.isArray(observation.packages) && observation.packages.length === 0, '$.observation.packages', 'failed observation must not synthesize package state');
		return {
			schemaVersion: 1,
			source: OBSERVATION_SOURCE,
			registry,
			observationId,
			reviewedCommit: identity.reviewedCommit,
			evidenceSetId: identity.evidenceSetId,
			version: identity.version,
			publicationManifestSha256: identity.publicationManifestSha256,
			publicationManifestBytes: identity.publicationManifestBytes,
			result,
			principal: null,
			scopeAuthority: 'unknown',
			packages: [],
		};
	}
	const principal = npmUser(observation.principal, '$.observation.principal');
	const scopeAuthority = oneOf(observation.scopeAuthority, SCOPE_STATES, '$.observation.scopeAuthority');
	const packages = array(observation.packages, '$.observation.packages')
		.map((item, index) => ownershipPackage(item, `$.observation.packages[${index}]`))
		.sort((left, right) => compareText(left.registryName, right.registryName));
	assertUnique(packages.map(item => item.registryName), '$.observation.packages', 'registryName');
	const actual = packages.map(item => item.registryName);
	assert(JSON.stringify(actual) === JSON.stringify(expected), '$.observation.packages', `expected exact package set ${expected.join(', ')}`);
	return {
		schemaVersion: 1,
		source: OBSERVATION_SOURCE,
		registry,
		observationId,
		reviewedCommit: identity.reviewedCommit,
		evidenceSetId: identity.evidenceSetId,
		version: identity.version,
		publicationManifestSha256: identity.publicationManifestSha256,
		publicationManifestBytes: identity.publicationManifestBytes,
		result,
		principal,
		scopeAuthority,
		packages,
	};
}

function deriveOwnershipOutcome({ observationResult, expectedPrincipal, observedPrincipal, scopeAuthority, packages }) {
	let state = 'unknown';
	const reasons = [];
	if (observationResult !== COMPLETE) {
		reasons.push(`observation-${observationResult}`);
	} else if (expectedPrincipal === null) {
		reasons.push('expected-principal-unconfigured');
	} else if (observedPrincipal !== expectedPrincipal) {
		state = 'conflict';
		reasons.push('principal-mismatch');
	} else if (scopeAuthority === 'conflict') {
		state = 'conflict';
		reasons.push('scope-authority-conflict');
	} else if (packages.some(item => item.state === 'conflict')) {
		state = 'conflict';
		reasons.push('package-ownership-conflict');
	} else if (scopeAuthority === 'unknown' || packages.some(item => item.state === 'unknown')) {
		reasons.push('ownership-unknown');
	} else if (packages.some(item => item.state === 'missing')) {
		state = 'bootstrap-required';
		reasons.push('package-bootstrap-required');
	} else {
		assert(scopeAuthority === 'verified', '$.scopeAuthority', 'scope authority must be verified before ownership can pass');
		assert(packages.every(item => item.state === 'owned'), '$.packages', 'all publication packages must be owned before ownership can pass');
		state = 'verified';
	}
	return { state, reasons: reasons.sort(compareText) };
}

function expectedIdentity({ reviewedCommit, releaseVersion: value, evidenceSetId, publicationManifestSha256, publicationManifestBytes }) {
	return {
		reviewedCommit: fullCommitSha(reviewedCommit, '$.reviewedCommit'),
		version: releaseVersion(value, '$.releaseVersion'),
		evidenceSetId: evidenceSetIdentity(evidenceSetId, '$.evidenceSetId'),
		publicationManifestSha256: sha256(publicationManifestSha256, '$.publicationManifestSha256'),
		publicationManifestBytes: positiveInteger(publicationManifestBytes, '$.publicationManifestBytes'),
	};
}

function publicationPackages(plan) {
	return plan.packages.map(item => npmPackage(item.registryName, '$.publicationPlan.packages.registryName')).sort(compareText);
}

function assertPublicationScope(packages, expectedScope) {
	const scopes = [...new Set(packages.map(packageScope).filter(value => value !== null))].sort(compareText);
	assert(scopes.length === 1, '$.publicationPlan.packages', `expected exactly one scoped publication namespace; found ${scopes.join(', ') || 'none'}`);
	assert(scopes[0] === expectedScope, '$.ownershipPolicy.scope', `expected publication scope ${scopes[0]}`);
}

function ownershipPackage(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['registryName', 'state'], path);
	return {
		registryName: npmPackage(item.registryName, `${path}.registryName`),
		state: oneOf(item.state, PACKAGE_STATES, `${path}.state`),
	};
}

function publicationManifestIdentity(value, path) {
	const manifest = record(value, path);
	assertExactKeys(manifest, ['sha256', 'bytes'], path);
	return {
		sha256: sha256(manifest.sha256, `${path}.sha256`),
		bytes: positiveInteger(manifest.bytes, `${path}.bytes`),
	};
}

function fullCommitSha(value, path) {
	assert(typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value), path, 'expected a full lowercase commit SHA');
	return value;
}

function evidenceSetIdentity(value, path) {
	const identity = nonEmptyString(value, path);
	assert(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(identity), path, 'invalid evidence set identity');
	return identity;
}

function observationIdentity(value, path) {
	const identity = nonEmptyString(value, path);
	assert(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(identity), path, 'invalid observation identity');
	return identity;
}

function npmUser(value, path) {
	const user = nonEmptyString(value, path);
	assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(user), path, 'invalid npm user');
	return user;
}

function npmScope(value, path) {
	const scope = nonEmptyString(value, path);
	assert(/^@[a-z0-9][a-z0-9._-]*$/u.test(scope), path, 'invalid npm scope');
	return scope;
}

function npmPackage(value, path) {
	const name = nonEmptyString(value, path);
	assert(/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(name), path, 'invalid npm package name');
	return name;
}

function packageScope(value) {
	return value.startsWith('@') ? value.slice(0, value.indexOf('/')) : null;
}

function releaseVersion(value, path) {
	return parseReleaseVersion(value, path).text;
}

function sha256(value, path) {
	assert(typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value), path, 'expected lowercase SHA-256');
	return value;
}

function positiveInteger(value, path) {
	assert(Number.isSafeInteger(value) && value > 0, path, 'expected a positive safe integer');
	return value;
}

function reason(value, path) {
	const text = nonEmptyString(value, path);
	assert(/^[a-z0-9][a-z0-9-]*$/u.test(text), path, 'invalid reason');
	return text;
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

function oneOf(value, values, path) {
	assert(typeof value === 'string' && values.includes(value), path, `expected one of ${values.join(', ')}`);
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

function assertSorted(values, path, label) {
	const sorted = [...values].sort(compareText);
	assert(JSON.stringify(values) === JSON.stringify(sorted), path, `${label} must be sorted by code point`);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
