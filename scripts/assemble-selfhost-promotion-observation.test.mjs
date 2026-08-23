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
const qualityIds = PROMOTION_QUALITY_COMMANDS.map(group => group.id);
const qualityCommandsById = new Map(PROMOTION_QUALITY_COMMANDS.map(group => [group.id, group]));
const canonicalWorkflowRef = 'yaona807/virune/.github/workflows/selfhost-promotion-observation.yml@refs/heads/main';

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function withSelfHash(record) { return { ...record, evidenceSha256: sha(JSON.stringify(record)) }; }
function rehashSelfHash(value) { const { evidenceSha256: _sha, ...record } = value; return withSelfHash(record); }
function canonicalEnvironment(environment) { return Object.fromEntries(Object.entries(environment).sort(([left],[right]) => left < right ? -1 : left > right ? 1 : 0)); }
function qualityExecution(commandSpec, { passed = true, infrastructureFailed = false } = {}) {
	return {
		command: [...commandSpec.argv],
		environment: canonicalEnvironment(commandSpec.environment),
		nonzeroExitClassification: commandSpec.nonzeroExitClassification,
		exitCode: infrastructureFailed ? null : passed ? 0 : 1,
		signal: null,
		errorSha256: infrastructureFailed ? sha('spawn infrastructure failure') : null,
		infrastructureFailed,
		passed: !infrastructureFailed && passed,
		stdoutSha256: sha(`stdout:${commandSpec.argv.join(' ')}`),
		stderrSha256: sha(`stderr:${commandSpec.argv.join(' ')}`),
	};
}
function qualityItem(id, status = 'passed') {
	const group = qualityCommandsById.get(id);
	if (group === undefined) throw new Error(`unknown quality fixture ${id}`);
	let executions;
	if (status === 'passed') {
		executions = group.commands.map(commandSpec => qualityExecution(commandSpec));
	} else if (status === 'failed') {
		const failureIndex = group.commands.findIndex(commandSpec => commandSpec.nonzeroExitClassification === 'product-failed');
		if (failureIndex < 0) throw new Error(`quality fixture ${id} has no attributable product-failure command`);
		executions = group.commands.slice(0, failureIndex + 1).map((commandSpec, index) => qualityExecution(commandSpec, { passed: index < failureIndex }));
	} else if (status === 'infrastructure-failed') {
		executions = [qualityExecution(group.commands[0], { infrastructureFailed: true })];
	} else {
		throw new Error(`unsupported quality fixture status ${status}`);
	}
	const record = { version: 1, id, status, executions };
	return { ...record, sha256: sha(JSON.stringify(record)) };
}
function rehashQualityItem(item) {
	const { sha256: _sha, ...record } = item;
	return { ...record, sha256: sha(JSON.stringify(record)) };
}

async function makeFixture({
	qualityFailure = null,
	performanceStatus = 'passed',
	incrementalCacheClaim = true,
	editedRebuildProxy = false,
	staleCommit = false,
} = {}) {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-observation-'));
	await mkdir(join(root, '.cache'), { recursive: true });
	await mkdir(join(root, '.github', 'self-hosting'), { recursive: true });
	const seed = digest('a');
	const stage3 = digest('b');
	const seedManifestSha256 = digest('e');
	const runtimeAbi = 'virune-runtime@1';
	const runtimeAbiSha256 = sha(JSON.stringify({ version: 1, claim: 'virune-runtime-abi', value: runtimeAbi }));
	const step = id => ({ id, exitCode: 0, stdoutSha256: digest('c'), stderrSha256: digest('d'), status: 'pass', passed: true, evidenceSha256: sha(`step:${id}`) });
	const releasePolicy = {
		version: 1,
		failClosed: true,
		requiredSteps: ['seed-verify','fixed-seed-bootstrap','clean-bootstrap','legacy-rollback'],
		fixedPoint: { from: 'stage2', to: 'stage3', requireEquivalent: true, requireShaEquality: true, differenceCount: 0 },
		cleanBootstrap: { dependencyMode: 'offline' },
		evidenceConsistency: { required: true },
		productionDefaultChange: false,
	};
	const releaseRecord = {
		schemaVersion: 2, claim: 'selfhost-stable-release-gate-core', productionEligible: false, checkedAt: '2026-08-20T01:00:00.000Z', policy: releasePolicy,
		steps: ['seed-verify','fixed-seed-bootstrap','clean-bootstrap','legacy-rollback'].map(step),
		evidenceConsistency: { checked: true, passed: true, bindings: { seedArtifactSha256: seed, seedManifestSha256, stage1Sha256: digest('f'), stage2Sha256: stage3, stage3Sha256: stage3 } },
		passed: true,
	};
	const release = withSelfHash(releaseRecord);
	const crossRecord = {
		schemaVersion: 1, claim: 'selfhost-clean-bootstrap-cross-runner-reproducibility', productionEligible: false, status: 'match', equivalent: true, independentRunCount: 2,
		repositoryCommit: staleCommit ? '2'.repeat(40) : commit,
		candidateSha256: stage3,
		lockfileSha256: digest('1'),
		seed: { manifestSha256: seedManifestSha256, artifactSha256: seed },
		bootstrap: { seedSha256: seed, stage1Sha256: digest('f'), stage2Sha256: stage3, stage3Sha256: stage3 },
		profiles: [
			{ profile:'baseline', timezone:'UTC', locale:'C.UTF-8', homeVariant:'host-default', tempVariant:'host-default', evidenceSha256:digest('2') },
			{ profile:'perturbed', timezone:'Asia/Tokyo', locale:'C', homeVariant:'isolated-home', tempVariant:'isolated-temp', evidenceSha256:digest('3') },
		],
	};
	const cross = withSelfHash(crossRecord);
	const { createPromotionSubjectManifest } = await import('../packages/compiler/dist/src/selfhost/promotion-subject.js');
	const componentIds = ['bootstrap-policy','fixed-seed','runtime-abi','runtime-artifact','selfhost-host-contract','selfhost-stage3','stdlib-artifact'];
	const manifestResult = createPromotionSubjectManifest({
		version: 2,
		stage: 'required-selfhost',
		components: componentIds.map((id, index) => ({
			id,
			sha256: id === 'fixed-seed' ? seed : id === 'runtime-abi' ? runtimeAbiSha256 : id === 'selfhost-stage3' ? stage3 : digest(String((index + 2) % 10)),
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
	const qualityEvidence = qualityIds.map(id => qualityItem(id, id === qualityFailure ? 'failed' : 'passed'));
	const quality = { schemaVersion: 1, claim: 'required-selfhost-promotion-quality', productionEligible: false, status: qualityFailure === null ? 'passed' : 'failed', evidence: qualityEvidence };
	const legacy = { coldBuildMs: 100, editedRebuildMs: 100, peakRssKb: 1000, artifactSizeBytes: 1000 };
	const selfhost = performanceStatus === 'passed'
		? { coldBuildMs: 120, editedRebuildMs: 120, peakRssKb: 1400, artifactSizeBytes: 1200 }
		: { coldBuildMs: 130, editedRebuildMs: 130, peakRssKb: 1600, artifactSizeBytes: 1300 };
	const ratio = (a,b) => Number((a/b).toFixed(6));
	const ratios = { coldBuild: ratio(selfhost.coldBuildMs, legacy.coldBuildMs), editedRebuild: ratio(selfhost.editedRebuildMs, legacy.editedRebuildMs), peakRss: ratio(selfhost.peakRssKb, legacy.peakRssKb), artifactSize: ratio(selfhost.artifactSizeBytes, legacy.artifactSizeBytes) };
	const performance = { schemaVersion: 1, claim: 'required-selfhost-relative-performance', productionEligible: false, incrementalCacheClaim, editedRebuildProxy, budget: { coldBuildRatio:1.25, editedRebuildRatio:1.25, peakRssRatio:1.5, artifactSizeRatio:1.25, majorFixtureLatencyRatio:1.5 }, fixtureIds:['fixture'], samplesPerImplementation:5, fixtures:[{ fixtureId:'fixture', implementations:{legacy,selfhost}, ratios, majorRegression:false }], aggregate:{legacy,selfhost,ratios}, status:performanceStatus };
	const policy = {
		schemaVersion:1,
		automaticPromotionAllowed:false,
		stages:[{
			id:'required-selfhost',
			blocking:true,
			scope:'selfhost-related',
			productionDefault:false,
			requiredEvidence,
			promotionRequirements:{
				minimumConsecutiveSuccessfulRuns:14,
				minimumObservationDays:14,
				maximumUnexplainedDifferentials:0,
				manualApprovalRequired:true,
				rollbackEvidenceRequired:false,
				minimumStableReleaseCycles:0,
			},
		}],
	};
	const corpus = { schemaVersion: 1, fixtures: [{ id: 'fixture', tags: ['project'], expectedDivergences: [] }] };
	for (const [name, value] of Object.entries({ release, cross, subject, quality, performance, policy })) await writeFile(join(root, `${name}.json`), JSON.stringify(value), 'utf8');
	await writeFile(join(root, '.github', 'self-hosting', 'differential-corpus-v1.json'), JSON.stringify(corpus), 'utf8');
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
		assert.deepEqual(result.sourceEvaluation.reasons,['event-mismatch']);
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

test('self-hashed failed quality evidence without attributable execution is rejected', async () => {
	const fixture = await makeFixture();
	try {
		const quality = JSON.parse(await readFile(join(fixture.root,'quality.json'),'utf8'));
		const index = quality.evidence.findIndex(item => item.id === 'format-check');
		quality.evidence[index] = rehashQualityItem({ ...quality.evidence[index], status:'failed', executions:[] });
		quality.status = 'failed';
		await writeFile(join(fixture.root,'quality.json'),JSON.stringify(quality),'utf8');
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture)),
			/failed quality evidence format-check must retain a non-empty command prefix/u,
		);
		await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
	} finally { await fixture.cleanup(); }
});

test('ambiguous browser nonzero exit cannot be forged into permanent product failure', async () => {
	const fixture = await makeFixture();
	try {
		const quality = JSON.parse(await readFile(join(fixture.root,'quality.json'),'utf8'));
		const index = quality.evidence.findIndex(item => item.id === 'browser-integration');
		const browser = qualityCommandsById.get('browser-integration');
		const record = {
			version:1,
			id:'browser-integration',
			status:'failed',
			executions:[qualityExecution(browser.commands[0],{passed:false})],
		};
		quality.evidence[index] = { ...record, sha256:sha(JSON.stringify(record)) };
		quality.status = 'failed';
		await writeFile(join(fixture.root,'quality.json'),JSON.stringify(quality),'utf8');
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture)),
			/not attributable product-failure evidence/u,
		);
		await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
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

test('partial or malformed versioned evidence fails closed without an observation', async () => {
	const cases = [
		{
			file:'release.json',
			mutate:value => { value.steps.push({ ...value.steps[0], id:'future-release-step' }); },
			expected:/release-core must contain exactly four canonical required steps/u,
			rehash:true,
		},
		{
			file:'subject.json',
			mutate:value => { delete value.sources.releaseCoreSha256; },
			expected:/promotion subject sources must contain exactly keys/u,
		},
		{
			file:'subject.json',
			mutate:value => { value.sources.releaseCoreSha256 = digest('9'); },
			expected:/release-core identity disagrees/u,
		},
		{
			file:'quality.json',
			mutate:value => { value.futureStatus = 'passed'; },
			expected:/promotion quality report must contain exactly keys/u,
		},
		{
			file:'performance.json',
			mutate:value => { value.fixtures[0].ratios.futureRatio = 1; },
			expected:/fixtures\[0\]\.ratios must contain exactly keys/u,
		},
		{
			file:'performance.json',
			mutate:value => { value.fixtures[0].implementations.legacy.coldBuildMs = -100; },
			expected:/implementations\.legacy\.coldBuildMs must be a positive finite number/u,
		},
		{
			file:'performance.json',
			mutate:value => {
				value.fixtures[0].implementations.selfhost.coldBuildMs = 140;
				value.fixtures[0].ratios.coldBuild = 1.4;
			},
			expected:/promotion performance aggregate\.selfhost\.coldBuildMs does not match fixture median/u,
		},
		{
			file:'performance.json',
			mutate:value => {
				value.fixtures[0].implementations.selfhost.coldBuildMs = 125.00001;
				value.fixtures[0].ratios.coldBuild = 1.25;
				value.aggregate.selfhost.coldBuildMs = 125.00001;
				value.aggregate.ratios.coldBuild = 1.25;
			},
			expected:/promotion performance status disagrees with Gate D evidence/u,
		},
	];
	for (const { file, mutate, expected, rehash = false } of cases) {
		const fixture = await makeFixture();
		try {
			const value = JSON.parse(await readFile(join(fixture.root,file),'utf8'));
			mutate(value);
			await writeFile(join(fixture.root,file),JSON.stringify(rehash ? rehashSelfHash(value) : value),'utf8');
			await assert.rejects(() => assembleSelfhostPromotionObservation(options(fixture)), expected);
			await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
		} finally { await fixture.cleanup(); }
	}
});

test('malformed performance corpus metadata is rejected again by the final assembler', async () => {
	const fixture = await makeFixture();
	try {
		await writeFile(join(fixture.root,'.github','self-hosting','differential-corpus-v1.json'), JSON.stringify({
			schemaVersion:1,
			fixtures:[{ id:'fixture', tags:['project'], expectedDivergences:'' }],
		}), 'utf8');
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture)),
			/differential corpus fixture 0 expectedDivergences must be an array/u,
		);
		await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
	} finally { await fixture.cleanup(); }
});

test('self-consistent cross-runner evidence from another generation or unperturbed environment fails closed', async () => {
	const cases = [
		{
			mutate:value => { value.seed.manifestSha256 = digest('9'); },
			expected:/cross-runner evidence generation mismatch: Seed manifest/u,
		},
		{
			mutate:value => {
				const baseline = value.profiles[0];
				value.profiles[1] = { ...baseline, profile:'perturbed', evidenceSha256:digest('3') };
			},
			expected:/cross-runner environment perturbation dimensions did not actually differ/u,
		},
	];
	for (const { mutate, expected } of cases) {
		const fixture = await makeFixture();
		try {
			const cross = JSON.parse(await readFile(join(fixture.root,'cross.json'),'utf8'));
			mutate(cross);
			await writeFile(join(fixture.root,'cross.json'), JSON.stringify(rehashSelfHash(cross)), 'utf8');
			await assert.rejects(() => assembleSelfhostPromotionObservation(options(fixture)), expected);
			await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
		} finally { await fixture.cleanup(); }
	}
});

test('known performance budget failure becomes product-failed', async () => {
	const fixture = await makeFixture({ performanceStatus:'failed' });
	try { assert.equal((await assembleSelfhostPromotionObservation(options(fixture))).observation.outcome,'product-failed'); }
	finally { await fixture.cleanup(); }
});

test('edited-rebuild proxy cannot satisfy Gate D without real incremental evidence', async () => {
	const fixture = await makeFixture({ performanceStatus:'failed', incrementalCacheClaim:false, editedRebuildProxy:true });
	try {
		const result = await assembleSelfhostPromotionObservation(options(fixture));
		assert.equal(result.observation.outcome,'product-failed');
		assert.equal(result.observation.evidence.find(item=>item.id==='performance-budget').status,'failed');
	} finally { await fixture.cleanup(); }
});

test('weakened blocking promotion policy cannot emit a canonical observation', async () => {
	const fixture = await makeFixture();
	try {
		const policy = JSON.parse(await readFile(join(fixture.root,'policy.json'),'utf8'));
		policy.stages[0].promotionRequirements.minimumConsecutiveSuccessfulRuns = 13;
		await writeFile(join(fixture.root,'policy.json'),JSON.stringify(policy),'utf8');
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture)),
			/must be at least 14/u,
		);
		await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
	} finally { await fixture.cleanup(); }
});

test('newly required evidence missing from the current observation fails closed without an artifact', async () => {
	const fixture = await makeFixture();
	try {
		const policy = JSON.parse(await readFile(join(fixture.root,'policy.json'),'utf8'));
		policy.stages[0].requiredEvidence = [...policy.stages[0].requiredEvidence, 'future-required-evidence'];
		await writeFile(join(fixture.root,'policy.json'),JSON.stringify(policy),'utf8');
		await assert.rejects(
			() => assembleSelfhostPromotionObservation(options(fixture)),
			/required-selfhost evidence contract mismatch; missing=future-required-evidence extra=none/u,
		);
		await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
	} finally { await fixture.cleanup(); }
});

test('stale exact-head evidence fails closed without an observation', async () => {
	const fixture = await makeFixture({ staleCommit:true });
	try {
		await assert.rejects(()=>assembleSelfhostPromotionObservation(options(fixture)),/stale for the expected execution commit/u);
		await assert.rejects(() => readFile(join(fixture.root,'observation.json'),'utf8'), /ENOENT/u);
	} finally { await fixture.cleanup(); }
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
		await assert.rejects(()=>assembleSelfhostPromotionObservation(options(fixture)),/status disagrees with Gate D evidence/u);
	} finally { await fixture.cleanup(); }
});
