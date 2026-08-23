import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assembleSelfhostPromotionObservation } from './assemble-selfhost-promotion-observation.mjs';
import { PROMOTION_QUALITY_COMMANDS } from './run-selfhost-promotion-quality.mjs';

const commit = '1'.repeat(40);
const digest = character => character.repeat(64);
const requiredEvidence = [
	'bootstrap-smoke','differential-smoke','format-check','performance-smoke','type-check','unit-tests','binding-corpus','browser-integration','clean-bootstrap','cross-evidence-generation-binding','environment-perturbation','exact-head-evidence-binding','fixed-seed-verification','full-conformance','full-differential','fuzz-regression','independent-runner-reproducibility','legacy-rollback','performance-budget','stage1-stage2-transition','stage2-stage3-fixed-point',
];
const qualityCommandsById = new Map(PROMOTION_QUALITY_COMMANDS.map(group => [group.id, group]));
const canonicalWorkflowRef = 'yaona807/virune/.github/workflows/selfhost-promotion-observation.yml@refs/heads/main';

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function withSelfHash(record) { return { ...record, evidenceSha256: sha(JSON.stringify(record)) }; }
function canonicalEnvironment(environment) { return Object.fromEntries(Object.entries(environment).sort(([left],[right]) => left < right ? -1 : left > right ? 1 : 0)); }
function qualityExecution(commandSpec, { passed = true } = {}) {
	return {
		command: [...commandSpec.argv],
		environment: canonicalEnvironment(commandSpec.environment),
		nonzeroExitClassification: commandSpec.nonzeroExitClassification,
		exitCode: passed ? 0 : 1,
		signal: null,
		errorSha256: null,
		infrastructureFailed: false,
		passed,
		stdoutSha256: sha(`stdout:${commandSpec.argv.join(' ')}`),
		stderrSha256: sha(`stderr:${commandSpec.argv.join(' ')}`),
	};
}
function qualityItem(group) {
	const record = { version: 1, id: group.id, status: 'passed', executions: group.commands.map(commandSpec => qualityExecution(commandSpec)) };
	return { ...record, sha256: sha(JSON.stringify(record)) };
}

async function makeFixture() {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-observation-v1-gated-'));
	await mkdir(join(root, '.github', 'self-hosting'), { recursive: true });
	const seed = digest('a');
	const stage3 = digest('b');
	const seedManifestSha256 = digest('e');
	const step = id => ({ id, exitCode: 0, stdoutSha256: digest('c'), stderrSha256: digest('d'), status: 'pass', passed: true, evidenceSha256: sha(`step:${id}`) });
	const releaseRecord = {
		schemaVersion: 2,
		claim: 'selfhost-stable-release-gate-core',
		productionEligible: false,
		checkedAt: '2026-08-20T01:00:00.000Z',
		policy: {
			version: 1,
			failClosed: true,
			requiredSteps: ['seed-verify','fixed-seed-bootstrap','clean-bootstrap','legacy-rollback'],
			fixedPoint: { from: 'stage2', to: 'stage3', requireEquivalent: true, requireShaEquality: true, differenceCount: 0 },
			cleanBootstrap: { dependencyMode: 'offline' },
			evidenceConsistency: { required: true },
			productionDefaultChange: false,
		},
		steps: ['seed-verify','fixed-seed-bootstrap','clean-bootstrap','legacy-rollback'].map(step),
		evidenceConsistency: { checked: true, passed: true, bindings: { seedArtifactSha256: seed, seedManifestSha256, stage1Sha256: digest('f'), stage2Sha256: stage3, stage3Sha256: stage3 } },
		passed: true,
	};
	const release = withSelfHash(releaseRecord);
	const cross = withSelfHash({
		schemaVersion: 1,
		claim: 'selfhost-clean-bootstrap-cross-runner-reproducibility',
		productionEligible: false,
		status: 'match',
		equivalent: true,
		independentRunCount: 2,
		repositoryCommit: commit,
		candidateSha256: stage3,
		lockfileSha256: digest('1'),
		seed: { manifestSha256: seedManifestSha256, artifactSha256: seed },
		bootstrap: { seedSha256: seed, stage1Sha256: digest('f'), stage2Sha256: stage3, stage3Sha256: stage3 },
		profiles: [
			{ profile:'baseline', timezone:'UTC', locale:'C.UTF-8', homeVariant:'host-default', tempVariant:'host-default', evidenceSha256:digest('2') },
			{ profile:'perturbed', timezone:'Asia/Tokyo', locale:'C', homeVariant:'isolated-home', tempVariant:'isolated-temp', evidenceSha256:digest('3') },
		],
	});
	const runtimeAbi = 'virune-runtime@1';
	const { createPromotionSubjectManifest } = await import('../packages/compiler/dist/src/selfhost/promotion-subject.js');
	const componentIds = ['bootstrap-policy','fixed-seed','runtime-abi','runtime-artifact','selfhost-host-contract','selfhost-stage3','stdlib-artifact'];
	const manifestResult = createPromotionSubjectManifest({
		version: 2,
		stage: 'required-selfhost',
		components: componentIds.map((id, index) => ({
			id,
			sha256: id === 'fixed-seed' ? seed : id === 'runtime-abi'
				? sha(JSON.stringify({ version: 1, claim: 'virune-runtime-abi', value: runtimeAbi }))
				: id === 'selfhost-stage3' ? stage3 : digest(String((index + 2) % 10)),
		})),
	});
	const subject = {
		schemaVersion: 1,
		claim: 'required-selfhost-promotion-subject',
		productionEligible: false,
		stage: 'required-selfhost',
		promotionSubjectId: manifestResult.promotionSubjectId,
		manifest: manifestResult.manifest,
		sources: {
			releaseCoreSha256: sha(JSON.stringify(release)),
			seedManifestSha256,
			seedArtifactSha256: seed,
			stage3Sha256: stage3,
			runtimeAbi,
		},
	};
	const qualityEvidence = PROMOTION_QUALITY_COMMANDS.map(qualityItem);
	const quality = { schemaVersion: 1, claim: 'required-selfhost-promotion-quality', productionEligible: false, status: 'passed', evidence: qualityEvidence };
	const legacy = { coldBuildMs: 100, editedRebuildMs: 100, peakRssKb: 1000, artifactSizeBytes: 1000 };
	const selfhost = { coldBuildMs: 120, editedRebuildMs: 120, peakRssKb: 1400, artifactSizeBytes: 1200 };
	const ratio = (a,b) => Number((a/b).toFixed(6));
	const ratios = { coldBuild: ratio(selfhost.coldBuildMs, legacy.coldBuildMs), editedRebuild: ratio(selfhost.editedRebuildMs, legacy.editedRebuildMs), peakRss: ratio(selfhost.peakRssKb, legacy.peakRssKb), artifactSize: ratio(selfhost.artifactSizeBytes, legacy.artifactSizeBytes) };
	const performance = {
		schemaVersion: 1,
		claim: 'required-selfhost-relative-performance',
		productionEligible: false,
		incrementalCacheClaim: false,
		editedRebuildProxy: true,
		budget: { coldBuildRatio:1.25, editedRebuildRatio:1.25, peakRssRatio:1.5, artifactSizeRatio:1.25, majorFixtureLatencyRatio:1.5 },
		fixtureIds:['fixture'],
		samplesPerImplementation:5,
		fixtures:[{ fixtureId:'fixture', implementations:{legacy,selfhost}, ratios, majorRegression:false }],
		aggregate:{legacy,selfhost,ratios},
		status:'failed',
	};
	const policy = {
		schemaVersion:1,
		automaticPromotionAllowed:false,
		stages:[{
			id:'required-selfhost', blocking:true, scope:'selfhost-related', productionDefault:false, requiredEvidence,
			promotionRequirements:{ minimumConsecutiveSuccessfulRuns:14, minimumObservationDays:14, maximumUnexplainedDifferentials:0, manualApprovalRequired:true, rollbackEvidenceRequired:false, minimumStableReleaseCycles:0 },
		}],
	};
	for (const [name, value] of Object.entries({ release, cross, subject, quality, performance, policy })) await writeFile(join(root, `${name}.json`), JSON.stringify(value), 'utf8');
	await writeFile(join(root, '.github', 'self-hosting', 'differential-corpus-v1.json'), JSON.stringify({ schemaVersion:1, fixtures:[{ id:'fixture', tags:['project'], expectedDivergences:[] }] }), 'utf8');
	return { root, async cleanup() { await rm(root, { recursive:true, force:true }); } };
}
function options(fixture) {
	return {
		repositoryRoot:fixture.root,
		expectedCommit:commit,
		runId:'100',
		eventName:'schedule',
		sourceWorkflowRef:canonicalWorkflowRef,
		sourceFork:false,
		completedAt:'2026-08-20T02:00:00.000Z',
		releaseCorePath:'release.json',
		crossRunnerPath:'cross.json',
		subjectPath:'subject.json',
		qualityPath:'quality.json',
		performancePath:'performance.json',
		policyPath:'policy.json',
		output:'observation.json',
	};
}

test('schema v1 edited-rebuild proxy is canonical product-failed evidence even when numeric ratios are within budget', async () => {
	const fixture = await makeFixture();
	try {
		const result = await assembleSelfhostPromotionObservation(options(fixture));
		assert.equal(result.observation.outcome, 'product-failed');
		assert.equal(result.observation.countsTowardPromotion, true);
		assert.equal(result.observation.evidence.find(item => item.id === 'performance-smoke').status, 'failed');
		assert.equal(result.observation.evidence.find(item => item.id === 'performance-budget').status, 'failed');
		assert.equal(result.report.productionEligible, false);
	} finally { await fixture.cleanup(); }
});

test('schema v1 rejects an asserted incremental-cache claim without a reviewed incremental evidence schema', async () => {
	const fixture = await makeFixture();
	try {
		const performancePath = join(fixture.root, 'performance.json');
		const performance = JSON.parse(await readFile(performancePath, 'utf8'));
		performance.incrementalCacheClaim = true;
		performance.editedRebuildProxy = false;
		performance.status = 'passed';
		await writeFile(performancePath, JSON.stringify(performance), 'utf8');
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture)),
			/schema v1 must remain an edited-rebuild proxy without incremental-cache claim/u,
		);
		await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
	} finally { await fixture.cleanup(); }
});

test('schema v1 rejects a forged passing top-level performance status', async () => {
	const fixture = await makeFixture();
	try {
		const performancePath = join(fixture.root, 'performance.json');
		const performance = JSON.parse(await readFile(performancePath, 'utf8'));
		performance.status = 'passed';
		await writeFile(performancePath, JSON.stringify(performance), 'utf8');
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture)),
			/schema v1 cannot pass Gate D without real incremental evidence/u,
		);
	} finally { await fixture.cleanup(); }
});
