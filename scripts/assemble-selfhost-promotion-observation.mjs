import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PROMOTION_OBSERVATION_OUTPUT = '.cache/selfhost-promotion-observation/observation.json';
export const PROMOTION_OBSERVATION_REPORT_SCHEMA_VERSION = 1;
const stage = 'required-selfhost';
const gitShaPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const runIdPattern = /^[1-9][0-9]*$/u;
const qualityEvidenceIds = new Set(['bootstrap-smoke','differential-smoke','format-check','type-check','unit-tests','binding-corpus','browser-integration','full-conformance','full-differential','fuzz-regression']);
const performanceBudget = Object.freeze({ coldBuildRatio: 1.25, editedRebuildRatio: 1.25, peakRssRatio: 1.5, artifactSizeRatio: 1.25, majorFixtureLatencyRatio: 1.5 });
const trustedObservationSource = Object.freeze({ repository: 'yaona807/virune', workflow: '.github/workflows/selfhost-promotion-observation.yml', ref: 'refs/heads/main' });
const root = fileURLToPath(new URL('..', import.meta.url));

export async function assembleSelfhostPromotionObservation({
	repositoryRoot = root,
	expectedCommit = process.env.GITHUB_SHA,
	runId = process.env.GITHUB_RUN_ID,
	eventName = process.env.GITHUB_EVENT_NAME,
	sourceWorkflowRef = process.env.GITHUB_WORKFLOW_REF,
	sourceFork = process.env.VIRUNE_PROMOTION_SOURCE_FORK,
	completedAt = new Date().toISOString(),
	releaseCorePath = '.cache/selfhost-promotion-observation/release-core.json',
	crossRunnerPath = '.cache/selfhost-promotion-observation/cross-runner.json',
	subjectPath = '.cache/selfhost-promotion-observation/promotion-subject.json',
	qualityPath = '.cache/selfhost-promotion-observation/quality.json',
	performancePath = '.cache/selfhost-promotion-observation/performance.json',
	policyPath = '.github/self-hosting/promotion-policy-v1.json',
	output = DEFAULT_PROMOTION_OBSERVATION_OUTPUT,
} = {}) {
	const commit = canonicalGitSha(expectedCommit, 'expectedCommit');
	const canonicalRun = canonicalRunId(runId, 'runId');
	if (eventName !== 'schedule' && eventName !== 'workflow_dispatch') throw new Error('eventName must be schedule or workflow_dispatch');
	const timestamp = canonicalTimestamp(completedAt, 'completedAt');
	const workflowSource = parseWorkflowRef(sourceWorkflowRef, 'sourceWorkflowRef');
	const source = {
		...workflowSource,
		eventName,
		fork: canonicalBoolean(sourceFork, 'sourceFork'),
	};
	const [releaseSource, crossSource, subjectSource, qualitySource, performanceSource, policySource] = await Promise.all([
		readEvidence(repositoryRoot, releaseCorePath), readEvidence(repositoryRoot, crossRunnerPath), readEvidence(repositoryRoot, subjectPath),
		readEvidence(repositoryRoot, qualityPath), readEvidence(repositoryRoot, performancePath), readEvidence(repositoryRoot, policyPath),
	]);
	const requiredEvidence = currentRequiredEvidence(policySource.value);
	const release = validateReleaseCore(releaseSource.value);
	const cross = validateCrossRunner(crossSource.value, commit);
	const [{ createPromotionSubjectManifest }, { evaluatePromotionObservationSourceV2 }] = await Promise.all([
		import('../packages/compiler/dist/src/selfhost/promotion-subject.js'),
		import('../packages/compiler/dist/src/selfhost/promotion-policy-replay-v2.js'),
	]);
	const subject = validateSubject(subjectSource.value, release, createPromotionSubjectManifest);
	const sourceEvaluation = evaluatePromotionObservationSourceV2(source, trustedObservationSource);
	const quality = validateQuality(qualitySource.value);
	const performance = validatePerformance(performanceSource.value);
	const evidenceById = new Map();
	for (const item of quality) addEvidence(evidenceById, item.id, item.status, item.sha256);
	addEvidence(evidenceById, 'performance-smoke', performance.status, domainHash('performance-smoke', performanceSource.sha256));
	addEvidence(evidenceById, 'performance-budget', performance.status, domainHash('performance-budget', performanceSource.sha256));
	const steps = new Map(release.steps.map(item => [item.id, item]));
	addEvidence(evidenceById, 'fixed-seed-verification', stepStatus(steps, 'seed-verify'), stepSha(steps, 'seed-verify'));
	addEvidence(evidenceById, 'clean-bootstrap', stepStatus(steps, 'clean-bootstrap'), stepSha(steps, 'clean-bootstrap'));
	addEvidence(evidenceById, 'legacy-rollback', stepStatus(steps, 'legacy-rollback'), stepSha(steps, 'legacy-rollback'));
	addEvidence(evidenceById, 'stage1-stage2-transition', stepStatus(steps, 'fixed-seed-bootstrap'), domainHash('stage1-stage2-transition', stepSha(steps, 'fixed-seed-bootstrap')));
	addEvidence(evidenceById, 'stage2-stage3-fixed-point', stepStatus(steps, 'fixed-seed-bootstrap'), domainHash('stage2-stage3-fixed-point', stepSha(steps, 'fixed-seed-bootstrap')));
	addEvidence(evidenceById, 'cross-evidence-generation-binding', 'passed', domainHash('cross-evidence-generation-binding', sha256(JSON.stringify(release.evidenceConsistency))));
	addEvidence(evidenceById, 'environment-perturbation', 'passed', domainHash('environment-perturbation', crossSource.sha256));
	addEvidence(evidenceById, 'independent-runner-reproducibility', 'passed', domainHash('independent-runner-reproducibility', crossSource.sha256));
	addEvidence(evidenceById, 'exact-head-evidence-binding', 'passed', domainHash('exact-head-evidence-binding', sha256(JSON.stringify({ expectedCommit: commit, repositoryCommit: cross.repositoryCommit, stage3Sha256: cross.candidateSha256 }))));
	const missing = requiredEvidence.filter(id => !evidenceById.has(id));
	const extra = [...evidenceById.keys()].filter(id => !requiredEvidence.includes(id));
	if (missing.length > 0 || extra.length > 0) throw new Error(`required-selfhost evidence contract mismatch; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`);
	const evidence = requiredEvidence.map(id => evidenceById.get(id));
	const productFailed = evidence.some(item => item.status === 'failed');
	const input = {
		version: 2, runId: canonicalRun, stage, executionCommit: commit, promotionSubjectId: subject.promotionSubjectId,
		completedAt: timestamp, outcome: productFailed ? 'product-failed' : 'passed', countsTowardPromotion: sourceEvaluation.countable,
		unexplainedDifferentials: 0, evidence,
	};
	const { createPromotionShadowHistoryV2 } = await import('../packages/compiler/dist/src/selfhost/promotion-shadow-history-v2.js');
	const canonical = createPromotionShadowHistoryV2({ version: 2, stage, entries: [input] }).history.entries[0];
	const observationSerialized = JSON.stringify(canonical);
	const report = {
		schemaVersion: PROMOTION_OBSERVATION_REPORT_SCHEMA_VERSION,
		claim: 'required-selfhost-promotion-observation',
		productionEligible: false,
		observationSha256: sha256(observationSerialized),
		observation: canonical,
	};
	const serialized = JSON.stringify(report);
	const target = resolve(repositoryRoot, output);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, serialized, 'utf8');
	return { report, observation: canonical, serialized, evidenceSha256: sha256(serialized), sourceEvaluation };
}

function currentRequiredEvidence(policy) {
	if (!isRecord(policy) || policy.schemaVersion !== 1 || policy.automaticPromotionAllowed !== false || !Array.isArray(policy.stages)) throw new Error('promotion policy root is invalid');
	const matches = policy.stages.filter(item => isRecord(item) && item.id === stage);
	if (matches.length !== 1) throw new Error('promotion policy must contain exactly one required-selfhost stage');
	const value = matches[0];
	if (value.blocking !== true || value.scope !== 'selfhost-related' || value.productionDefault !== false || !Array.isArray(value.requiredEvidence)) throw new Error('required-selfhost policy contract is invalid');
	const ids = value.requiredEvidence.map((id, index) => canonicalText(id, `requiredEvidence[${index}]`));
	if (new Set(ids).size !== ids.length) throw new Error('required-selfhost policy contains duplicate evidence IDs');
	return [...ids].sort(compareText);
}

function validateReleaseCore(value) {
	if (!isRecord(value) || value.schemaVersion !== 2 || value.claim !== 'selfhost-stable-release-gate-core' || value.productionEligible !== false || value.passed !== true || !Array.isArray(value.steps)) throw new Error('release-core is not a passing canonical release proof');
	validateSelfHash(value, 'release-core');
	if (value.evidenceConsistency?.checked !== true || value.evidenceConsistency?.passed !== true || !isRecord(value.evidenceConsistency.bindings)) throw new Error('release-core evidence consistency is not passing');
	for (const id of ['seed-verify','fixed-seed-bootstrap','clean-bootstrap','legacy-rollback']) {
		const matches = value.steps.filter(step => isRecord(step) && step.id === id);
		if (matches.length !== 1 || matches[0].passed !== true || matches[0].status !== 'pass') throw new Error(`release-core step ${id} is not passing`);
		canonicalSha(matches[0].evidenceSha256, `release-core.${id}.evidenceSha256`);
	}
	canonicalSha(value.evidenceConsistency.bindings.seedArtifactSha256, 'release-core.bindings.seedArtifactSha256');
	canonicalSha(value.evidenceConsistency.bindings.stage3Sha256, 'release-core.bindings.stage3Sha256');
	return value;
}

function validateCrossRunner(value, expectedCommit) {
	if (!isRecord(value) || value.schemaVersion !== 1 || value.claim !== 'selfhost-clean-bootstrap-cross-runner-reproducibility' || value.productionEligible !== false || value.status !== 'match' || value.equivalent !== true || value.independentRunCount !== 2) throw new Error('cross-runner evidence is not a passing independent reproducibility proof');
	validateSelfHash(value, 'cross-runner');
	if (value.repositoryCommit !== expectedCommit) throw new Error('cross-runner evidence is stale for the expected execution commit');
	canonicalSha(value.candidateSha256, 'cross-runner.candidateSha256');
	if (value.bootstrap?.stage3Sha256 !== value.candidateSha256 || value.bootstrap?.stage2Sha256 !== value.candidateSha256) throw new Error('cross-runner evidence does not prove the Stage2/Stage3 fixed point');
	return value;
}

function validateSubject(value, release, createPromotionSubjectManifest) {
	if (!isRecord(value) || value.schemaVersion !== 1 || value.claim !== 'required-selfhost-promotion-subject' || value.productionEligible !== false || value.stage !== stage || !isRecord(value.manifest)) throw new Error('promotion subject report is invalid');
	const canonicalManifest = createPromotionSubjectManifest(value.manifest);
	const promotionSubjectId = canonicalSha(value.promotionSubjectId, 'promotion-subject.promotionSubjectId');
	if (canonicalManifest.promotionSubjectId !== promotionSubjectId) throw new Error('promotion subject ID does not match its canonical manifest');
	const stage3 = canonicalSha(value.sources?.stage3Sha256, 'promotion-subject.sources.stage3Sha256');
	if (stage3 !== release.evidenceConsistency.bindings.stage3Sha256) throw new Error('promotion subject Stage3 identity disagrees with release-core');
	if (value.sources?.seedArtifactSha256 !== release.evidenceConsistency.bindings.seedArtifactSha256) throw new Error('promotion subject Seed identity disagrees with release-core');
	return { promotionSubjectId };
}

function validateQuality(value) {
	if (!isRecord(value) || value.schemaVersion !== 1 || value.claim !== 'required-selfhost-promotion-quality' || value.productionEligible !== false || !Array.isArray(value.evidence)) throw new Error('promotion quality report is invalid');
	const seen = new Set();
	const items = value.evidence.map((item, index) => {
		if (!isRecord(item)) throw new Error(`quality.evidence[${index}] must be an object`);
		const id = canonicalText(item.id, `quality.evidence[${index}].id`);
		if (!qualityEvidenceIds.has(id) || seen.has(id)) throw new Error(`unexpected or duplicate quality evidence ${id}`);
		seen.add(id);
		const status = item.status === 'passed' ? 'passed' : item.status === 'failed' ? 'failed' : null;
		if (status === null) throw new Error(`quality evidence ${id} status is invalid`);
		const claimed = canonicalSha(item.sha256, `quality.evidence.${id}.sha256`);
		const { sha256: _sha, ...record } = item;
		if (sha256(JSON.stringify(record)) !== claimed) throw new Error(`quality evidence ${id} self-hash is invalid`);
		return { id, status, sha256: claimed };
	});
	if (seen.size !== qualityEvidenceIds.size) throw new Error('promotion quality report is missing required quality evidence');
	const expectedStatus = items.every(item => item.status === 'passed') ? 'passed' : 'failed';
	if (value.status !== expectedStatus) throw new Error('promotion quality top-level status disagrees with evidence records');
	return items;
}

function validatePerformance(value) {
	if (!isRecord(value) || value.schemaVersion !== 1 || value.claim !== 'required-selfhost-relative-performance' || value.productionEligible !== false || value.incrementalCacheClaim !== false || value.editedRebuildProxy !== true) throw new Error('promotion performance report is invalid');
	if (JSON.stringify(value.budget) !== JSON.stringify(performanceBudget)) throw new Error('promotion performance budget does not match Gate D contract');
	if (!Number.isSafeInteger(value.samplesPerImplementation) || value.samplesPerImplementation <= 0 || !Array.isArray(value.fixtureIds) || value.fixtureIds.length === 0 || !Array.isArray(value.fixtures) || value.fixtures.length !== value.fixtureIds.length) throw new Error('promotion performance fixture/sample contract is invalid');
	for (let index = 0; index < value.fixtures.length; index += 1) {
		const record = value.fixtures[index];
		if (!isRecord(record) || record.fixtureId !== value.fixtureIds[index] || !isRecord(record.implementations?.legacy) || !isRecord(record.implementations?.selfhost) || !isRecord(record.ratios)) throw new Error(`promotion performance fixture ${index} is malformed`);
		const expected = ratios(record.implementations.legacy, record.implementations.selfhost);
		assertRatioRecord(record.ratios, expected, `fixtures[${index}].ratios`);
		const major = expected.coldBuild > performanceBudget.majorFixtureLatencyRatio || expected.editedRebuild > performanceBudget.majorFixtureLatencyRatio;
		if (record.majorRegression !== major) throw new Error(`promotion performance fixture ${index} majorRegression is inconsistent`);
	}
	if (!isRecord(value.aggregate?.legacy) || !isRecord(value.aggregate?.selfhost) || !isRecord(value.aggregate?.ratios)) throw new Error('promotion performance aggregate is malformed');
	const aggregateRatios = ratios(value.aggregate.legacy, value.aggregate.selfhost);
	assertRatioRecord(value.aggregate.ratios, aggregateRatios, 'aggregate.ratios');
	const passed = aggregateRatios.coldBuild <= performanceBudget.coldBuildRatio && aggregateRatios.editedRebuild <= performanceBudget.editedRebuildRatio && aggregateRatios.peakRss <= performanceBudget.peakRssRatio && aggregateRatios.artifactSize <= performanceBudget.artifactSizeRatio && value.fixtures.every(record => record.majorRegression === false);
	const expectedStatus = passed ? 'passed' : 'failed';
	if (value.status !== expectedStatus) throw new Error('promotion performance status disagrees with measured ratios');
	return { status: expectedStatus };
}

function ratios(legacy, selfhost) {
	for (const [label, value] of Object.entries({ ...legacy, ...selfhost })) if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`promotion performance metric ${label} is invalid`);
	return {
		coldBuild: ratio(selfhost.coldBuildMs, legacy.coldBuildMs), editedRebuild: ratio(selfhost.editedRebuildMs, legacy.editedRebuildMs),
		peakRss: ratio(selfhost.peakRssKb, legacy.peakRssKb), artifactSize: ratio(selfhost.artifactSizeBytes, legacy.artifactSizeBytes),
	};
}
function ratio(a,b) { return Number((a / b).toFixed(6)); }
function assertRatioRecord(actual, expected, label) { for (const key of Object.keys(expected)) if (actual[key] !== expected[key]) throw new Error(`${label}.${key} does not match measured summaries`); }
function validateSelfHash(value, label) { const claimed = canonicalSha(value.evidenceSha256, `${label}.evidenceSha256`); const { evidenceSha256: _sha, ...record } = value; if (sha256(JSON.stringify(record)) !== claimed) throw new Error(`${label} self-hash is invalid`); }
function stepStatus(steps, id) { return steps.get(id)?.passed === true && steps.get(id)?.status === 'pass' ? 'passed' : 'failed'; }
function stepSha(steps, id) { return canonicalSha(steps.get(id)?.evidenceSha256, `release-core.${id}.evidenceSha256`); }
function addEvidence(map, id, status, digest) { if (map.has(id)) throw new Error(`duplicate evidence ${id}`); map.set(id, { id, status, sha256: canonicalSha(digest, `${id}.sha256`) }); }
function domainHash(id, digest) { return sha256(JSON.stringify({ version: 1, id, sourceSha256: canonicalSha(digest, 'sourceSha256') })); }
async function readEvidence(repositoryRoot, path) { const bytes = await readFile(resolve(repositoryRoot, path)); let value; try { value = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error(`${path} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); } return { value, sha256: sha256(bytes) }; }
function canonicalGitSha(value, label) { if (typeof value !== 'string' || !gitShaPattern.test(value)) throw new Error(`${label} must be a lowercase 40-character Git SHA`); return value; }
function canonicalSha(value, label) { if (typeof value !== 'string' || !sha256Pattern.test(value)) throw new Error(`${label} must be a lowercase SHA-256`); return value; }
function canonicalRunId(value, label) { const text = typeof value === 'number' ? String(value) : value; if (typeof text !== 'string' || !runIdPattern.test(text)) throw new Error(`${label} must be a canonical positive decimal run ID`); return text; }
function canonicalTimestamp(value, label) { if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime()) || new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical UTC timestamp`); return value; }
function canonicalText(value, label) { if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new Error(`${label} must be a non-empty canonical string`); return value; }
function canonicalBoolean(value, label) { if (value === true || value === 'true') return true; if (value === false || value === 'false') return false; throw new Error(`${label} must be canonical boolean true or false`); }
function parseWorkflowRef(value, label) {
	const text = canonicalText(value, label);
	const separator = text.lastIndexOf('@');
	if (separator <= 0 || separator === text.length - 1) throw new Error(`${label} must contain a workflow path and ref separated by @`);
	const location = text.slice(0, separator);
	const ref = canonicalText(text.slice(separator + 1), `${label}.ref`);
	const marker = '/.github/workflows/';
	const markerIndex = location.indexOf(marker);
	if (markerIndex <= 0 || location.indexOf(marker, markerIndex + 1) !== -1) throw new Error(`${label} must identify exactly one .github/workflows path`);
	const repository = canonicalText(location.slice(0, markerIndex), `${label}.repository`);
	if (repository.split('/').length !== 2) throw new Error(`${label}.repository must be owner/repository`);
	const workflow = canonicalText(location.slice(markerIndex + 1), `${label}.workflow`);
	if (!/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(workflow)) throw new Error(`${label}.workflow must be a top-level GitHub Actions workflow YAML path`);
	return { repository, workflow, ref };
}
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function parseArguments(argumentsList) { const options = {}; for (const argument of argumentsList) { const [name,...rest] = argument.split('='); const value = rest.join('='); if (!name.startsWith('--') || value.length === 0) throw new Error(`Invalid argument: ${argument}`); const key = name.slice(2).replace(/-([a-z])/gu,(_,letter)=>letter.toUpperCase()); if (!['expectedCommit','runId','eventName','sourceWorkflowRef','sourceFork','releaseCorePath','crossRunnerPath','subjectPath','qualityPath','performancePath','policyPath','output'].includes(key)) throw new Error(`Unknown argument: ${name}`); options[key]=value; } return options; }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = await assembleSelfhostPromotionObservation(parseArguments(process.argv.slice(2)));
	console.log(JSON.stringify({ outcome: result.observation.outcome, countsTowardPromotion: result.observation.countsTowardPromotion, promotionSubjectId: result.observation.promotionSubjectId, evidenceSha256: result.evidenceSha256 }));
}
