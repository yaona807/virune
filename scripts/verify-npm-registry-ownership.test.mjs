import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import * as ownership from './verify-npm-registry-ownership.mjs';
import {
	bundledCliReleaseAssetName,
	registryReleaseAssetNameForPackage,
} from './verify-npm-publication-identity.mjs';

const publicationPlan = JSON.parse(readFileSync(resolve('.github/release/npm-publication-v1.json'), 'utf8'));
const repositoryPolicy = JSON.parse(readFileSync(resolve('.github/release/npm-registry-ownership-v1.json'), 'utf8'));
const expectedPackages = publicationPlan.packages.map(item => item.registryName).sort(compareText);
const principal = 'virune-publisher';
const reviewedCommit = 'a'.repeat(40);
const evidenceSetId = 'github-actions:32560000000:1';
const releaseVersion = '1.1.0-rc.1';
const publicationManifestIdentity = { sha256: '1'.repeat(64), bytes: 4096 };
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const COLLECTOR_SOURCE = 'npm-cli-authenticated-readonly-v1';

function configuredPolicy() {
	return {
		...repositoryPolicy,
		status: 'configured',
		expectedPrincipal: principal,
	};
}

function packages(state = 'owned') {
	return expectedPackages.map(registryName => ({ registryName, state }));
}

function observation({
	result = 'complete',
	observedPrincipal = principal,
	scopeAuthority = 'verified',
	packageStates = packages(),
} = {}) {
	return {
		schemaVersion: 1,
		source: COLLECTOR_SOURCE,
		registry: PUBLIC_REGISTRY,
		result,
		principal: observedPrincipal,
		scopeAuthority,
		packages: packageStates,
	};
}

function evaluate(overrides = {}) {
	return ownership.evaluateNpmRegistryOwnershipClassification({
		publicationPlan,
		ownershipPolicy: configuredPolicy(),
		observation: observation(),
		...overrides,
	});
}

function manifest({ version = releaseVersion, publicationReady = false } = {}) {
	return {
		schemaVersion: 1,
		version,
		githubReleaseTag: `v${version}`,
		publishSource: 'reviewed-release-registry-candidate-tarball',
		bundledCliReleaseAsset: bundledCliReleaseAssetName(version),
		publicationReady,
		registryVersionEligible: true,
		distTag: 'next',
		packages: expectedPackages.map((registryName, index) => ({
			registryName,
			releaseAsset: registryReleaseAssetNameForPackage(registryName, version),
			sha256: String(index + 1).repeat(64).slice(0, 64),
			bytes: 1000 + index,
		})),
	};
}

function manifestBytes(value = manifest()) {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function collectorId(identity = publicationManifestIdentity) {
	return createHash('sha256')
		.update(`${COLLECTOR_SOURCE}\0${reviewedCommit}\0${evidenceSetId}\0${releaseVersion}\0${identity.sha256}\0${identity.bytes}`)
		.digest('hex');
}

function report({ policy = configuredPolicy(), observed = observation(), identity = publicationManifestIdentity } = {}) {
	const classification = ownership.evaluateNpmRegistryOwnershipClassification({
		publicationPlan,
		ownershipPolicy: policy,
		observation: observed,
	});
	return {
		schemaVersion: 1,
		kind: 'npm-registry-ownership-v1',
		collectorSource: COLLECTOR_SOURCE,
		collectorExecutionId: collectorId(identity),
		state: classification.state,
		reviewedCommit,
		evidenceSetId,
		version: releaseVersion,
		registry: PUBLIC_REGISTRY,
		policyStatus: policy.status,
		expectedPrincipal: classification.expectedPrincipal,
		observedPrincipal: classification.observedPrincipal,
		scope: classification.scope,
		scopeAuthority: classification.scopeAuthority,
		collectorResult: classification.collectorResult,
		publicationManifest: { ...identity },
		packages: classification.packages.map(item => ({ ...item })),
		reasons: [...classification.reasons],
	};
}

test('current reviewed ownership policy is explicit and remains unconfigured', () => {
	assert.deepEqual(repositoryPolicy, {
		schemaVersion: 1,
		registry: PUBLIC_REGISTRY,
		status: 'unconfigured',
		expectedPrincipal: null,
		scope: '@virune',
	});
	assert.deepEqual(ownership.validateNpmRegistryOwnershipPolicy(repositoryPolicy), repositoryPolicy);
});

test('current npm publication plan remains non-ready with registry ownership unresolved', () => {
	assert.equal(publicationPlan.publicationReady, false);
	assert(publicationPlan.unresolvedRequirements.includes('registry-ownership'));
});

test('unconfigured reviewed policy cannot be upgraded by a forged complete owned observation', () => {
	const result = ownership.evaluateNpmRegistryOwnershipClassification({
		publicationPlan,
		ownershipPolicy: repositoryPolicy,
		observation: observation(),
	});
	assert.equal(result.state, 'unknown');
	assert.deepEqual(result.reasons, ['expected-principal-unconfigured']);
});

test('pure classification distinguishes verified bootstrap conflict and unknown states', () => {
	assert.equal(evaluate().state, 'verified');
	const missing = packages();
	missing[0] = { ...missing[0], state: 'missing' };
	assert.equal(evaluate({ observation: observation({ packageStates: missing }) }).state, 'bootstrap-required');
	const conflict = packages();
	conflict[0] = { ...conflict[0], state: 'conflict' };
	assert.equal(evaluate({ observation: observation({ packageStates: conflict }) }).state, 'conflict');
	const unknown = packages();
	unknown[0] = { ...unknown[0], state: 'unknown' };
	assert.equal(evaluate({ observation: observation({ packageStates: unknown }) }).state, 'unknown');
});

test('principal scope and package write-authority conflicts fail closed', () => {
	assert.equal(evaluate({ observation: observation({ observedPrincipal: 'other-user' }) }).state, 'conflict');
	assert.equal(evaluate({ observation: observation({ scopeAuthority: 'conflict' }) }).state, 'conflict');
	const packageConflict = packages();
	packageConflict[1] = { ...packageConflict[1], state: 'conflict' };
	const result = evaluate({ observation: observation({ packageStates: packageConflict }) });
	assert.equal(result.state, 'conflict');
	assert.deepEqual(result.reasons, ['package-write-authority-conflict']);
});

test('collector failures remain unknown and cannot synthesize package absence', () => {
	const failed = [
		observation({ result: 'whoami-failed', observedPrincipal: null, scopeAuthority: 'unknown', packageStates: packages('unknown') }),
		observation({ result: 'scope-read-failed', scopeAuthority: 'unknown', packageStates: packages('unknown') }),
		observation({ result: 'package-access-failed', scopeAuthority: 'verified', packageStates: packages('unknown') }),
		observation({ result: 'unsupported', scopeAuthority: 'verified', packageStates: packages('unknown') }),
	];
	for (const observed of failed) {
		const result = evaluate({ observation: observed });
		assert.equal(result.state, 'unknown');
		assert(result.packages.every(item => item.state === 'unknown'));
	}
});

test('observation schema requires the exact unique reviewed package set', () => {
	const missing = packages().slice(0, -1);
	const duplicate = packages();
	duplicate.push({ ...duplicate[0] });
	const unknown = packages();
	unknown.push({ registryName: '@virune/not-reviewed', state: 'owned' });
	for (const packageStates of [missing, duplicate, unknown]) {
		assert.throws(() => evaluate({ observation: observation({ packageStates }) }), /exact package set|duplicate registryName/u);
	}
});

test('observation schema rejects wrong Registry source schema and secret-like extras', () => {
	const mutations = [
		value => { value.schemaVersion = 2; },
		value => { value.source = 'self-attested'; },
		value => { value.registry = 'https://registry.example.invalid/'; },
		value => { value.authToken = 'must-not-be-durable'; },
	];
	for (const mutate of mutations) {
		const value = observation();
		mutate(value);
		assert.throws(() => evaluate({ observation: value }));
	}
});

test('ownership policy is strict and never accepts an implicit principal', () => {
	const cases = [
		{ ...repositoryPolicy, expectedPrincipal: principal },
		{ ...configuredPolicy(), expectedPrincipal: null },
		{ ...configuredPolicy(), expectedPrincipal: 'UpperCase' },
		{ ...configuredPolicy(), registry: 'https://registry.example.invalid/' },
		{ ...configuredPolicy(), scope: 'virune' },
		{ ...configuredPolicy(), unexpected: true },
	];
	for (const policy of cases) assert.throws(() => ownership.validateNpmRegistryOwnershipPolicy(policy));
});

test('npm whoami parser accepts exactly one canonical lowercase username', () => {
	assert.equal(ownership.parseNpmWhoamiOutput('virune-publisher\n'), principal);
	for (const value of ['', 'UpperCase\n', 'one\ntwo\n', '@scope\n']) {
		assert.throws(() => ownership.parseNpmWhoamiOutput(value));
	}
});

test('npm team JSON parser is deterministic and strict', () => {
	assert.deepEqual(ownership.parseNpmTeamMembersOutput('["zeta","virune-publisher","alpha"]\n'), ['alpha', 'virune-publisher', 'zeta']);
	for (const value of ['{}', '["duplicate","duplicate"]', '["UpperCase"]', '{']) {
		assert.throws(() => ownership.parseNpmTeamMembersOutput(value));
	}
});

test('npm package access map extracts only reviewed packages and requires read-write for ownership', () => {
	const input = Object.fromEntries(expectedPackages.map(name => [name, 'read-write']));
	input['unrelated-package'] = 'read-write';
	assert(ownership.parseNpmPackageAccessMap(JSON.stringify(input), expectedPackages).every(item => item.state === 'owned'));
	delete input[expectedPackages[0]];
	const missing = ownership.parseNpmPackageAccessMap(JSON.stringify(input), expectedPackages);
	assert.equal(missing.find(item => item.registryName === expectedPackages[0]).state, 'unknown');
	input[expectedPackages[0]] = 'read-only';
	assert.equal(ownership.parseNpmPackageAccessMap(JSON.stringify(input), expectedPackages)[0].state, 'conflict');
	input[expectedPackages[0]] = 'unexpected-access';
	assert.throws(() => ownership.parseNpmPackageAccessMap(JSON.stringify(input), expectedPackages), /unsupported npm access level/u);
	assert.throws(() => ownership.parseNpmPackageAccessMap('[]', expectedPackages));
	assert.throws(() => ownership.parseNpmPackageAccessMap('{', expectedPackages));
});

test('ownership manifest validator accepts exact non-ready Registry-eligible identity', () => {
	const bytes = manifestBytes();
	assert.deepEqual(ownership.validatePublicationManifestForOwnership(bytes, {
		version: releaseVersion,
		publicationReady: false,
		distTag: 'next',
		packages: publicationPlan.packages,
	}), {
		sha256: createHash('sha256').update(bytes).digest('hex'),
		bytes: bytes.byteLength,
	});
});

test('ownership manifest identity fails closed on readiness version package and candidate drift', () => {
	const mutations = [
		value => { value.publicationReady = true; },
		value => { value.registryVersionEligible = false; },
		value => { value.distTag = 'latest'; },
		value => { value.version = '1.1.0-rc.2'; },
		value => { value.githubReleaseTag = 'v1.1.0-rc.2'; },
		value => { value.packages.pop(); },
		value => { value.packages[0].releaseAsset = 'wrong.tgz'; },
		value => { value.packages[0].sha256 = 'A'.repeat(64); },
		value => { value.packages[0].bytes = 0; },
	];
	for (const mutate of mutations) {
		const value = manifest();
		mutate(value);
		assert.throws(() => ownership.validatePublicationManifestForOwnership(manifestBytes(value), {
			version: releaseVersion,
			publicationReady: false,
			distTag: 'next',
			packages: publicationPlan.packages,
		}));
	}
});

test('ownership report is exact identity-bound and deterministically re-derived', () => {
	const value = report();
	assert.doesNotThrow(() => ownership.validateNpmRegistryOwnershipReport(value, {
		publicationPlan,
		ownershipPolicy: configuredPolicy(),
		reviewedCommit,
		evidenceSetId,
		version: releaseVersion,
		publicationManifest: publicationManifestIdentity,
	}));
	const mutations = [
		reportValue => { reportValue.kind = 'self-attested'; },
		reportValue => { reportValue.collectorSource = 'self-attested'; },
		reportValue => { reportValue.collectorExecutionId = 'f'.repeat(64); },
		reportValue => { reportValue.reviewedCommit = 'b'.repeat(40); },
		reportValue => { reportValue.evidenceSetId = 'github-actions:32560000000:2'; },
		reportValue => { reportValue.version = '1.1.0-rc.2'; },
		reportValue => { reportValue.publicationManifest.sha256 = '2'.repeat(64); },
		reportValue => { reportValue.publicationManifest.bytes += 1; },
		reportValue => { reportValue.packages.reverse(); },
		reportValue => { reportValue.reasons = ['ownership-unknown']; },
		reportValue => { reportValue.unexpected = true; },
	];
	for (const mutate of mutations) {
		const changed = report();
		mutate(changed);
		assert.throws(() => ownership.validateNpmRegistryOwnershipReport(changed, {
			publicationPlan,
			ownershipPolicy: configuredPolicy(),
			reviewedCommit,
			evidenceSetId,
			version: releaseVersion,
			publicationManifest: publicationManifestIdentity,
		}));
	}
});

test('CLI surface exposes only exact commit and release version inputs', () => {
	assert.deepEqual(ownership.parseNpmRegistryOwnershipArguments([
		`--expected-commit=${reviewedCommit}`,
		`--version=${releaseVersion}`,
	]), { reviewedCommit, releaseVersion });
	for (const args of [
		['positional'],
		['--unknown=value'],
		['--version='],
		['--version=1.1.0', '--version=1.1.0-rc.1'],
		[`--evidence-set-id=${evidenceSetId}`],
		['--output=/tmp/forged.json'],
		['--observation=/tmp/forged.json'],
		['--run-command=fake'],
	]) {
		assert.throws(() => ownership.parseNpmRegistryOwnershipArguments(args));
	}
});

test('module exposes no report-to-passed-evidence converter', () => {
	assert.equal(Object.hasOwn(ownership, 'buildLiveRegistryOwnershipEvidence'), false);
	assert.equal(Object.hasOwn(ownership, 'buildRegistryOwnershipAuthorizationEvidence'), false);
});

test('production collector uses only bounded authenticated read commands and final source recheck', () => {
	const source = readFileSync(resolve('scripts/verify-npm-registry-ownership.mjs'), 'utf8');
	assert(source.includes("runNpmReadOnly(['whoami'])"));
	assert(source.includes("runNpmReadOnly(['team', 'ls', `${policy.scope}:developers`, '--json'])"));
	assert(source.includes("runNpmReadOnly(['access', 'list', 'packages', principal, '--json'])"));
	assert(source.includes('timeout: NPM_READ_TIMEOUT_MS'));
	assert.equal(source.includes('authority:'), false, 'serialized ownership report must not self-assert publication authority');
	for (const forbidden of [
		"runNpmReadOnly(['publish'",
		"runNpmReadOnly(['owner', 'add'",
		"runNpmReadOnly(['owner', 'rm'",
		"runNpmReadOnly(['access', 'grant'",
		"runNpmReadOnly(['access', 'revoke'",
		"runNpmReadOnly(['access', 'set'",
		"runNpmReadOnly(['team', 'create'",
		"runNpmReadOnly(['team', 'destroy'",
		"runNpmReadOnly(['team', 'add'",
		"runNpmReadOnly(['team', 'rm'",
		"runNpmReadOnly(['dist-tag'",
	]) assert.equal(source.includes(forbidden), false, `forbidden npm write boundary ${forbidden}`);

	const verifiedIndex = source.indexOf("if (report.state !== 'verified') return { report, evidence: null };");
	const finalCheckIndex = source.indexOf('verifyExactCleanCheckout(commit);', verifiedIndex + 1);
	const evidenceIndex = source.indexOf('const evidence = buildLiveRegistryOwnershipEvidence(report);', finalCheckIndex + 1);
	const catchIndex = source.indexOf('} catch (error) {', evidenceIndex + 1);
	const cleanupIndex = source.indexOf('await invalidateOutputs();', catchIndex + 1);
	assert(verifiedIndex >= 0 && verifiedIndex < finalCheckIndex);
	assert(finalCheckIndex < evidenceIndex);
	assert(evidenceIndex < catchIndex);
	assert(catchIndex < cleanupIndex);
});

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
