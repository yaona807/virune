import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { evaluateRequiredShadow, parseArguments, validatePolicy } from './run-selfhost-required-gate.mjs';

const SHA = 'a'.repeat(40);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const policy = JSON.parse(await readFile(new URL('../.github/self-hosting/promotion-policy-v1.json', import.meta.url), 'utf8'));

function releaseCore() {
  return {
    schemaVersion: 2,
    claim: 'selfhost-stable-release-gate-core',
    productionEligible: false,
    passed: true,
    evidenceConsistency: {
      checked: true,
      passed: true,
      bindings: { seedArtifactSha256: A, seedManifestSha256: C, stage1Sha256: A, stage2Sha256: B, stage3Sha256: B },
    },
  };
}
function crossRunner() {
  return {
    schemaVersion: 1,
    claim: 'selfhost-clean-bootstrap-cross-runner-reproducibility',
    productionEligible: false,
    status: 'match',
    equivalent: true,
    independentRunCount: 2,
    repositoryCommit: SHA,
    candidateSha256: B,
    seed: { manifestSha256: C, artifactSha256: A },
    bootstrap: { seedSha256: A, stage1Sha256: A, stage2Sha256: B, stage3Sha256: B },
  };
}

test('canonical policy keeps required-selfhost behind observation history and manual approval', () => {
  const summary = validatePolicy(structuredClone(policy));
  assert.equal(summary.targetStage, 'required-selfhost');
  assert.equal(summary.scope, 'selfhost-related');
  assert.equal(summary.minimumConsecutiveSuccessfulRuns, 14);
  assert.equal(summary.minimumObservationDays, 14);
  assert.equal(summary.manualApprovalRequired, true);
  assert.equal(summary.automaticPromotionAllowed, false);
});

test('rejects policy that weakens Required Shadow history', () => {
  const unsafe = structuredClone(policy);
  unsafe.stages.find(stage => stage.id === 'required-selfhost').promotionRequirements.minimumObservationDays = 0;
  assert.throws(() => validatePolicy(unsafe), /not fail-closed/u);
});

test('rejects policy that removes current fixed-point evidence', () => {
  const unsafe = structuredClone(policy);
  const stage = unsafe.stages.find(item => item.id === 'required-selfhost');
  stage.requiredEvidence = stage.requiredEvidence.filter(item => item !== 'stage2-stage3-fixed-point');
  assert.throws(() => validatePolicy(unsafe), /must include stage2-stage3-fixed-point/u);
});

test('unrelated changes explicitly omit heavy evidence without claiming promotion', () => {
  const report = evaluateRequiredShadow({ policy, required: false, expectedCommit: SHA });
  assert.equal(report.passed, true);
  assert.equal(report.status, 'omitted');
  assert.equal(report.required, false);
  assert.equal(report.productionEligible, false);
  assert.equal(report.promotionEligible, false);
  assert.equal(report.policy.minimumObservationDays, 14);
});

test('self-host changes require release-core and independent cross-runner evidence', () => {
  const report = evaluateRequiredShadow({ policy, required: true, expectedCommit: SHA, releaseCore: releaseCore(), crossRunner: crossRunner() });
  assert.equal(report.passed, true);
  assert.equal(report.status, 'pass');
  assert.equal(report.bindings.repositoryCommit, SHA);
  assert.equal(report.bindings.stage2Sha256, report.bindings.stage3Sha256);
  assert.equal(report.promotionEligible, false);
  assert.match(report.evidenceSha256, /^[0-9a-f]{64}$/u);
});

test('rejects evidence generated for another commit', () => {
  const evidence = crossRunner();
  evidence.repositoryCommit = 'b'.repeat(40);
  assert.throws(() => evaluateRequiredShadow({ policy, required: true, expectedCommit: SHA, releaseCore: releaseCore(), crossRunner: evidence }), /expected commit/u);
});

test('rejects individually valid evidence from different compiler generations', () => {
  const evidence = crossRunner();
  evidence.bootstrap.stage1Sha256 = C;
  assert.throws(() => evaluateRequiredShadow({ policy, required: true, expectedCommit: SHA, releaseCore: releaseCore(), crossRunner: evidence }), /cross-evidence mismatch/u);
});

test('rejects a non-passing release core', () => {
  const core = releaseCore();
  core.passed = false;
  assert.throws(() => evaluateRequiredShadow({ policy, required: true, expectedCommit: SHA, releaseCore: core, crossRunner: crossRunner() }), /release-core evidence/u);
});

test('argument parsing requires exact commit and evidence unless omitted', () => {
  assert.deepEqual(parseArguments([`--expected-commit=${SHA}`, '--not-required']), {
    releaseCore: null, crossRunner: null, output: '.cache/selfhost-required-shadow/required-gate.json', expectedCommit: SHA, notRequired: true, upstreamFailure: null, json: false, help: false,
  });
  assert.throws(() => parseArguments([`--expected-commit=${SHA}`]), /release-core and --cross-runner/u);
  assert.equal(parseArguments([`--expected-commit=${SHA}`, '--upstream-failure=baseline failure']).upstreamFailure, 'baseline failure');
  assert.throws(() => parseArguments([`--expected-commit=${SHA}`, '--not-required', '--release-core=.cache/a.json']), /cannot be combined/u);
});
