import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SELFHOST_REQUIRED_GATE_SCHEMA_VERSION = 1;
export const DEFAULT_SELFHOST_REQUIRED_GATE_POLICY = '.github/selfhost-required-gate.json';
export const DEFAULT_SELFHOST_REQUIRED_GATE_OUTPUT = '.cache/selfhost-required-shadow/required-gate.json';

export function validatePolicy(value) {
  if (!isObject(value)) throw new Error('Required self-host gate policy must be an object.');
  if (value.schemaVersion !== 1) throw new Error('Required self-host gate policy schemaVersion must be 1.');
  if (value.phase !== 'required-shadow') throw new Error('Required self-host gate phase must be required-shadow.');
  if (value.requiredCheck !== 'Required self-host gate') throw new Error('Required self-host gate check name is not canonical.');
  if (value.productionEligible !== false || value.productionDefaultChange !== false) {
    throw new Error('Required Shadow policy must remain production-ineligible and must not change the production default.');
  }
  const releaseCore = objectAt(value, 'evidence.releaseCore');
  if (releaseCore.schemaVersion !== 2 || releaseCore.claim !== 'selfhost-stable-release-gate-core') {
    throw new Error('Required Shadow release-core contract is invalid.');
  }
  const crossRunner = objectAt(value, 'evidence.crossRunner');
  if (crossRunner.schemaVersion !== 1
    || crossRunner.claim !== 'selfhost-clean-bootstrap-cross-runner-reproducibility'
    || crossRunner.independentRunCount !== 2) {
    throw new Error('Required Shadow cross-runner contract is invalid.');
  }
  const promotion = objectAt(value, 'promotion');
  if (promotion.requiredShadowEnabled !== true
    || promotion.compilerWideRequired !== false
    || promotion.nightlyShadowAccepted !== false
    || promotion.internalOptInOnly !== true
    || promotion.productionDefaultAllowed !== false) {
    throw new Error('Required Shadow promotion state is not fail-closed.');
  }
  return value;
}

export function evaluateRequiredShadow({ policy, required, expectedCommit, releaseCore, crossRunner }) {
  validatePolicy(policy);
  if (typeof required !== 'boolean') throw new Error('required must be boolean.');
  if (!isGitSha(expectedCommit)) throw new Error('expectedCommit must be a full lowercase Git SHA.');
  const base = {
    schemaVersion: SELFHOST_REQUIRED_GATE_SCHEMA_VERSION,
    claim: 'selfhost-required-shadow-gate',
    phase: 'required-shadow',
    required,
    expectedCommit,
    productionEligible: false,
    productionDefaultChange: false,
    promotion: structuredClone(policy.promotion),
  };
  if (!required) {
    return finalize({
      ...base,
      status: 'omitted',
      checks: [{ id: 'classification', passed: true, detail: 'No self-host-impacting path changed.' }],
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
  const policy = injected.policy ?? JSON.parse(await readFile(resolve(root, DEFAULT_SELFHOST_REQUIRED_GATE_POLICY), 'utf8'));
  const evidenceRequired = !options.notRequired && options.upstreamFailure === null;
  const releaseCore = evidenceRequired ? injected.releaseCore ?? JSON.parse(await readFile(resolveCacheInput(root, options.releaseCore), 'utf8')) : undefined;
  const crossRunner = evidenceRequired ? injected.crossRunner ?? JSON.parse(await readFile(resolveCacheInput(root, options.crossRunner), 'utf8')) : undefined;
  let report;
  try {
    if (options.upstreamFailure !== null) throw new Error(`Required Shadow upstream evidence job failed: ${options.upstreamFailure}`);
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
      required: !options.notRequired,
      expectedCommit: options.expectedCommit,
      productionEligible: false,
      productionDefaultChange: false,
      status: 'fail',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const output = resolveCacheOutput(root, options.output);
  await mkdir(dirname(output.absolutePath), { recursive: true });
  const encoded = `${JSON.stringify(report)}\n`;
  await writeFile(output.absolutePath, encoded, 'utf8');
  if (options.json) process.stdout.write(encoded);
  else console.log(`Required self-host gate: ${report.status.toUpperCase()} (${output.repositoryRelative})`);
  if (!report.passed) throw new Error(`Required self-host gate failed. Evidence: ${output.repositoryRelative}`);
  return report;
}

export function helpText() {
  return [
    'Usage: node scripts/run-selfhost-required-gate.mjs --expected-commit=<sha> [--not-required | --upstream-failure=<reason> | --release-core=<.cache/json> --cross-runner=<.cache/json>] [--output=<.cache/json>] [--json]',
    '',
    'Produces the always-present Required Self-host Gate summary.',
    'Heavy evidence is required only for self-host-impacting changes; omission is explicit and production promotion remains disabled.',
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
