import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const POLICY_PATH = '.github/release/npm-publication-recovery-v1.json';
const PUBLICATION_PLAN_PATH = '.github/release/npm-publication-v1.json';
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
	assertExactKeys(observation, ['source', 'freshRequired', 'completePlannedPackageSetRequired', 'unknownAuthorizesWrites'], '$.observation');
	assert(observation.source === 'public-npm-registry', '$.observation.source', 'recovery must observe the public npm Registry');
	assert(observation.freshRequired === true, '$.observation.freshRequired', 'fresh Registry observation is required');
	assert(observation.completePlannedPackageSetRequired === true, '$.observation.completePlannedPackageSetRequired', 'the complete planned package set must be observed');
	assert(observation.unknownAuthorizesWrites === false, '$.observation.unknownAuthorizesWrites', 'unknown Registry state must not authorize writes');

	const preconditions = record(policy.writePreconditions, '$.writePreconditions');
	assertExactKeys(preconditions, ['publicationGateReadyRequired', 'exactReviewedReleaseIdentityRequired'], '$.writePreconditions');
	assert(preconditions.publicationGateReadyRequired === true, '$.writePreconditions.publicationGateReadyRequired', 'publication gate readiness is required before recovery writes');
	assert(preconditions.exactReviewedReleaseIdentityRequired === true, '$.writePreconditions.exactReviewedReleaseIdentityRequired', 'recovery writes must use the exact reviewed release identity');

	const packagePhase = record(policy.packageVersionPhase, '$.packageVersionPhase');
	assertExactKeys(packagePhase, ['identity', 'states', 'forbiddenRecovery'], '$.packageVersionPhase');
	assert(packagePhase.identity === 'publication-manifest-exact-candidate', '$.packageVersionPhase.identity', 'package identity must be the reviewed PUBLICATION-MANIFEST candidate');
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
	assertExactKeys(distTags, ['requiresAllPackageVersionsExact', 'canonicalStableTag', 'canonicalPrereleaseTag', 'nightlyTag', 'partialPromotionDecision', 'packageRepublishAllowed'], '$.distTagPhase');
	assert(distTags.requiresAllPackageVersionsExact === true, '$.distTagPhase.requiresAllPackageVersionsExact', 'all package versions must be exact before canonical tag promotion');
	assert(distTags.canonicalStableTag === 'latest', '$.distTagPhase.canonicalStableTag', 'stable recovery must converge to latest');
	assert(distTags.canonicalPrereleaseTag === 'next', '$.distTagPhase.canonicalPrereleaseTag', 'prerelease recovery must converge to next');
	assert(distTags.nightlyTag === null, '$.distTagPhase.nightlyTag', 'nightly npm tag promotion must remain disabled');
	assert(distTags.partialPromotionDecision === 'reobserve-and-converge-tags-only', '$.distTagPhase.partialPromotionDecision', 'partial canonical tag promotion must converge tags only');
	assert(distTags.packageRepublishAllowed === false, '$.distTagPhase.packageRepublishAllowed', 'tag recovery must never republish package versions');

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
		'permanently blocks reuse of that package version',
		'unknown state authorizes no writes',
		'dist-tag promotion',
		'reobserve and converge tags only',
		'public Registry verification',
	];
	const requiredJapanese = [
		'public npm Registryをfreshに観測',
		'exact subset',
		'未publishのreview済みcandidateだけ',
		'そのpackage versionの再利用を永久に禁止',
		'unknown状態はwriteを一切許可しない',
		'dist-tag promotion',
		'tagだけを再観測して収束',
		'public Registry verification',
	];
	for (const text of requiredEnglish) assert(english.includes(text), '$docs.en', `English recovery documentation is missing canonical phrase: ${text}`);
	for (const text of requiredJapanese) assert(japanese.includes(text), '$docs.ja', `Japanese recovery documentation is missing canonical phrase: ${text}`);
	assert(english.includes(policy.distTagPhase.canonicalStableTag) && english.includes(policy.distTagPhase.canonicalPrereleaseTag), '$docs.en', 'English docs must name canonical dist-tags');
	assert(japanese.includes(policy.distTagPhase.canonicalStableTag) && japanese.includes(policy.distTagPhase.canonicalPrereleaseTag), '$docs.ja', 'Japanese docs must name canonical dist-tags');
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
