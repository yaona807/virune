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
	['all-exact-observed', 'complete-package-version-publication', 'none'],
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
	assertExactKeys(policy, ['schemaVersion', 'observation', 'writePreconditions', 'packageVersionPhase', 'distTagPolicy', 'completion'], '$');
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

	const distTags = record(policy.distTagPolicy, '$.distTagPolicy');
	assertExactKeys(distTags, [
		'application',
		'canonicalStableTag',
		'canonicalPrereleaseTag',
		'nightlyTag',
		'dependencySafeOrderRequired',
		'cliLastRequired',
		'targetVersionOrdering',
		'canonicalTagDowngradeAllowed',
		'separateDistTagMutationAllowed',
		'traditionalTokenTagRepairAllowed',
		'incompatibleExistingTagDecision',
	], '$.distTagPolicy');
	assert(distTags.application === 'npm-publish-tag', '$.distTagPolicy.application', 'canonical tags must be applied by npm publish');
	assert(distTags.canonicalStableTag === 'latest', '$.distTagPolicy.canonicalStableTag', 'stable publication must use latest');
	assert(distTags.canonicalPrereleaseTag === 'next', '$.distTagPolicy.canonicalPrereleaseTag', 'prerelease publication must use next');
	assert(distTags.nightlyTag === null, '$.distTagPolicy.nightlyTag', 'nightly npm publication must remain disabled');
	assert(distTags.dependencySafeOrderRequired === true, '$.distTagPolicy.dependencySafeOrderRequired', 'dependency-safe publication order is required');
	assert(distTags.cliLastRequired === true, '$.distTagPolicy.cliLastRequired', 'virune CLI must publish last');
	assert(distTags.targetVersionOrdering === 'semver-precedence', '$.distTagPolicy.targetVersionOrdering', 'canonical tag safety must use SemVer precedence');
	assert(distTags.canonicalTagDowngradeAllowed === false, '$.distTagPolicy.canonicalTagDowngradeAllowed', 'canonical tags must never be moved backward');
	assert(distTags.separateDistTagMutationAllowed === false, '$.distTagPolicy.separateDistTagMutationAllowed', 'normal Trusted Publishing must not require a separate dist-tag mutation');
	assert(distTags.traditionalTokenTagRepairAllowed === false, '$.distTagPolicy.traditionalTokenTagRepairAllowed', 'normal recovery must not fall back to a traditional token for tag repair');
	assert(distTags.incompatibleExistingTagDecision === 'halt-manual-investigation', '$.distTagPolicy.incompatibleExistingTagDecision', 'incompatible existing canonical tag state must halt');
	assert(plan.distTagPolicy?.stable === distTags.canonicalStableTag, '$publicationPlan.distTagPolicy.stable', 'stable dist-tag policy drift');
	assert(plan.distTagPolicy?.prerelease === distTags.canonicalPrereleaseTag, '$publicationPlan.distTagPolicy.prerelease', 'prerelease dist-tag policy drift');
	assert(plan.distTagPolicy?.nightly === distTags.nightlyTag, '$publicationPlan.distTagPolicy.nightly', 'nightly dist-tag policy drift');

	const completion = record(policy.completion, '$.completion');
	assertExactKeys(completion, ['publicRegistryVerificationRequired'], '$.completion');
	assert(completion.publicRegistryVerificationRequired === true, '$.completion.publicRegistryVerificationRequired', 'public Registry verification is required before completion');
	assert(plan.publicVerificationRequired === true, '$publicationPlan.publicVerificationRequired', 'publication plan must continue requiring public verification');
	assert(plan.publicationReady === false, '$publicationPlan.publicationReady', 'recovery policy must not enable npm publication');
	assert(!array(plan.unresolvedRequirements, '$publicationPlan.unresolvedRequirements').includes('recovery-policy'), '$publicationPlan.unresolvedRequirements', 'recovery-policy blocker must be removed once this contract is canonical');

	return policy;
}

export function verifyNpmPublicationRecoveryDocumentation(policy, english, japanese) {
	const requiredEnglish = [
		'fresh public npm Registry observation',
		'exact subset',
		'missing reviewed candidates only',
		'registry `dist.integrity`',
		'downloaded tarball SHA-256',
		'source repository, source commit, and provenance workflow',
		'permanently blocks reuse of that package version',
		'unknown state authorizes no writes',
		'`npm publish --tag`',
		'dependency-safe order',
		'CLI last',
		'SemVer precedence',
		'never moves a canonical tag backward',
		'does not use a separate `npm dist-tag` mutation',
		'traditional token fallback',
		'public Registry verification',
	];
	const requiredJapanese = [
		'public npm Registryをfreshに観測',
		'exact subset',
		'未publishのreview済みcandidateだけ',
		'Registryの`dist.integrity`',
		'downloadしたtarballのSHA-256',
		'source repository・source commit・provenance workflow',
		'そのpackage versionの再利用を永久に禁止',
		'unknown状態はwriteを一切許可しない',
		'`npm publish --tag`',
		'dependency-safeな順序',
		'CLIを最後',
		'SemVer precedence',
		'canonical tagを過去versionへ巻き戻さない',
		'別の`npm dist-tag` mutationを使わない',
		'traditional token fallback',
		'public Registry verification',
	];
	for (const text of requiredEnglish) assert(english.includes(text), '$docs.en', `English recovery documentation is missing canonical phrase: ${text}`);
	for (const text of requiredJapanese) assert(japanese.includes(text), '$docs.ja', `Japanese recovery documentation is missing canonical phrase: ${text}`);
	assert(english.includes(policy.distTagPolicy.canonicalStableTag) && english.includes(policy.distTagPolicy.canonicalPrereleaseTag), '$docs.en', 'English docs must name canonical dist-tags');
	assert(japanese.includes(policy.distTagPolicy.canonicalStableTag) && japanese.includes(policy.distTagPolicy.canonicalPrereleaseTag), '$docs.ja', 'Japanese docs must name canonical dist-tags');
	return true;
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
