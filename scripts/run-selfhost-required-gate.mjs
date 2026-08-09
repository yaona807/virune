import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SELFHOST_REQUIRED_GATE_SCHEMA_VERSION = 1;
export const DEFAULT_SELFHOST_PROMOTION_POLICY = '.github/self-hosting/promotion-policy-v1.json';
export const DEFAULT_SELFHOST_REQUIRED_GATE_OUTPUT = '.cache/selfhost-required-shadow/required-gate.json';
const TARGET_STAGE = 'required-selfhost';
const REQUIRED_POLICY_EVIDENCE = Object.freeze([
  'clean-bootstrap',
  'cross-evidence-generation-binding',
  'environment-perturbation',
  'exact-head-evidence-binding',
  'fixed-seed-verification',
  'independent-runner-reproducibility',
  'legacy-rollback',
  'stage1-stage2-transition',
  'stage2-stage3-fixed-point',
]);

export function validatePolicy(value) {
  if (!isObject(value)) throw new Error('Self-host promotion policy must be an object.');
  if (value.schemaVersion !== 1) throw new Error('Self-host promotion policy schemaVersion must be 1.');
  if (value.automaticPromotionAllowed !== false) throw new Error('Self-host promotion must never be automatic.');
  if (!Array.isArray(value.stages)) throw new Error('Self-host promotion policy stages must be an array.');
  const stage = value.stages.find(item => item?.id === TARGET_STAGE);
  if (!isObject(stage)
    || stage.blocking !== true
    || stage.scope !== 'selfhost-related'
    || stage.productionDefault !== false) {
    throw new Error('Canonical required-selfhost stage is invalid.');
  }
  if (!Array.isArray(stage.requiredEvidence)) throw new Error('required-selfhost.requiredEvidence must be an array.');
  const evidence = new Set(stage.requiredEvidence);
  for (const item of REQUIRED_POLICY_EVIDENCE) {
    if (!evidence.has(item)) throw new Error(`required-selfhost.requiredEvidence must include ${item}.`);
  }
  if (evidence.has('stage1-stage2')) throw new Error('required-selfhost must not use obsolete Stage 1/Stage 2 equality evidence.');
  const requirements = stage.promotionRequirements;
  if (!isObject(requirements)
    || !Number.isSafeInteger(requirements.minimumConsecutiveSuccessfulRuns)
    || requirements.minimumConsecutiveSuccessfulRuns < 14
    || !Number.isSafeInteger(requirements.minimumObservationDays)
    || requirements.minimumObservationDays < 14
    || requirements.maximumUnexplainedDifferentials !== 0
    || requirements.manualApprovalRequired !== true) {
    throw new Error('required-selfhost promotion requirements are not fail-closed.');
  }
  const compilerStage = value.stages.find(item => item?.id === 'required-compiler');
  if (!isObject(compilerStage)
    || compilerStage.blocking !== true
    || compilerStage.scope !== 'compiler-changes'
    || compilerStage.productionDefault !== false) {
    throw new Error('Compiler-wide required stage must remain separate from Required Shadow.');
  }
  const productionStage = value.stages.find(item => item?.id === 'production-default');
  if (!isObject(productionStage) || productionStage.productionDefault !== true) {
    throw new Error('Production-default stage is invalid.');
  }
  return {
    schemaVersion: value.schemaVersion,
    automaticPromotionAllowed: value.automaticPromotionAllowed,
    targetStage: TARGET_STAGE,
    blocking: stage.blocking,
    scope: stage.scope,
    minimumConsecutiveSuccessfulRuns: requirements.minimumConsecutiveSuccessfulRuns,
    minimumObservationDays: requirements.minimumObservationDays,
    maximumUnexplainedDifferentials: requirements.maximumUnexplainedDifferentials,
    manualApprovalRequired: requirements.manualApprovalRequired,
  };
}

export function evaluateRequiredShadow({ policy, required, expectedCommit, releaseCore, crossRunner }) {
  const policySummary = validatePolicy(policy);
  if (typeof required !== 'boolean') throw new Error('required must be boolean.');
  if (!isGitSha(expectedCommit)) throw new Error('expectedCommit must be a full lowercase Git SHA.');
  const base = {
    schemaVersion: SELFHOST_REQUIRED_GATE_SCHEMA_VERSION,
    claim: 'selfhost-required-shadow-gate',
    phase: 'required-shadow',
    targetStage: TARGET_STAGE,
    required,
    expectedCommit,
    productionEligible: false,
    productionDefaultChange: false,
    promotionEligible: false,
    promotionEligibilityReason: 'This check validates one pull-request head only; observation history and manual approval are evaluated separately.',
    policy: policySummary,
  };
  if (!required) {
    return finalize({
      ...base,
      status: 'omitted',
      checks: [{ id: 'classification', passed: true, detail: 'No Stage 3 self-host-impacting path changed.' }],
      passed: true,
    });
  }

  const checks = [];
  const core = validateReleaseCore(releaseCore);
  checks.push({ id: 'release-core', passed: true });
  const cross = validateCrossRunner(crossRunner, expectedCommit);
  checks.push({ id: 'cross-runner-reproducibility', passed: true });
  const bindings = [
    ['seed artifact SHA-256', core.seedArtifactSha256, cross.seed.artifactSha256],
    ['seed manifest SHA-256', core.seedManifestSha256, cross.seed.manifestSha256],
    ['Stage 1 SHA-256', core.stage1Sha256, cross.bootstrap.stage1Sha256],
    ['Stage 2 SHA-256', core.stage2Sha256, cross.bootstrap.stage2Sha256],
    ['Stage 3 SHA-256', core.stage3Sha256, cross.bootstrap.stage3Sha256, cross.candidateSha256],
  ];
  for (const [label, ...values] of bindings) {
    if (!values.every(isSha256) || new Set(values).size !== 1) {
      throw new Error(`Required Shadow cross-evidence mismatch: ${label}.`);
    }
  }
  checks.push({ id: 'cross-evidence-generation-binding', passed: true });
  checks.push({ id: 'exact-head-evidence-binding', passed: cross.repositoryCommit === expectedCommit });
  return finalize({
    ...base,
    status: 'pass',
    checks,
    bindings: {
      repositoryCommit: cross.repositoryCommit,
      seedArtifactSha256: core.seedArtifactSha256,
      seedManifestSha256: core.seedManifestSha256,
      stage1Sha256: core.stage1Sha256,
      stage2Sha256: core.stage2Sha256,
      stage3Sha256: core.stage3Sha256,
    },
    passed: true,
  });
}

function validateReleaseCore(value) {
  if (!isObject(value)
    || value.schemaVersion !== 2
    || value.claim !== 'selfhost-stable-release-gate-core'
    || value.productionEligible !== false
    || value.passed !== true
    || value.evidenceConsistency?.checked !== true
    || value.evidenceConsistency?.passed !== true) {
    throw new Error('Self-host release-core evidence is not a passing fail-closed proof.');
  }
  const bindings = objectAt(value, 'evidenceConsistency.bindings');
  const result = {
    seedArtifactSha256: bindings.seedArtifactSha256,
    seedManifestSha256: bindings.seedManifestSha256,
    stage1Sha256: bindings.stage1Sha256,
    stage2Sha256: bindings.stage2Sha256,
    stage3Sha256: bindings.stage3Sha256,
  };
  if (!Object.values(result).every(isSha256)) throw new Error('Self-host release-core bindings are invalid.');
  return result;
}

function validateCrossRunner(value, expectedCommit) {
  if (!isObject(value)
    || value.schemaVersion !== 1
    || value.claim !== 'selfhost-clean-bootstrap-cross-runner-reproducibility'
    || value.productionEligible !== false
    || value.status !== 'match'
    || value.equivalent !== true
    || value.independentRunCount !== 2
    || value.repositoryCommit !== expectedCommit
    || !isSha256(value.candidateSha256)) {
    throw new Error('Cross-runner clean-bootstrap evidence is not a matching proof for the expected commit.');
  }
  const seed = objectAt(value, 'seed');
  const bootstrap = objectAt(value, 'bootstrap');
  if (!isSha256(seed.manifestSha256)
    || !isSha256(seed.artifactSha256)
    || !isSha256(bootstrap.seedSha256)
    || !isSha256(bootstrap.stage1Sha256)
    || !isSha256(bootstrap.stage2Sha256)
    || !isSha256(bootstrap.stage3Sha256)
    || bootstrap.seedSha256 !== seed.artifactSha256
    || bootstrap.stage2Sha256 !== bootstrap.stage3Sha256
    || value.candidateSha256 !== bootstrap.stage3Sha256) {
    throw new Error('Cross-runner clean-bootstrap bindings are invalid.');
  }
  return { ...value, seed, bootstrap };
}

function finalize(report) {
  const serialized = JSON.stringify(report);
  return { ...report, evidenceSha256: sha256(serialized) };
}

export function parseArguments(argumentsList) {
  let releaseCore = null;
  let crossRunner = null;
  let output = DEFAULT_SELFHOST_REQUIRED_GATE_OUTPUT;
  let expectedCommit = null;
  let notRequired = false;
  let upstreamFailure = null;
  let json = false;
  let help = false;
  const seen = new Set();
  for (const argument of argumentsList) {
    if (argument === '--json' || argument === '--help' || argument === '--not-required') {
      const name = argument.slice(2);
      if (seen.has(name)) throw new Error(`Duplicate option: ${argument}`);
      seen.add(name);
      if (name === 'json') json = true;
      else if (name === 'help') help = true;
      else notRequired = true;
      continue;
    }
    const option = ['release-core', 'cross-runner', 'output', 'expected-commit', 'upstream-failure'].find(name => argument.startsWith(`--${name}=`));
    if (option === undefined) throw new Error(`Unknown argument: ${argument}`);
    if (seen.has(option)) throw new Error(`Duplicate option: --${option}`);
    seen.add(option);
    const value = nonEmpty(argument.slice(option.length + 3), `--${option}`);
    if (option === 'release-core') releaseCore = value;
    else if (option === 'cross-runner') crossRunner = value;
    else if (option === 'output') output = value;
    else if (option === 'expected-commit') expectedCommit = value;
    else upstreamFailure = value;
  }
  if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
  if (!help && expectedCommit === null) throw new Error('--expected-commit is required');
  if (!help && !notRequired && upstreamFailure === null && (releaseCore === null || crossRunner === null)) {
    throw new Error('--release-core and --cross-runner are required unless --not-required or --upstream-failure is used');
  }
  if (notRequired && (releaseCore !== null || crossRunner !== null || upstreamFailure !== null)) throw new Error('--not-required cannot be combined with evidence inputs or --upstream-failure');
  if (upstreamFailure !== null && (releaseCore !== null || crossRunner !== null)) throw new Error('--upstream-failure cannot be combined with evidence inputs');
  return { releaseCore, crossRunner, output, expectedCommit, notRequired, upstreamFailure, json, help };
}

export async function main(argumentsList = process.argv.slice(2), injected = {}) {
  const options = parseArguments(argumentsList);
  if (options.help) {
    console.log(helpText());
    return null;
  }
  const root = resolve(injected.repositoryRoot ?? fileURLToPath(new URL('..', import.meta.url)));
  const output = resolveCacheOutput(root, options.output);
  let report;
  try {
    const policy = injected.policy ?? JSON.parse(await readFile(resolve(root, DEFAULT_SELFHOST_PROMOTION_POLICY), 'utf8'));
    if (options.upstreamFailure !== null) throw new Error(`Required Shadow upstream evidence job failed: ${options.upstreamFailure}`);
    const evidenceRequired = !options.notRequired;
    const releaseCore = evidenceRequired
      ? injected.releaseCore ?? JSON.parse(await readFile(resolveCacheInput(root, options.releaseCore), 'utf8'))
      : undefined;
    const crossRunner = evidenceRequired
      ? injected.crossRunner ?? JSON.parse(await readFile(resolveCacheInput(root, options.crossRunner), 'utf8'))
      : undefined;
    report = evaluateRequiredShadow({
      policy,
      required: !options.notRequired,
      expectedCommit: options.expectedCommit,
      releaseCore,
      crossRunner,
    });
  } catch (error) {
    report = finalize({
      schemaVersion: SELFHOST_REQUIRED_GATE_SCHEMA_VERSION,
      claim: 'selfhost-required-shadow-gate',
      phase: 'required-shadow',
      targetStage: TARGET_STAGE,
      required: !options.notRequired,
      expectedCommit: options.expectedCommit,
      productionEligible: false,
      productionDefaultChange: false,
      promotionEligible: false,
      status: 'fail',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await mkdir(dirname(output.absolutePath), { recursive: true });
  const encoded = `${JSON.stringify(report)}\n`;
  await writeFile(output.absolutePath, encoded, 'utf8');
  if (options.json) process.stdout.write(encoded);
  else console.log(`Required self-host shadow: ${report.status.toUpperCase()} (${output.repositoryRelative})`);
  if (!report.passed) throw new Error(`Required self-host shadow failed. Evidence: ${output.repositoryRelative}`);
  return report;
}

export function helpText() {
  return [
    'Usage: node scripts/run-selfhost-required-gate.mjs --expected-commit=<sha> [--not-required | --upstream-failure=<reason> | --release-core=<.cache/json> --cross-runner=<.cache/json>] [--output=<.cache/json>] [--json]',
    '',
    'Produces the per-PR Required Shadow evidence summary for the canonical required-selfhost target stage.',
    'Passing this check does not satisfy the 14-run/14-day history or manual approval required for stage promotion.',
  ].join('\n');
}

function resolveCacheInput(root, value) {
  if (value === null || isAbsolute(value)) throw new Error('Evidence inputs must be repository-relative .cache JSON paths.');
  const absolutePath = resolve(root, value);
  const repositoryRelative = relative(root, absolutePath);
  if (repositoryRelative === '..' || repositoryRelative.startsWith(`..${sep}`) || isAbsolute(repositoryRelative)
    || !(repositoryRelative === '.cache' || repositoryRelative.startsWith(`.cache${sep}`)) || !repositoryRelative.endsWith('.json')) {
    throw new Error('Evidence inputs must be repository-relative .cache JSON paths.');
  }
  return absolutePath;
}
function resolveCacheOutput(root, value) {
  const absolutePath = resolveCacheInput(root, value);
  return { absolutePath, repositoryRelative: relative(root, absolutePath).replaceAll('\\', '/') };
}
function objectAt(value, path) {
  let current = value;
  for (const segment of path.split('.')) {
    if (!isObject(current) || !Object.hasOwn(current, segment)) throw new Error(`${path} is required.`);
    current = current[segment];
  }
  if (!isObject(current)) throw new Error(`${path} must be an object.`);
  return current;
}
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isGitSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value); }
function isSha256(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value); }
function nonEmpty(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
  return value.trim();
}
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

const directExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
