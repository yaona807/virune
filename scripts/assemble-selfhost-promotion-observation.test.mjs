import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assembleSelfhostPromotionObservation } from './assemble-selfhost-promotion-observation.mjs';

const commit = '1'.repeat(40);
const digest = character => character.repeat(64);
const requiredEvidence = [
	'bootstrap-smoke','differential-smoke','format-check','performance-smoke','type-check','unit-tests','binding-corpus','browser-integration','clean-bootstrap','cross-evidence-generation-binding','environment-perturbation','exact-head-evidence-binding','fixed-seed-verification','full-conformance','full-differential','fuzz-regression','independent-runner-reproducibility','legacy-rollback','performance-budget','stage1-stage2-transition','stage2-stage3-fixed-point',
];
const qualityIds = ['bootstrap-smoke','differential-smoke','format-check','type-check','unit-tests','binding-corpus','browser-integration','full-conformance','full-differential','fuzz-regression'];
const canonicalWorkflowRef = 'yaona807/virune/.github/workflows/selfhost-promotion-observation.yml@refs/heads/main';

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function withSelfHash(record) { return { ...record, evidenceSha256: sha(JSON.stringify(record)) }; }
function qualityItem(id, status = 'passed') { const record = { version: 1, id, status, executions: [] }; return { ...record, sha256: sha(JSON.stringify(record)) }; }

async function makeFixture({ qualityFailure = null, performanceStatus = 'passed', staleCommit = false } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-observation-'));
	await mkdir(join(root, '.cache'), { recursive: true });
	const seed = digest('a');
	const stage3 = digest('b');
	const step = id => ({ id, status: 'pass', passed: true, evidenceSha256: sha(`step:${id}`), exitCode: 0, stdoutSha256: digest('c'), stderrSha256: digest('d') });
	const releaseRecord = {
		schemaVersion: 2, claim: 'selfhost-stable-release-gate-core', productionEligible: false, checkedAt: '2026-08-20T01:00:00.000Z', policy: {},
		steps: ['seed-verify','fixed-seed-bootstrap','clean-bootstrap','legacy-rollback'].map(step),
		evidenceConsistency: { checked: true, passed: true, bindings: { seedArtifactSha256: seed, seedManifestSha256: digest('e'), stage1Sha256: digest('f'), stage2Sha256: stage3, stage3Sha256: stage3 } },
		passed: true,
	};
	const release = withSelfHash(releaseRecord);
	const crossRecord = {
		schemaVersion: 1, claim: 'selfhost-clean-bootstrap-cross-runner-reproducibility', productionEligible: false, status: 'match', equivalent: true, independentRunCount: 2,
		repositoryCommit: staleCommit ? '2'.repeat(40) : commit, candidateSha256: stage3, lockfileSha256: digest('1'), seed: { manifestSha256: digest('e'), artifactSha256: seed }, bootstrap: { seedSha256: seed, stage1Sha256: digest('f'), stage2Sha256: stage3, stage3Sha256: stage3 }, profiles: [],
	};
	const cross = withSelfHash(crossRecord);
	const { createPromotionSubjectManifest } = await import('../packages/compiler/dist/src/selfhost/promotion-subject.js');
	const componentIds = ['bootstrap-policy','fixed-seed','runtime-abi','runtime-artifact','selfhost-host-contract','selfhost-stage3','stdlib-artifact'];
	const manifestResult = createPromotionSubjectManifest({ version: 2, stage: 'required-selfhost', components: componentIds.map((id, index) => ({ id, sha256: id === 'fixed-seed' ? seed : id === 'selfhost-stage3' ? stage3 : digest(String((index + 2) % 10)) })) });
	const subject = { schemaVersion: 1, claim: 'required-selfhost-promotion-subject', productionEligible: false, stage: 'required-selfhost', promotionSubjectId: manifestResult.promotionSubjectId, manifest: manifestResult.manifest, sources: { stage3Sha256: stage3, seedArtifactSha256: seed } };
	const qualityEvidence = qualityIds.map(id => qualityItem(id, id === qualityFailure ? 'failed' : 'passed'));
	const quality = { schemaVersion: 1, claim: 'required-selfhost-promotion-quality', productionEligible: false, status: qualityFailure === null ? 'passed' : 'failed', evidence: qualityEvidence };
	const legacy = { coldBuildMs: 100, editedRebuildMs: 100, peakRssKb: 1000, artifactSizeBytes: 1000 };
	const selfhost = performanceStatus === 'passed'
		? { coldBuildMs: 120, editedRebuildMs: 120, peakRssKb: 1400, artifactSizeBytes: 1200 }
		: { coldBuildMs: 130, editedRebuildMs: 130, peakRssKb: 1600, artifactSizeBytes: 1300 };
	const ratio = (a,b) => Number((a/b).toFixed(6));
	const ratios = { coldBuild: ratio(selfhost.coldBuildMs, legacy.coldBuildMs), editedRebuild: ratio(selfhost.editedRebuildMs, legacy.editedRebuildMs), peakRss: ratio(selfhost.peakRssKb, legacy.peakRssKb), artifactSize: ratio(selfhost.artifactSizeBytes, legacy.artifactSizeBytes) };
	const performance = { schemaVersion: 1, claim: 'required-selfhost-relative-performance', productionEligible: false, incrementalCacheClaim: false, editedRebuildProxy: true, budget: { coldBuildRatio:1.25, editedRebuildRatio:1.25, peakRssRatio:1.5, artifactSizeRatio:1.25, majorFixtureLatencyRatio:1.5 }, fixtureIds:['fixture'], samplesPerImplementation:5, fixtures:[{ fixtureId:'fixture', implementations:{legacy,selfhost}, ratios, majorRegression:ratios.coldBuild>1.5||ratios.editedRebuild>1.5 }], aggregate:{legacy,selfhost,ratios}, status:performanceStatus };
	const policy = { schemaVersion:1, automaticPromotionAllowed:false, stages:[{ id:'required-selfhost', blocking:true, scope:'selfhost-related', productionDefault:false, requiredEvidence }] };
	for (const [name, value] of Object.entries({ release, cross, subject, quality, performance, policy })) await writeFile(join(root, `${name}.json`), JSON.stringify(value), 'utf8');
	return { root, subject, async cleanup(){ await rm(root,{recursive:true,force:true}); } };
}

function options(fixture, overrides = {}) {
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
		...overrides,
	};
}

test('assembles a passing canonical scheduled observation in a non-promotable report', async () => {
	const fixture = await makeFixture();
	try {
		const result = await assembleSelfhostPromotionObservation(options(fixture));
		assert.equal(result.observation.outcome, 'passed');
		assert.equal(result.observation.countsTowardPromotion, true);
		assert.deepEqual(result.sourceEvaluation.reasons, []);
		assert.equal(result.observation.unexplainedDifferentials, 0);
		assert.equal(result.observation.evidence.length, requiredEvidence.length);
		assert.deepEqual(result.observation.evidence.map(item=>item.id), [...requiredEvidence].sort());
		assert.equal(result.report.schemaVersion,1);
		assert.equal(result.report.claim,'required-selfhost-promotion-observation');
		assert.equal(result.report.productionEligible,false);
		assert.equal(result.report.observationSha256,sha(JSON.stringify(result.observation)));
		assert.deepEqual(result.report.observation,result.observation);
		assert.equal(await readFile(join(fixture.root,'observation.json'),'utf8'), result.serialized);
		assert.deepEqual(JSON.parse(result.serialized),result.report);
	} finally { await fixture.cleanup(); }
});

test('manual dispatch produces equivalent evidence but is non-counting', async () => {
	const fixture = await makeFixture();
	try {
		const result = await assembleSelfhostPromotionObservation(options(fixture,{eventName:'workflow_dispatch'}));
		assert.equal(result.observation.countsTowardPromotion,false);
		assert.deepEqual(result.sourceEvaluation.reasons,['event-not-schedule']);
	} finally { await fixture.cleanup(); }
});

test('scheduled observations from a fork or wrong workflow ref repository, path, or ref are non-counting', async () => {
	const cases = [
		[{sourceFork:true}, 'fork-source'],
		[{sourceWorkflowRef:'someone/virune/.github/workflows/selfhost-promotion-observation.yml@refs/heads/main'}, 'repository-mismatch'],
		[{sourceWorkflowRef:'yaona807/virune/.github/workflows/other.yml@refs/heads/main'}, 'workflow-mismatch'],
		[{sourceWorkflowRef:'yaona807/virune/.github/workflows/selfhost-promotion-observation.yml@refs/heads/other'}, 'ref-mismatch'],
	];
	for (const [override, reason] of cases) {
		const fixture = await makeFixture();
		try {
			const result = await assembleSelfhostPromotionObservation(options(fixture,override));
			assert.equal(result.observation.countsTowardPromotion,false);
			assert.ok(result.sourceEvaluation.reasons.includes(reason));
		} finally { await fixture.cleanup(); }
	}
});

test('malformed workflow ref fails closed instead of falling back to display-name trust', async () => {
	const fixture = await makeFixture();
	try {
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture,{sourceWorkflowRef:'Self-host promotion observation'})),
			/workflow path and ref separated by @/u,
		);
	} finally { await fixture.cleanup(); }
});

test('known quality failure becomes product-failed without fabricating unexplained differential count', async () => {
	const fixture = await makeFixture({ qualityFailure:'format-check' });
	try {
		const result = await assembleSelfhostPromotionObservation(options(fixture));
		assert.equal(result.observation.outcome,'product-failed');
		assert.equal(result.observation.unexplainedDifferentials,0);
		assert.equal(result.observation.evidence.find(item=>item.id==='format-check').status,'failed');
		assert.equal(result.report.productionEligible,false);
	} finally { await fixture.cleanup(); }
});

test('infrastructure-classified quality evidence cannot be converted into product failure or a canonical observation', async () => {
	const fixture = await makeFixture();
	try {
		const quality = JSON.parse(await readFile(join(fixture.root,'quality.json'),'utf8'));
		quality.evidence[0] = qualityItem(quality.evidence[0].id,'infrastructure-failed');
		quality.status = 'infrastructure-failed';
		await writeFile(join(fixture.root,'quality.json'),JSON.stringify(quality),'utf8');
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture)),
			/quality evidence .* status is invalid/u,
		);
		await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
	} finally { await fixture.cleanup(); }
});

test('known performance budget failure becomes product-failed', async () => {
	const fixture = await makeFixture({ performanceStatus:'failed' });
	try { assert.equal((await assembleSelfhostPromotionObservation(options(fixture))).observation.outcome,'product-failed'); }
	finally { await fixture.cleanup(); }
});

test('stale exact-head evidence fails closed without an observation', async () => {
	const fixture = await makeFixture({ staleCommit:true });
	try { await assert.rejects(()=>assembleSelfhostPromotionObservation(options(fixture)),/stale for the expected execution commit/u); }
	finally { await fixture.cleanup(); }
});

test('forged subject identity and forged performance status are rejected', async () => {
	const fixture = await makeFixture();
	try {
		const subject = JSON.parse(await readFile(join(fixture.root,'subject.json'),'utf8'));
		subject.promotionSubjectId = digest('9');
		await writeFile(join(fixture.root,'subject.json'),JSON.stringify(subject));
		await assert.rejects(()=>assembleSelfhostPromotionObservation(options(fixture)),/does not match its canonical manifest/u);
		await writeFile(join(fixture.root,'subject.json'),JSON.stringify(fixture.subject));
		const performance = JSON.parse(await readFile(join(fixture.root,'performance.json'),'utf8'));
		performance.status = 'failed';
		await writeFile(join(fixture.root,'performance.json'),JSON.stringify(performance));
		await assert.rejects(()=>assembleSelfhostPromotionObservation(options(fixture)),/status disagrees with measured ratios/u);
	} finally { await fixture.cleanup(); }
});
