import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execNpmSync } from './npm-cli.mjs';

const PLAN_PATH = '.github/release/npm-publication-v1.json';
const FORBIDDEN_SEGMENTS = new Set(['.git', '.github', '.cache', '__tests__', 'coverage', 'fixtures', 'test', 'tests']);
const FORBIDDEN_BASENAMES = new Set([
  '.env',
  '.npmrc',
  'credentials.json',
  'id_ed25519',
  'id_rsa',
  'package-lock.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.tsbuildinfo',
  'yarn.lock',
]);

export function verifyNpmPackageContents(root = process.cwd(), options = {}) {
  const plan = readJson(resolve(root, PLAN_PATH));
  const rootManifest = readJson(resolve(root, 'package.json'));
  const plannedPackages = array(plan.packages, '$.packages')
    .map((value, index) => plannedPackage(value, `$.packages[${index}]`))
    .sort((left, right) => compareText(left.directory, right.directory));
  assert(plannedPackages.length > 0, '$.packages', 'at least one registry package is required');
  assertUnique(plannedPackages.map(item => item.directory), '$.packages', 'directory');
  assertUnique(plannedPackages.map(item => item.registryName), '$.packages', 'registryName');
  const version = nonEmptyString(rootManifest.version, '$root.version');
  const packDryRun = options.packDryRun ?? runPackDryRun;
  const packages = [];

  for (const item of plannedPackages) {
    const manifest = readJson(resolve(root, 'packages', item.directory, 'package.json'));
    assert(manifest.name === item.registryName, `$.packages.${item.directory}.registryName`, `expected package name ${manifest.name}`);
    assert(manifest.version === version, `$.${item.directory}.version`, `must match root version ${version}`);
    const packResult = normalizePackResult(packDryRun({ root, directory: item.directory }), item.directory);
    packages.push(auditPackResult(item, manifest, packResult));
  }

  return {
    schemaVersion: 1,
    stage: 'prepublication-package-contents-audit',
    version,
    packageCount: packages.length,
    packages,
  };
}

function runPackDryRun({ root, directory }) {
  const output = execNpmSync(
    ['pack', '--dry-run', '--json', '--ignore-scripts', `./packages/${directory}`],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return output;
}

function normalizePackResult(value, directory) {
  if (Buffer.isBuffer(value) || typeof value === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(String(value));
    } catch (error) {
      throw new Error(`$.${directory}.npmPack: invalid JSON output: ${error instanceof Error ? error.message : String(error)}`);
    }
    assert(Array.isArray(parsed) && parsed.length === 1, `$.${directory}.npmPack`, 'expected exactly one npm pack result');
    return record(parsed[0], `$.${directory}.npmPack[0]`);
  }
  return record(value, `$.${directory}.npmPack`);
}

function auditPackResult(item, manifest, result) {
  assert(result.name === manifest.name, `$.${item.directory}.npmPack.name`, `expected ${manifest.name}`);
  assert(result.version === manifest.version, `$.${item.directory}.npmPack.version`, `expected ${manifest.version}`);
  const bundled = array(result.bundled, `$.${item.directory}.npmPack.bundled`);
  assert(bundled.length === 0, `$.${item.directory}.npmPack.bundled`, 'registry package dry-run must not bundle dependencies');
  const packedFiles = array(result.files, `$.${item.directory}.npmPack.files`)
    .map((value, index) => packedFile(value, `$.${item.directory}.npmPack.files[${index}]`));
  assert(packedFiles.length > 0, `$.${item.directory}.npmPack.files`, 'npm pack dry-run must contain files');
  assertUnique(packedFiles.map(file => file.path), `$.${item.directory}.npmPack.files`, 'path');
  if (result.entryCount !== undefined) {
    assert(result.entryCount === packedFiles.length, `$.${item.directory}.npmPack.entryCount`, 'must equal files length');
  }

  const rules = array(manifest.files, `$.${item.directory}.files`)
    .map((value, index) => manifestFileRule(value, `$.${item.directory}.files[${index}]`));
  assert(rules.length > 0, `$.${item.directory}.files`, 'files allowlist is required');
  assertUnique(rules, `$.${item.directory}.files`, 'file rule');

  const paths = packedFiles.map(file => file.path).sort(compareText);
  assert(paths.includes('package.json'), `$.${item.directory}.npmPack.files`, 'package.json is required');
  for (const path of paths) {
    assert(
      path === 'package.json' || rules.some(rule => matchesRule(path, rule)),
      `$.${item.directory}.npmPack.files`,
      `unexpected file outside package.json files allowlist: ${path}`,
    );
    assertSafePackedPath(path, item.directory);
  }
  for (const rule of rules) {
    assert(
      paths.some(path => matchesRule(path, rule)),
      `$.${item.directory}.files`,
      `allowlist entry does not select any packed file: ${rule}`,
    );
  }

  for (const target of collectManifestTargets(manifest.exports, `$.${item.directory}.exports`)) {
    assertTargetPacked(paths, target, `$.${item.directory}.exports`);
  }
  if (manifest.bin !== undefined) {
    if (typeof manifest.bin === 'string') {
      assertTargetPacked(paths, manifest.bin, `$.${item.directory}.bin`);
    } else {
      const bins = record(manifest.bin, `$.${item.directory}.bin`);
      for (const [name, target] of Object.entries(bins)) {
        assertTargetPacked(paths, target, `$.${item.directory}.bin.${name}`);
      }
    }
  }

  const fileSetSha256 = createHash('sha256').update(`${paths.join('\n')}\n`).digest('hex');
  const unpackedBytes = packedFiles.reduce((total, file) => total + file.size, 0);
  return {
    directory: item.directory,
    registryName: item.registryName,
    fileCount: paths.length,
    fileSetSha256,
    unpackedBytes,
  };
}

function plannedPackage(value, path) {
  const item = record(value, path);
  return {
    directory: identifier(item.directory, `${path}.directory`),
    registryName: packageName(item.registryName, `${path}.registryName`),
  };
}

function packedFile(value, path) {
  const item = record(value, path);
  const filePath = canonicalRelativePath(item.path, `${path}.path`);
  assert(Number.isInteger(item.size) && item.size >= 0, `${path}.size`, 'expected a non-negative integer');
  return { path: filePath, size: item.size };
}

function manifestFileRule(value, path) {
  const rule = canonicalRelativePath(value, path);
  assert(!/[?*[\]]/u.test(rule), path, 'globbed files entries are not supported by the current audit contract');
  return rule.replace(/\/$/u, '');
}

function canonicalRelativePath(value, path) {
  const text = nonEmptyString(value, path);
  assert(!text.includes('\\'), path, 'backslashes are not canonical package paths');
  assert(!text.startsWith('/'), path, 'absolute package paths are forbidden');
  const normalized = posix.normalize(text);
  assert(normalized === text, path, 'package path must already be normalized');
  assert(text !== '.' && text !== '..' && !text.startsWith('../'), path, 'package path traversal is forbidden');
  return text;
}

function matchesRule(path, rule) {
  return path === rule || path.startsWith(`${rule}/`);
}

function assertSafePackedPath(path, directory) {
  const lower = path.toLowerCase();
  const segments = lower.split('/');
  const basename = segments.at(-1) ?? '';
  for (const segment of segments) {
    assert(!FORBIDDEN_SEGMENTS.has(segment), `$.${directory}.npmPack.files`, `development-only path is forbidden: ${path}`);
  }
  assert(!FORBIDDEN_BASENAMES.has(basename), `$.${directory}.npmPack.files`, `high-risk development or credential file is forbidden: ${path}`);
  assert(!/\.(?:pem|p12|pfx|key)$/iu.test(basename), `$.${directory}.npmPack.files`, `credential-like file is forbidden: ${path}`);
  assert(!/\.(?:test|spec)\.(?:[cm]?[jt]sx?|d\.[cm]?ts|js\.map)$/iu.test(basename), `$.${directory}.npmPack.files`, `test artifact is forbidden: ${path}`);
  if (/\.(?:ts|tsx|mts|cts)$/iu.test(basename)) {
    assert(/\.d\.(?:ts|mts|cts)$/iu.test(basename), `$.${directory}.npmPack.files`, `raw TypeScript source is forbidden: ${path}`);
  }
}

function collectManifestTargets(value, path, result = []) {
  if (value === undefined || value === null) return result;
  if (typeof value === 'string') {
    result.push(value);
    return result;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) collectManifestTargets(value[index], `${path}[${index}]`, result);
    return result;
  }
  const item = record(value, path);
  for (const [key, nested] of Object.entries(item)) collectManifestTargets(nested, `${path}.${key}`, result);
  return result;
}

function assertTargetPacked(paths, value, path) {
  const target = nonEmptyString(value, path);
  assert(target.startsWith('./'), path, 'package target must be relative and start with ./');
  assert(!target.includes('*'), path, 'wildcard package targets require explicit audit support');
  const packedPath = canonicalRelativePath(target.slice(2), path);
  assert(paths.includes(packedPath), path, `target is missing from npm pack contents: ${target}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
function array(value, path) {
  assert(Array.isArray(value), path, 'expected an array');
  return value;
}
function record(value, path) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
  return value;
}
function nonEmptyString(value, path) {
  assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
  return value;
}
function identifier(value, path) {
  const text = nonEmptyString(value, path);
  assert(/^[a-z0-9][a-z0-9-]*$/u.test(text), path, 'invalid package directory');
  return text;
}
function packageName(value, path) {
  const name = nonEmptyString(value, path);
  assert(/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u.test(name), path, 'invalid npm package name');
  return name;
}
function assertUnique(values, path, name) {
  const seen = new Set();
  for (const value of values) {
    assert(!seen.has(value), path, `duplicate ${name} ${value}`);
    seen.add(value);
  }
}
function assert(condition, path, message) {
  if (!condition) throw new Error(`${path}: ${message}`);
}
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const argvPath = process.argv[1];
if (argvPath !== undefined && import.meta.url === pathToFileURL(resolve(argvPath)).href) {
  const result = verifyNpmPackageContents();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
