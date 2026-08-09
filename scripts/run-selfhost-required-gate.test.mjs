import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRequiredShadow, parseArguments, validatePolicy } from './run-selfhost-required-gate.mjs';

const SHA = 'a'.repeat(40);
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const policy = {
  schemaVersion: 1,
  phase: 'required-shadow',
  requiredCheck: 'Required self-host gate',
  productionEligible: false,
  productionDefaultChange: false,
  evidence: {
    releaseCore: { schemaVersion: 2, claim: 'selfhost-stable-release-gate-core' },
    crossRunner: { schemaVersion: 1, claim: 'selfhost-clean-bootstrap-cross-runner-reproducibility', independentRunCount: 2 },
  },
  promotion: {
    requiredShadowEnabled: true,
    compilerWideRequired: false,
    nightlyShadowAccepted: false,
    internalOptInOnly: true,
    productionDefaultAllowed: false,
  },
};

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

test('policy is fail-closed for Required Shadow and production promotion', () => {
  assert.equal(validatePolicy(structuredClone(policy)).phase, 'required-shadow');
  const unsafe = structuredClone(policy);
  unsafe.promotion.productionDefaultAllowed = true;
  assert.throws(() => validatePolicy(unsafe), /fail-closed/u);
});

test('unrelated changes explicitly omit heavy evidence but keep production disabled', () => {
  const report = evaluateRequiredShadow({ policy, required: false, expectedCommit: SHA });
  assert.equal(report.passed, true);
  assert.equal(report.status, 'omitted');
  assert.equal(report.required, false);
  assert.equal(report.productionEligible, false);
  assert.equal(report.promotion.productionDefaultAllowed, false);
});

test('self-host changes require release-core and independent cross-runner evidence', () => {
  const report = evaluateRequiredShadow({ policy, required: true, expectedCommit: SHA, releaseCore: releaseCore(), crossRunner: crossRunner() });
  assert.equal(report.passed, true);
  assert.equal(report.status, 'pass');
  assert.equal(report.bindings.repositoryCommit, SHA);
  assert.equal(report.bindings.stage2Sha256, report.bindings.stage3Sha256);
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
