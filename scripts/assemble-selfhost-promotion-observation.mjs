import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMOTION_QUALITY_COMMANDS } from './run-selfhost-promotion-quality.mjs';

export const DEFAULT_PROMOTION_OBSERVATION_OUTPUT = '.cache/selfhost-promotion-observation/observation.json';
export const PROMOTION_OBSERVATION_REPORT_SCHEMA_VERSION = 1;
const stage = 'required-selfhost';
const gitShaPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const runIdPattern = /^[1-9][0-9]*$/u;
const qualityEvidenceIds = new Set(PROMOTION_QUALITY_COMMANDS.map(group => group.id));
const performanceBudget = Object.freeze({ coldBuildRatio: 1.25, editedRebuildRatio: 1.25, peakRssRatio: 1.5, artifactSizeRatio: 1.25, majorFixtureLatencyRatio: 1.5 });
const performanceSamplesPerImplementation = 5;
const performanceFixtureLimit = 5;
const releaseStepIds = Object.freeze(['seed-verify','fixed-seed-bootstrap','clean-bootstrap','legacy-rollback']);
const trustedObservationSource = Object.freeze({ repository: 'yaona807/virune', workflow: '.github/workflows/selfhost-promotion-observation.yml', ref: 'refs/heads/main', eventName: 'schedule' });
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
	const [releaseSource, crossSource, subjectSource, qualitySource, performanceSource, policySource, performanceCorpusSource] = await Promise.all([
		readEvidence(repositoryRoot, releaseCorePath), readEvidence(repositoryRoot, crossRunnerPath), readEvidence(repositoryRoot, subjectPath),
		readEvidence(repositoryRoot, qualityPath), readEvidence(repositoryRoot, performancePath), readEvidence(repositoryRoot, policyPath),
		readEvidence(repositoryRoot, '.github/self-hosting/differential-corpus-v1.json'),
	]);
	const requiredEvidence = currentRequiredEvidence(policySource.value);
	const release = validateReleaseCore(releaseSource.value);
	const cross = validateCrossRunner(crossSource.value, commit, release);
	const [{ createPromotionSubjectManifest }, promotionPolicy] = await Promise.all([
		import('../packages/compiler/dist/src/selfhost/promotion-subject.js'),
		import('../packages/compiler/dist/src/selfhost/promotion-policy-replay-v2.js'),
	]);
	const subject = validateSubject(subjectSource.value, release, releaseSource.sha256, createPromotionSubjectManifest);
	const sourceEvaluation = promotionPolicy.evaluatePromotionObservationSourceV2(source, trustedObservationSource);
	const quality = validateQuality(qualitySource.value);
	const performance = validatePerformance(performanceSource.value, expectedPerformanceFixtureIds(performanceCorpusSource.value));
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
	promotionPolicy.replayPromotionHistoryAgainstPolicyV2(policySource.value, stage, { version: 2, stage, entries: [canonical] });
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
	if (!isRecord(value)) throw new Error('release-core is not a passing canonical release proof');
	exactKeys(value, ['schemaVersion','claim','productionEligible','checkedAt','policy','steps','evidenceConsistency','passed','evidenceSha256'], 'release-core report');
	if (value.schemaVersion !== 2 || value.claim !== 'selfhost-stable-release-gate-core' || value.productionEligible !== false || value.passed !== true || !Array.isArray(value.steps)) throw new Error('release-core is not a passing canonical release proof');
	canonicalTimestamp(value.checkedAt, 'release-core.checkedAt');
	validateReleasePolicy(value.policy);
	if (value.steps.length !== releaseStepIds.length) throw new Error('release-core must contain exactly four canonical required steps');
	for (let index = 0; index < releaseStepIds.length; index += 1) {
		const step = value.steps[index];
		const id = releaseStepIds[index];
		const label = `release-core.steps[${index}]`;
		if (!isRecord(step)) throw new Error(`${label} must be an object`);
		exactKeys(step, ['id','exitCode','stdoutSha256','stderrSha256','status','passed','evidenceSha256'], label);
		if (step.id !== id || step.exitCode !== 0 || step.status !== 'pass' || step.passed !== true) throw new Error(`release-core step ${id} is not a canonical passing step`);
		canonicalSha(step.stdoutSha256, `${label}.stdoutSha256`);
		canonicalSha(step.stderrSha256, `${label}.stderrSha256`);
		canonicalSha(step.evidenceSha256, `${label}.evidenceSha256`);
	}
	if (!isRecord(value.evidenceConsistency)) throw new Error('release-core evidence consistency is malformed');
	exactKeys(value.evidenceConsistency, ['checked','passed','bindings'], 'release-core evidenceConsistency');
	if (value.evidenceConsistency.checked !== true || value.evidenceConsistency.passed !== true || !isRecord(value.evidenceConsistency.bindings)) throw new Error('release-core evidence consistency is not passing');
	exactKeys(value.evidenceConsistency.bindings, ['seedArtifactSha256','seedManifestSha256','stage1Sha256','stage2Sha256','stage3Sha256'], 'release-core evidenceConsistency.bindings');
	for (const id of ['seedArtifactSha256','seedManifestSha256','stage1Sha256','stage2Sha256','stage3Sha256']) {
		canonicalSha(value.evidenceConsistency.bindings[id], `release-core.bindings.${id}`);
	}
	validateSelfHash(value, 'release-core');
	return value;
}

function validateReleasePolicy(value) {
	if (!isRecord(value)) throw new Error('release-core policy is malformed');
	exactKeys(value, ['version','failClosed','requiredSteps','fixedPoint','cleanBootstrap','evidenceConsistency','productionDefaultChange'], 'release-core policy');
	if (value.version !== 1 || value.failClosed !== true || value.productionDefaultChange !== false) throw new Error('release-core policy is not canonical');
	if (!Array.isArray(value.requiredSteps) || JSON.stringify(value.requiredSteps) !== JSON.stringify(releaseStepIds)) throw new Error('release-core policy requiredSteps are not canonical');
	if (!isRecord(value.fixedPoint)) throw new Error('release-core policy fixedPoint is malformed');
	exactKeys(value.fixedPoint, ['from','to','requireEquivalent','requireShaEquality','differenceCount'], 'release-core policy.fixedPoint');
	if (value.fixedPoint.from !== 'stage2' || value.fixedPoint.to !== 'stage3' || value.fixedPoint.requireEquivalent !== true || value.fixedPoint.requireShaEquality !== true || value.fixedPoint.differenceCount !== 0) throw new Error('release-core fixed-point policy is not canonical');
	if (!isRecord(value.cleanBootstrap)) throw new Error('release-core policy cleanBootstrap is malformed');
	exactKeys(value.cleanBootstrap, ['dependencyMode'], 'release-core policy.cleanBootstrap');
	if (value.cleanBootstrap.dependencyMode !== 'offline') throw new Error('release-core clean-bootstrap policy is not canonical');
	if (!isRecord(value.evidenceConsistency)) throw new Error('release-core policy evidenceConsistency is malformed');
	exactKeys(value.evidenceConsistency, ['required'], 'release-core policy.evidenceConsistency');
	if (value.evidenceConsistency.required !== true) throw new Error('release-core evidence-consistency policy is not canonical');
}

function validateCrossRunner(value, expectedCommit, release) {
	if (!isRecord(value)) throw new Error('cross-runner evidence is not a passing independent reproducibility proof');
	exactKeys(value, ['schemaVersion','claim','productionEligible','status','equivalent','independentRunCount','repositoryCommit','candidateSha256','lockfileSha256','seed','bootstrap','profiles','evidenceSha256'], 'cross-runner evidence');
	if (value.schemaVersion !== 1 || value.claim !== 'selfhost-clean-bootstrap-cross-runner-reproducibility' || value.productionEligible !== false || value.status !== 'match' || value.equivalent !== true || value.independentRunCount !== 2) throw new Error('cross-runner evidence is not a passing independent reproducibility proof');
	validateSelfHash(value, 'cross-runner');
	const repositoryCommit = canonicalGitSha(value.repositoryCommit, 'cross-runner.repositoryCommit');
	if (repositoryCommit !== expectedCommit) throw new Error('cross-runner evidence is stale for the expected execution commit');
	const candidateSha256 = canonicalSha(value.candidateSha256, 'cross-runner.candidateSha256');
	canonicalSha(value.lockfileSha256, 'cross-runner.lockfileSha256');
	if (!isRecord(value.seed)) throw new Error('cross-runner seed evidence is malformed');
	exactKeys(value.seed, ['manifestSha256','artifactSha256'], 'cross-runner seed');
	const seedManifestSha256 = canonicalSha(value.seed.manifestSha256, 'cross-runner.seed.manifestSha256');
	const seedArtifactSha256 = canonicalSha(value.seed.artifactSha256, 'cross-runner.seed.artifactSha256');
	if (!isRecord(value.bootstrap)) throw new Error('cross-runner bootstrap evidence is malformed');
	exactKeys(value.bootstrap, ['seedSha256','stage1Sha256','stage2Sha256','stage3Sha256'], 'cross-runner bootstrap');
	const bootstrapSeedSha256 = canonicalSha(value.bootstrap.seedSha256, 'cross-runner.bootstrap.seedSha256');
	const stage1Sha256 = canonicalSha(value.bootstrap.stage1Sha256, 'cross-runner.bootstrap.stage1Sha256');
	const stage2Sha256 = canonicalSha(value.bootstrap.stage2Sha256, 'cross-runner.bootstrap.stage2Sha256');
	const stage3Sha256 = canonicalSha(value.bootstrap.stage3Sha256, 'cross-runner.bootstrap.stage3Sha256');
	if (bootstrapSeedSha256 !== seedArtifactSha256) throw new Error('cross-runner bootstrap Seed identity disagrees with verified Seed identity');
	if (stage2Sha256 !== stage3Sha256 || stage3Sha256 !== candidateSha256) throw new Error('cross-runner evidence does not prove the Stage2/Stage3 fixed point');
	const releaseBindings = release.evidenceConsistency.bindings;
	for (const [label, left, right] of [
		['Seed artifact', seedArtifactSha256, releaseBindings.seedArtifactSha256],
		['Seed manifest', seedManifestSha256, releaseBindings.seedManifestSha256],
		['Stage1', stage1Sha256, releaseBindings.stage1Sha256],
		['Stage2', stage2Sha256, releaseBindings.stage2Sha256],
		['Stage3', stage3Sha256, releaseBindings.stage3Sha256],
	]) {
		if (left !== right) throw new Error(`cross-runner evidence generation mismatch: ${label}`);
	}
	if (!Array.isArray(value.profiles) || value.profiles.length !== 2) throw new Error('cross-runner profiles must contain exactly baseline and perturbed evidence');
	const profiles = value.profiles.map((profile, index) => validateCrossRunnerProfile(profile, index));
	if (JSON.stringify(profiles.map(profile => profile.profile)) !== JSON.stringify(['baseline','perturbed'])) throw new Error('cross-runner profiles must be ordered baseline then perturbed');
	if (['timezone','locale','homeVariant','tempVariant'].every(field => profiles[0][field] === profiles[1][field])) throw new Error('cross-runner environment perturbation dimensions did not actually differ');
	return { ...value, repositoryCommit, candidateSha256, profiles };
}

function validateCrossRunnerProfile(value, index) {
	const label = `cross-runner.profiles[${index}]`;
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	exactKeys(value, ['profile','timezone','locale','homeVariant','tempVariant','evidenceSha256'], label);
	const profile = canonicalText(value.profile, `${label}.profile`);
	if (profile !== 'baseline' && profile !== 'perturbed') throw new Error(`${label}.profile must be baseline or perturbed`);
	return {
		profile,
		timezone: canonicalText(value.timezone, `${label}.timezone`),
		locale: canonicalText(value.locale, `${label}.locale`),
		homeVariant: canonicalText(value.homeVariant, `${label}.homeVariant`),
		tempVariant: canonicalText(value.tempVariant, `${label}.tempVariant`),
		evidenceSha256: canonicalSha(value.evidenceSha256, `${label}.evidenceSha256`),
	};
}

function validateSubject(value, release, releaseCoreSha256, createPromotionSubjectManifest) {
	if (!isRecord(value)) throw new Error('promotion subject report is invalid');
	exactKeys(value, ['schemaVersion','claim','productionEligible','stage','promotionSubjectId','manifest','sources'], 'promotion subject report');
	if (value.schemaVersion !== 1 || value.claim !== 'required-selfhost-promotion-subject' || value.productionEligible !== false || value.stage !== stage || !isRecord(value.manifest) || !isRecord(value.sources)) throw new Error('promotion subject report is invalid');
	exactKeys(value.sources, ['releaseCoreSha256','seedManifestSha256','seedArtifactSha256','stage3Sha256','runtimeAbi'], 'promotion subject sources');
	const canonicalManifest = createPromotionSubjectManifest(value.manifest);
	const promotionSubjectId = canonicalSha(value.promotionSubjectId, 'promotion-subject.promotionSubjectId');
	if (canonicalManifest.promotionSubjectId !== promotionSubjectId) throw new Error('promotion subject ID does not match its canonical manifest');
	const releaseCore = canonicalSha(value.sources.releaseCoreSha256, 'promotion-subject.sources.releaseCoreSha256');
	if (releaseCore !== releaseCoreSha256) throw new Error('promotion subject release-core identity disagrees with assembled release-core evidence');
	const seedManifest = canonicalSha(value.sources.seedManifestSha256, 'promotion-subject.sources.seedManifestSha256');
	if (seedManifest !== release.evidenceConsistency.bindings.seedManifestSha256) throw new Error('promotion subject Seed manifest identity disagrees with release-core');
	const seedArtifact = canonicalSha(value.sources.seedArtifactSha256, 'promotion-subject.sources.seedArtifactSha256');
	if (seedArtifact !== release.evidenceConsistency.bindings.seedArtifactSha256) throw new Error('promotion subject Seed identity disagrees with release-core');
	const stage3 = canonicalSha(value.sources.stage3Sha256, 'promotion-subject.sources.stage3Sha256');
	if (stage3 !== release.evidenceConsistency.bindings.stage3Sha256) throw new Error('promotion subject Stage3 identity disagrees with release-core');
	const runtimeAbi = canonicalText(value.sources.runtimeAbi, 'promotion-subject.sources.runtimeAbi');
	const runtimeAbiSha256 = sha256(JSON.stringify({ version: 1, claim: 'virune-runtime-abi', value: runtimeAbi }));
	const runtimeAbiComponent = canonicalManifest.manifest.components.find(item => item.id === 'runtime-abi');
	if (runtimeAbiComponent?.sha256 !== runtimeAbiSha256) throw new Error('promotion subject Runtime ABI source disagrees with its canonical manifest component');
	return { promotionSubjectId };
}

function validateQuality(value) {
	if (!isRecord(value)) throw new Error('promotion quality report is invalid');
	exactKeys(value, ['schemaVersion','claim','productionEligible','status','evidence'], 'promotion quality report');
	if (value.schemaVersion !== 1 || value.claim !== 'required-selfhost-promotion-quality' || value.productionEligible !== false || !Array.isArray(value.evidence)) throw new Error('promotion quality report is invalid');
	if (value.evidence.length !== PROMOTION_QUALITY_COMMANDS.length) throw new Error('promotion quality report has a non-canonical evidence count');
	const items = value.evidence.map((item, index) => {
		const expectedGroup = PROMOTION_QUALITY_COMMANDS[index];
		const path = `quality.evidence[${index}]`;
		if (!isRecord(item)) throw new Error(`${path} must be an object`);
		exactKeys(item, ['version','id','status','executions','sha256'], path);
		if (item.version !== 1 || item.id !== expectedGroup.id || !qualityEvidenceIds.has(item.id)) throw new Error(`${path} does not match the canonical quality evidence order`);
		const status = item.status === 'passed' ? 'passed' : item.status === 'failed' ? 'failed' : null;
		if (status === null) throw new Error(`quality evidence ${item.id} status is invalid`);
		validateQualityExecutions(item.executions, expectedGroup.commands, status, item.id);
		const claimed = canonicalSha(item.sha256, `quality.evidence.${item.id}.sha256`);
		const { sha256: _sha, ...record } = item;
		if (sha256(JSON.stringify(record)) !== claimed) throw new Error(`quality evidence ${item.id} self-hash is invalid`);
		return { id: item.id, status, sha256: claimed };
	});
	const expectedStatus = items.every(item => item.status === 'passed') ? 'passed' : 'failed';
	if (value.status !== expectedStatus) throw new Error('promotion quality top-level status disagrees with evidence records');
	return items;
}

function validateQualityExecutions(value, expectedCommands, status, id) {
	if (!Array.isArray(value)) throw new Error(`quality evidence ${id} executions must be an array`);
	const expectedLength = expectedCommands.length;
	if (status === 'passed' && value.length !== expectedLength) throw new Error(`passing quality evidence ${id} must retain every command execution`);
	if (status === 'failed' && (value.length < 1 || value.length > expectedLength)) throw new Error(`failed quality evidence ${id} must retain a non-empty command prefix`);
	for (let index = 0; index < value.length; index += 1) {
		const execution = value[index];
		const expected = expectedCommands[index];
		const path = `quality.evidence.${id}.executions[${index}]`;
		if (!isRecord(execution)) throw new Error(`${path} must be an object`);
		exactKeys(execution, ['command','environment','nonzeroExitClassification','exitCode','signal','errorSha256','infrastructureFailed','passed','stdoutSha256','stderrSha256'], path);
		exactStringArray(execution.command, expected.argv, `${path}.command`);
		exactEnvironment(execution.environment, expected.environment, `${path}.environment`);
		if (execution.nonzeroExitClassification !== expected.nonzeroExitClassification) throw new Error(`${path}.nonzeroExitClassification does not match the canonical command contract`);
		if (execution.infrastructureFailed !== false || execution.signal !== null || execution.errorSha256 !== null) throw new Error(`${path} contains infrastructure-failure evidence and cannot support product attribution`);
		canonicalSha(execution.stdoutSha256, `${path}.stdoutSha256`);
		canonicalSha(execution.stderrSha256, `${path}.stderrSha256`);
		const finalFailedExecution = status === 'failed' && index === value.length - 1;
		if (finalFailedExecution) {
			if (expected.nonzeroExitClassification !== 'product-failed') throw new Error(`${path} is not attributable product-failure evidence`);
			if (!Number.isSafeInteger(execution.exitCode) || execution.exitCode === 0 || execution.passed !== false) throw new Error(`${path} must contain a non-zero attributable product exit`);
		} else if (execution.exitCode !== 0 || execution.passed !== true) {
			throw new Error(`${path} must be a successful preceding execution`);
		}
	}
}

function exactStringArray(value, expected, label) {
	if (!Array.isArray(value) || value.length !== expected.length) throw new Error(`${label} does not match the canonical command`);
	for (let index = 0; index < expected.length; index += 1) if (value[index] !== expected[index]) throw new Error(`${label} does not match the canonical command`);
}

function exactEnvironment(value, expected, label) {
	if (!isRecord(value)) throw new Error(`${label} must be an object`);
	const expectedEntries = Object.entries(expected).sort(([left], [right]) => compareText(left, right));
	const expectedKeys = expectedEntries.map(([key]) => key);
	if (JSON.stringify(Object.keys(value)) !== JSON.stringify(expectedKeys)) throw new Error(`${label} does not match the canonical environment`);
	for (const [key, expectedValue] of expectedEntries) if (value[key] !== expectedValue) throw new Error(`${label}.${key} does not match the canonical environment`);
}

function expectedPerformanceFixtureIds(corpus) {
	if (!isRecord(corpus) || corpus.schemaVersion !== 1 || !Array.isArray(corpus.fixtures)) throw new Error('differential corpus schema is invalid for performance evidence');
	const ids = corpus.fixtures
		.filter(fixture => isRecord(fixture) && Array.isArray(fixture.tags) && fixture.tags.includes('project') && (fixture.expectedDivergences ?? []).length === 0)
		.map((fixture, index) => canonicalText(fixture.id, `differentialCorpus.fixtures[${index}].id`))
		.sort(compareText)
		.slice(0, performanceFixtureLimit);
	if (ids.length === 0) throw new Error('no non-divergent project differential fixtures are available for performance evidence');
	if (new Set(ids).size !== ids.length) throw new Error('performance fixture selection contains duplicate fixture IDs');
	return ids;
}

function validatePerformance(value, expectedFixtureIds) {
	if (!isRecord(value)) throw new Error('promotion performance report is invalid');
	exactKeys(value, ['schemaVersion','claim','productionEligible','incrementalCacheClaim','editedRebuildProxy','budget','fixtureIds','samplesPerImplementation','fixtures','aggregate','status'], 'promotion performance report');
	if (value.schemaVersion !== 1 || value.claim !== 'required-selfhost-relative-performance' || value.productionEligible !== false || value.incrementalCacheClaim !== false || value.editedRebuildProxy !== true) throw new Error('promotion performance report is invalid');
	if (!isRecord(value.budget)) throw new Error('promotion performance budget is malformed');
	exactKeys(value.budget, ['coldBuildRatio','editedRebuildRatio','peakRssRatio','artifactSizeRatio','majorFixtureLatencyRatio'], 'promotion performance budget');
	if (JSON.stringify(value.budget) !== JSON.stringify(performanceBudget)) throw new Error('promotion performance budget does not match Gate D contract');
	if (value.samplesPerImplementation !== performanceSamplesPerImplementation) throw new Error(`promotion performance must retain exactly ${performanceSamplesPerImplementation} samples per implementation`);
	if (!Array.isArray(value.fixtureIds) || JSON.stringify(value.fixtureIds) !== JSON.stringify(expectedFixtureIds)) throw new Error('promotion performance fixture IDs do not match the canonical differential-corpus selection');
	if (!Array.isArray(value.fixtures) || value.fixtures.length !== expectedFixtureIds.length) throw new Error('promotion performance fixture contract is invalid');
	const validatedFixtures = [];
	for (let index = 0; index < value.fixtures.length; index += 1) {
		const record = value.fixtures[index];
		if (!isRecord(record)) throw new Error(`promotion performance fixture ${index} is malformed`);
		exactKeys(record, ['fixtureId','implementations','ratios','majorRegression'], `promotion performance fixture ${index}`);
		if (record.fixtureId !== expectedFixtureIds[index] || !isRecord(record.implementations)) throw new Error(`promotion performance fixture ${index} is malformed`);
		exactKeys(record.implementations, ['legacy','selfhost'], `promotion performance fixture ${index}.implementations`);
		const legacy = exactPerformanceSummary(record.implementations.legacy, `promotion performance fixture ${index}.implementations.legacy`);
		const selfhost = exactPerformanceSummary(record.implementations.selfhost, `promotion performance fixture ${index}.implementations.selfhost`);
		const expected = ratios(legacy, selfhost);
		assertRatioRecord(record.ratios, expected, `fixtures[${index}].ratios`);
		const major = !withinRatio(selfhost.coldBuildMs, legacy.coldBuildMs, performanceBudget.majorFixtureLatencyRatio)
			|| !withinRatio(selfhost.editedRebuildMs, legacy.editedRebuildMs, performanceBudget.majorFixtureLatencyRatio);
		if (record.majorRegression !== major) throw new Error(`promotion performance fixture ${index} majorRegression is inconsistent`);
		validatedFixtures.push({ legacy, selfhost, majorRegression: major });
	}
	if (!isRecord(value.aggregate)) throw new Error('promotion performance aggregate is malformed');
	exactKeys(value.aggregate, ['legacy','selfhost','ratios'], 'promotion performance aggregate');
	const aggregateLegacy = exactPerformanceSummary(value.aggregate.legacy, 'promotion performance aggregate.legacy');
	const aggregateSelfhost = exactPerformanceSummary(value.aggregate.selfhost, 'promotion performance aggregate.selfhost');
	assertPerformanceSummary(aggregateLegacy, summarizePerformanceFixtures(validatedFixtures, 'legacy'), 'promotion performance aggregate.legacy');
	assertPerformanceSummary(aggregateSelfhost, summarizePerformanceFixtures(validatedFixtures, 'selfhost'), 'promotion performance aggregate.selfhost');
	const aggregateRatios = ratios(aggregateLegacy, aggregateSelfhost);
	assertRatioRecord(value.aggregate.ratios, aggregateRatios, 'aggregate.ratios');
	const passed = performanceSummariesWithinBudget(aggregateLegacy, aggregateSelfhost)
		&& validatedFixtures.every(record => record.majorRegression === false);
	const expectedStatus = passed ? 'passed' : 'failed';
	if (value.status !== expectedStatus) throw new Error('promotion performance status disagrees with measured ratios');
	return { status: expectedStatus };
}

function exactPerformanceSummary(value, label) {
	if (!isRecord(value)) throw new Error(`${label} is malformed`);
	const keys = ['coldBuildMs','editedRebuildMs','peakRssKb','artifactSizeBytes'];
	exactKeys(value, keys, label);
	for (const key of keys) if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] <= 0) throw new Error(`${label}.${key} must be a positive finite number`);
	return value;
}

function summarizePerformanceFixtures(fixtures, implementation) {
	return {
		coldBuildMs: median(fixtures.map(record => record[implementation].coldBuildMs)),
		editedRebuildMs: median(fixtures.map(record => record[implementation].editedRebuildMs)),
		peakRssKb: median(fixtures.map(record => record[implementation].peakRssKb)),
		artifactSizeBytes: median(fixtures.map(record => record[implementation].artifactSizeBytes)),
	};
}
function performanceSummariesWithinBudget(legacy, selfhost) {
	return withinRatio(selfhost.coldBuildMs, legacy.coldBuildMs, performanceBudget.coldBuildRatio)
		&& withinRatio(selfhost.editedRebuildMs, legacy.editedRebuildMs, performanceBudget.editedRebuildRatio)
		&& withinRatio(selfhost.peakRssKb, legacy.peakRssKb, performanceBudget.peakRssRatio)
		&& withinRatio(selfhost.artifactSizeBytes, legacy.artifactSizeBytes, performanceBudget.artifactSizeRatio);
}
function withinRatio(numerator, denominator, limit) { return numerator <= denominator * limit; }
function median(values) { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function assertPerformanceSummary(actual, expected, label) { for (const key of Object.keys(expected)) if (actual[key] !== expected[key]) throw new Error(`${label}.${key} does not match fixture median`); }
function ratios(legacy, selfhost) {
	return {
		coldBuild: ratio(selfhost.coldBuildMs, legacy.coldBuildMs), editedRebuild: ratio(selfhost.editedRebuildMs, legacy.editedRebuildMs),
		peakRss: ratio(selfhost.peakRssKb, legacy.peakRssKb), artifactSize: ratio(selfhost.artifactSizeBytes, legacy.artifactSizeBytes),
	};
}
function ratio(a,b) { return Number((a / b).toFixed(6)); }
function assertRatioRecord(actual, expected, label) {
	if (!isRecord(actual)) throw new Error(`${label} is malformed`);
	exactKeys(actual, Object.keys(expected), label);
	for (const key of Object.keys(expected)) if (actual[key] !== expected[key]) throw new Error(`${label}.${key} does not match measured summaries`);
}
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
function exactKeys(value, expected, label) { const actual = Object.keys(value).sort(compareText); const wanted = [...expected].sort(compareText); if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} must contain exactly keys ${wanted.join(', ')}`); }
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
