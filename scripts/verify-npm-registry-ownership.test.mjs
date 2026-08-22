import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
	buildRegistryOwnershipAuthorizationEvidence,
	evaluateNpmRegistryOwnership,
	validateNpmRegistryOwnershipPolicy,
	validateNpmRegistryOwnershipReport,
	validateOwnershipObservation,
} from './verify-npm-registry-ownership.mjs';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const reviewedCommit = 'a'.repeat(40);
const releaseVersion = '1.1.0-rc.1';
const evidenceSetId = 'github-actions:32560000000:1';
const publicationManifestSha256 = 'b'.repeat(64);
const publicationManifestBytes = 4096;
const publicationPlan = JSON.parse(readFileSync('.github/release/npm-publication-v1.json', 'utf8'));
const repositoryPolicy = JSON.parse(readFileSync('.github/release/npm-registry-ownership-v1.json', 'utf8'));
const expectedPackages = publicationPlan.packages
	.map(item => item.registryName)
	.sort(compareText);

function configuredPolicy(expectedPrincipal = 'virune-publisher') {
	return {
		schemaVersion: 1,
		registry: PUBLIC_REGISTRY,
		status: 'configured',
		expectedPrincipal,
		scope: '@virune',
	};
}

function completeObservation({
	principal = 'virune-publisher',
	scopeAuthority = 'verified',
	states = {},
	packages = expectedPackages.map(registryName => ({
		registryName,
		state: states[registryName] ?? 'owned',
	})),
	...overrides
} = {}) {
	return {
		schemaVersion: 1,
		source: 'authenticated-npm-cli',
		registry: PUBLIC_REGISTRY,
		observationId: 'npm-observation:32560000000:1',
		reviewedCommit,
		evidenceSetId,
		version: releaseVersion,
		publicationManifestSha256,
		publicationManifestBytes,
		result: 'complete',
		principal,
		scopeAuthority,
		packages,
		...overrides,
	};
}

function failedObservation(result, overrides = {}) {
	return completeObservation({
		result,
		principal: null,
		scopeAuthority: 'unknown',
		packages: [],
		...overrides,
	});
}

function evaluate({
	ownershipPolicy = configuredPolicy(),
	observation = completeObservation(),
	plan = publicationPlan,
	...identityOverrides
} = {}) {
	return evaluateNpmRegistryOwnership({
		publicationPlan: plan,
		ownershipPolicy,
		observation,
		reviewedCommit,
		releaseVersion,
		evidenceSetId,
		publicationManifestSha256,
		publicationManifestBytes,
		...identityOverrides,
	});
}

function evidence(report, overrides = {}) {
	return buildRegistryOwnershipAuthorizationEvidence(report, {
		publicationPlan,
		ownershipPolicy: configuredPolicy(),
		reviewedCommit,
		releaseVersion,
		evidenceSetId,
		publicationManifestSha256,
		publicationManifestBytes,
		...overrides,
	});
}

test('repository ownership policy remains explicitly unconfigured until npm principal is reviewed', () => {
	assert.deepEqual(validateNpmRegistryOwnershipPolicy(repositoryPolicy), {
		schemaVersion: 1,
		registry: PUBLIC_REGISTRY,
		status: 'unconfigured',
		expectedPrincipal: null,
		scope: '@virune',
	});
});

test('unconfigured principal cannot turn otherwise complete observations into ownership success', () => {
	const report = evaluate({ ownershipPolicy: repositoryPolicy });
	assert.equal(report.state, 'unknown');
	assert.deepEqual(report.reasons, ['expected-principal-unconfigured']);
	assert.equal(report.expectedPrincipal, null);
	assert.throws(() => buildRegistryOwnershipAuthorizationEvidence(report, {
		publicationPlan,
		ownershipPolicy: repositoryPolicy,
		reviewedCommit,
		releaseVersion,
		evidenceSetId,
		publicationManifestSha256,
		publicationManifestBytes,
	}), /explicitly configured npm principal|only verified ownership/u);
});

test('complete authenticated ownership for exact reviewed package set emits canonical registry-ownership evidence', () => {
	const report = evaluate();
	assert.equal(report.state, 'verified');
	assert.deepEqual(report.reasons, []);
	assert.equal(report.expectedPrincipal, 'virune-publisher');
	assert.equal(report.observedPrincipal, 'virune-publisher');
	assert.equal(report.scopeAuthority, 'verified');
	assert.deepEqual(report.packages, expectedPackages.map(registryName => ({ registryName, state: 'owned' })));
	assert.deepEqual(evidence(report), {
		schemaVersion: 1,
		requirement: 'registry-ownership',
		result: 'passed',
		reviewedCommit,
		evidenceSetId,
		version: releaseVersion,
		publicationManifestSha256,
		publicationManifestBytes,
	});
});

test('authorization evidence is rebound to reviewed policy and exact identity instead of trusting a synthetic verified report', () => {
	const report = evaluate();
	assert.throws(() => evidence(report, {
		ownershipPolicy: configuredPolicy('different-principal'),
	}), /reviewed npm principal/u);
	assert.throws(() => evidence(report, { reviewedCommit: 'c'.repeat(40) }), /reviewedCommit/u);
	assert.throws(() => evidence(report, { releaseVersion: '1.1.0-rc.2' }), /version/u);
	assert.throws(() => evidence(report, { evidenceSetId: 'github-actions:32560000000:2' }), /evidenceSetId/u);
	assert.throws(() => evidence(report, { publicationManifestSha256: 'd'.repeat(64) }), /publicationManifest\.sha256/u);
	assert.throws(() => evidence(report, { publicationManifestBytes: publicationManifestBytes + 1 }), /publicationManifest\.bytes/u);
});

test('missing publication package is bootstrap-required and never counts as ownership evidence', () => {
	const missing = expectedPackages[0];
	const report = evaluate({ observation: completeObservation({ states: { [missing]: 'missing' } }) });
	assert.equal(report.state, 'bootstrap-required');
	assert.deepEqual(report.reasons, ['package-bootstrap-required']);
	assert.throws(() => evidence(report), /only verified ownership/u);
});

test('principal, scope and package conflicts remain distinct fail-closed outcomes', () => {
	const cases = [
		{
			observation: completeObservation({ principal: 'other-publisher' }),
			reason: 'principal-mismatch',
		},
		{
			observation: completeObservation({ scopeAuthority: 'conflict' }),
			reason: 'scope-authority-conflict',
		},
		{
			observation: completeObservation({ states: { [expectedPackages[0]]: 'conflict' } }),
			reason: 'package-ownership-conflict',
		},
	];
	for (const { observation, reason } of cases) {
		const report = evaluate({ observation });
		assert.equal(report.state, 'conflict');
		assert.deepEqual(report.reasons, [reason]);
		assert.throws(() => evidence(report), /only verified ownership/u);
	}
});

test('unknown scope or package state remains unresolved rather than safe', () => {
	for (const observation of [
		completeObservation({ scopeAuthority: 'unknown' }),
		completeObservation({ states: { [expectedPackages[0]]: 'unknown' } }),
	]) {
		const report = evaluate({ observation });
		assert.equal(report.state, 'unknown');
		assert.deepEqual(report.reasons, ['ownership-unknown']);
		assert.throws(() => evidence(report), /only verified ownership/u);
	}
});

test('authentication, network and unsupported observations preserve exact package coverage as unknown without inferring ownership', () => {
	for (const result of ['authentication-failed', 'network-failed', 'unsupported']) {
		const report = evaluate({ observation: failedObservation(result) });
		assert.equal(report.state, 'unknown');
		assert.equal(report.observedPrincipal, null);
		assert.equal(report.scopeAuthority, 'unknown');
		assert.deepEqual(report.packages, expectedPackages.map(registryName => ({ registryName, state: 'unknown' })));
		assert.deepEqual(report.reasons, [`observation-${result}`]);
		assert.throws(() => evidence(report), /only verified ownership/u);
	}
});

test('failed observations cannot smuggle inferred principal, scope or package state', () => {
	for (const observation of [
		failedObservation('authentication-failed', { principal: 'virune-publisher' }),
		failedObservation('network-failed', { scopeAuthority: 'verified' }),
		failedObservation('unsupported', { packages: [{ registryName: 'virune', state: 'missing' }] }),
	]) {
		assert.throws(() => evaluate({ observation }));
	}
});

test('complete observation requires exact unique publication package set', () => {
	const withoutLast = expectedPackages.slice(0, -1).map(registryName => ({ registryName, state: 'owned' }));
	const duplicate = expectedPackages.map(registryName => ({ registryName, state: 'owned' }));
	duplicate.push({ ...duplicate[0] });
	const unknown = expectedPackages.map(registryName => ({ registryName, state: 'owned' }));
	unknown.push({ registryName: '@virune/not-reviewed', state: 'owned' });
	for (const packages of [withoutLast, duplicate, unknown]) {
		assert.throws(() => evaluate({ observation: completeObservation({ packages }) }), /exact package set|duplicate registryName/u);
	}
});

test('observation identity is matched against independently supplied exact release identity', () => {
	const mutations = [
		observation => { observation.reviewedCommit = 'c'.repeat(40); },
		observation => { observation.evidenceSetId = 'github-actions:32560000000:2'; },
		observation => { observation.version = '1.1.0-rc.2'; },
		observation => { observation.publicationManifestSha256 = 'd'.repeat(64); },
		observation => { observation.publicationManifestBytes += 1; },
	];
	for (const mutate of mutations) {
		const observation = completeObservation();
		mutate(observation);
		assert.throws(() => evaluate({ observation }));
	}
});

test('wrong Registry, source, schema and secret-like extra fields fail closed', () => {
	const mutations = [
		observation => { observation.schemaVersion = 2; },
		observation => { observation.source = 'search-engine'; },
		observation => { observation.registry = 'https://registry.example.invalid/'; },
		observation => { observation.authToken = 'must-never-be-durable'; },
	];
	for (const mutate of mutations) {
		const observation = completeObservation();
		mutate(observation);
		assert.throws(() => evaluate({ observation }));
	}
});

test('ownership report validation rejects forged derived state, reasons, package order and unknown fields', () => {
	const mutations = [
		report => { report.state = 'unknown'; },
		report => { report.reasons = ['ownership-unknown']; },
		report => { report.packages.reverse(); },
		report => { report.unexpected = true; },
	];
	for (const mutate of mutations) {
		const report = evaluate();
		mutate(report);
		assert.throws(() => validateNpmRegistryOwnershipReport(report));
	}
});

test('publication scope authority must match the exact reviewed scoped package namespace', () => {
	const wrongPolicy = configuredPolicy();
	wrongPolicy.scope = '@other';
	assert.throws(() => evaluate({ ownershipPolicy: wrongPolicy }), /expected publication scope/u);

	const driftedPlan = structuredClone(publicationPlan);
	const scoped = driftedPlan.packages.find(item => item.registryName.startsWith('@virune/'));
	scoped.workspaceName = scoped.workspaceName.replace('@virune/', '@other/');
	scoped.registryName = scoped.registryName.replace('@virune/', '@other/');
	assert.throws(() => evaluate({ plan: driftedPlan }), /exactly one scoped publication namespace/u);
});

test('ownership policy is strict and never accepts an implicit principal', () => {
	const cases = [
		{ ...repositoryPolicy, expectedPrincipal: 'virune-publisher' },
		{ ...configuredPolicy(), expectedPrincipal: null },
		{ ...configuredPolicy(), registry: 'https://registry.example.invalid/' },
		{ ...configuredPolicy(), scope: 'virune' },
		{ ...configuredPolicy(), unexpected: true },
	];
	for (const policy of cases) assert.throws(() => validateNpmRegistryOwnershipPolicy(policy));
});

test('direct observation validator fails closed on malformed expected identity before evaluating payload agreement', () => {
	assert.throws(() => validateOwnershipObservation(completeObservation(), {
		expectedPackages,
		registry: PUBLIC_REGISTRY,
		reviewedCommit: 'ABC',
		version: releaseVersion,
		evidenceSetId,
		publicationManifestSha256,
		publicationManifestBytes,
	}), /full lowercase commit SHA/u);
	assert.throws(() => validateOwnershipObservation(completeObservation(), {
		expectedPackages,
		registry: PUBLIC_REGISTRY,
		reviewedCommit,
		version: '1.1',
		evidenceSetId,
		publicationManifestSha256,
		publicationManifestBytes,
	}), /expected stable, alpha, beta, rc, or nightly Virune semantic version/u);
});

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
