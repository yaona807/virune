import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const POLICY_PATH = '.github/release/npm-publication-recovery-v1.json';
const PUBLICATION_PLAN_PATH = '.github/release/npm-publication-v1.json';
const REQUIRED_OBSERVED_IDENTITY = [
	'package-name',
	'package-version',
	'registry-dist-integrity',
	'downloaded-tarball-sha256',
	'source-repository',
	'source-commit',
	'provenance-workflow',
];
const IDENTITY_MATCH_RULES = {
	packageName: 'must-equal-publication-manifest-registry-name',
	packageVersion: 'must-equal-publication-manifest-version',
	registryDistIntegrity: 'must-verify-downloaded-tarball',
	downloadedTarballSha256: 'must-equal-publication-manifest-sha256',
	sourceRepository: 'must-equal-reviewed-repository',
	sourceCommit: 'must-equal-reviewed-release-commit',
	provenanceWorkflow: 'must-equal-approved-publication-workflow',
};
const OBSERVATION_FAILURE_DECISIONS = {
	stale: 'halt-and-reobserve',
	partial: 'halt-and-reobserve',
	malformed: 'halt-and-reobserve',
	unavailable: 'halt-and-reobserve',
	timeout: 'halt-and-reobserve',
	contradictory: 'halt-manual-investigation',
	unknown: 'halt-and-reobserve',
};
const EXPECTED_STATES = [
	['none-observed', 'publish-all-reviewed-candidates', 'planned-package-versions-only'],
	['exact-subset-observed', 'resume-missing-reviewed-candidates-only', 'missing-planned-package-versions-only'],
	['all-exact-observed', 'advance-to-dist-tag-phase', 'no-package-version-writes'],
	['identity-mismatch', 'block-version-permanently', 'none'],
	['unexpected-or-contradictory', 'halt-manual-investigation', 'none'],
	['unknown', 'halt-and-reobserve', 'none'],
];
const FORBIDDEN_RECOVERY = [
	'alternate-head-publication',
	'different-bytes-same-version',
	'rebuild-after-review',
	'unpublish-republish',
];

export function verifyNpmPublicationRecoveryPolicy(root = process.cwd()) {
	const policy = readJson(resolve(root, POLICY_PATH));
	const plan = readJson(resolve(root, PUBLICATION_PLAN_PATH));
	assertExactKeys(policy, ['schemaVersion', 'observation', 'writePreconditions', 'packageVersionPhase', 'distTagPhase', 'completion'], '$');
	assert(policy.schemaVersion === 1, '$.schemaVersion', 'expected schemaVersion 1');

	const observation = record(policy.observation, '$.observation');
	assertExactKeys(observation, ['source', 'freshRequired', 'completePlannedPackageSetRequired', 'failureDecisions', 'unknownAuthorizesWrites'], '$.observation');
	assert(observation.source === 'public-npm-registry', '$.observation.source', 'recovery must observe the public npm Registry');
	assert(observation.freshRequired === true, '$.observation.freshRequired', 'fresh Registry observation is required');
	assert(observation.completePlannedPackageSetRequired === true, '$.observation.completePlannedPackageSetRequired', 'the complete planned package set must be observed');
	const failureDecisions = record(observation.failureDecisions, '$.observation.failureDecisions');
	assertExactKeys(failureDecisions, Object.keys(OBSERVATION_FAILURE_DECISIONS), '$.observation.failureDecisions');
	for (const [key, expected] of Object.entries(OBSERVATION_FAILURE_DECISIONS)) {
		assert(failureDecisions[key] === expected, `$.observation.failureDecisions.${key}`, `expected ${expected}`);
	}
	assert(observation.unknownAuthorizesWrites === false, '$.observation.unknownAuthorizesWrites', 'unknown Registry state must not authorize writes');

	const preconditions = record(policy.writePreconditions, '$.writePreconditions');
	assertExactKeys(preconditions, ['publicationGateReadyRequired', 'exactReviewedReleaseIdentityRequired'], '$.writePreconditions');
	assert(preconditions.publicationGateReadyRequired === true, '$.writePreconditions.publicationGateReadyRequired', 'publication gate readiness is required before recovery writes');
	assert(preconditions.exactReviewedReleaseIdentityRequired === true, '$.writePreconditions.exactReviewedReleaseIdentityRequired', 'recovery writes must use the exact reviewed release identity');

	const packagePhase = record(policy.packageVersionPhase, '$.packageVersionPhase');
	assertExactKeys(packagePhase, ['identity', 'requiredObservedIdentity', 'identityMatchRules', 'states', 'forbiddenRecovery'], '$.packageVersionPhase');
	assert(packagePhase.identity === 'publication-manifest-exact-candidate', '$.packageVersionPhase.identity', 'package identity must be the reviewed PUBLICATION-MANIFEST candidate');
	const observedIdentity = array(packagePhase.requiredObservedIdentity, '$.packageVersionPhase.requiredObservedIdentity')
		.map((value, index) => nonEmptyString(value, `$.packageVersionPhase.requiredObservedIdentity[${index}]`));
	assert(
		JSON.stringify(observedIdentity) === JSON.stringify(REQUIRED_OBSERVED_IDENTITY),
		'$.packageVersionPhase.requiredObservedIdentity',
		`expected exact recovery identity dimensions ${REQUIRED_OBSERVED_IDENTITY.join(', ')}`,
	);
	const identityMatchRules = record(packagePhase.identityMatchRules, '$.packageVersionPhase.identityMatchRules');
	assertExactKeys(identityMatchRules, Object.keys(IDENTITY_MATCH_RULES), '$.packageVersionPhase.identityMatchRules');
	for (const [key, expected] of Object.entries(IDENTITY_MATCH_RULES)) {
		assert(identityMatchRules[key] === expected, `$.packageVersionPhase.identityMatchRules.${key}`, `expected ${expected}`);
	}
	const states = array(packagePhase.states, '$.packageVersionPhase.states').map((value, index) => recoveryState(value, `$.packageVersionPhase.states[${index}]`));
	assert(states.length === EXPECTED_STATES.length, '$.packageVersionPhase.states', `expected ${EXPECTED_STATES.length} canonical recovery states`);
	for (let index = 0; index < EXPECTED_STATES.length; index += 1) {
		const [state, decision, writes] = EXPECTED_STATES[index];
		const actual = states[index];
		assert(actual.state === state && actual.decision === decision && actual.writes === writes, `$.packageVersionPhase.states[${index}]`, `expected ${state}/${decision}/${writes}`);
	}
	const forbidden = array(packagePhase.forbiddenRecovery, '$.packageVersionPhase.forbiddenRecovery')
		.map((value, index) => nonEmptyString(value, `$.packageVersionPhase.forbiddenRecovery[${index}]`));
	assert(JSON.stringify(forbidden) === JSON.stringify(FORBIDDEN_RECOVERY), '$.packageVersionPhase.forbiddenRecovery', `expected ${FORBIDDEN_RECOVERY.join(', ')}`);

	const distTags = record(policy.distTagPhase, '$.distTagPhase');
	assertExactKeys(distTags, [
		'requiresAllPackageVersionsExact',
		'canonicalStableTag',
		'canonicalPrereleaseTag',
		'nightlyTag',
		'targetVersionOrdering',
		'canonicalTagDowngradeAllowed',
		'newerCanonicalTargetDecision',
		'unexpectedCanonicalTargetDecision',
		'partialPromotionDecision',
		'tagConvergenceIdempotentRequired',
		'packageRepublishAllowed',
	], '$.distTagPhase');
	assert(distTags.requiresAllPackageVersionsExact === true, '$.distTagPhase.requiresAllPackageVersionsExact', 'all package versions must be exact before canonical tag promotion');
	assert(distTags.canonicalStableTag === 'latest', '$.distTagPhase.canonicalStableTag', 'stable recovery must converge to latest');
	assert(distTags.canonicalPrereleaseTag === 'next', '$.distTagPhase.canonicalPrereleaseTag', 'prerelease recovery must converge to next');
	assert(distTags.nightlyTag === null, '$.distTagPhase.nightlyTag', 'nightly npm tag promotion must remain disabled');
	assert(distTags.targetVersionOrdering === 'semver-precedence', '$.distTagPhase.targetVersionOrdering', 'canonical tag recovery must use SemVer precedence');
	assert(distTags.canonicalTagDowngradeAllowed === false, '$.distTagPhase.canonicalTagDowngradeAllowed', 'canonical tag recovery must never downgrade to an older release');
	assert(distTags.newerCanonicalTargetDecision === 'halt-stale-recovery', '$.distTagPhase.newerCanonicalTargetDecision', 'a newer canonical tag target must halt stale recovery');
	assert(distTags.unexpectedCanonicalTargetDecision === 'halt-manual-investigation', '$.distTagPhase.unexpectedCanonicalTargetDecision', 'an unexpected canonical tag target must halt for investigation');
	assert(distTags.partialPromotionDecision === 'reobserve-and-converge-tags-only', '$.distTagPhase.partialPromotionDecision', 'partial canonical tag promotion must converge tags only');
	assert(distTags.tagConvergenceIdempotentRequired === true, '$.distTagPhase.tagConvergenceIdempotentRequired', 'canonical tag convergence must be idempotent');
	assert(distTags.packageRepublishAllowed === false, '$.distTagPhase.packageRepublishAllowed', 'tag recovery must never republish package versions');

	const completion = record(policy.completion, '$.completion');
	assertExactKeys(completion, ['publicRegistryVerificationRequired'], '$.completion');
	assert(completion.publicRegistryVerificationRequired === true, '$.completion.publicRegistryVerificationRequired', 'public Registry verification is required before completion');
	assert(plan.publicVerificationRequired === true, '$publicationPlan.publicVerificationRequired', 'publication plan must continue requiring public verification');
	assert(plan.publicationReady === false, '$publicationPlan.publicationReady', 'recovery policy must not enable npm publication');
	assert(!array(plan.unresolvedRequirements, '$publicationPlan.unresolvedRequirements').includes('recovery-policy'), '$publicationPlan.unresolvedRequirements', 'recovery-policy blocker must be removed once this contract is canonical');

	return policy;
}

function recoveryState(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['state', 'decision', 'writes'], path);
	return {
		state: nonEmptyString(item.state, `${path}.state`),
		decision: nonEmptyString(item.decision, `${path}.decision`),
		writes: nonEmptyString(item.writes, `${path}.writes`),
	};
}
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function nonEmptyString(value, path) { assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty string'); return value; }
function array(value, path) { assert(Array.isArray(value), path, 'expected an array'); return value; }
function record(value, path) { assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object'); return value; }
function assertExactKeys(value, expected, path) {
	const actual = Object.keys(record(value, path)).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(wanted), path, `expected keys ${wanted.join(', ')}`);
}
function assert(condition, path, message) { if (!condition) throw new Error(`${path}: ${message}`); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

const argvPath = process.argv[1];
if (argvPath !== undefined && import.meta.url === pathToFileURL(resolve(argvPath)).href) {
	verifyNpmPublicationRecoveryPolicy();
	process.stdout.write('Verified npm publication recovery policy.\n');
}
