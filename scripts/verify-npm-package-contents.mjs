import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditNpmPackageFileSet } from './npm-package-contents-policy.mjs';
import { execNpmSync } from './npm-cli.mjs';

const PLAN_PATH = '.github/release/npm-publication-v1.json';

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
		assert(manifest.name === item.workspaceName, `$.packages.${item.directory}.workspaceName`, `expected package name ${manifest.name}`);
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
	return execNpmSync(
		['pack', '--dry-run', '--json', '--ignore-scripts', `./packages/${directory}`],
		{ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
	);
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
	const evidence = auditNpmPackageFileSet({
		manifest,
		files: result.files,
		manifestPath: `$.${item.directory}`,
		filesPath: `$.${item.directory}.npmPack.files`,
	});
	if (result.entryCount !== undefined) {
		assert(result.entryCount === evidence.fileCount, `$.${item.directory}.npmPack.entryCount`, 'must equal files length');
	}
	return {
		directory: item.directory,
		registryName: item.registryName,
		...evidence,
	};
}

function plannedPackage(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['directory', 'workspaceName'], path);
	const workspaceName = packageName(item.workspaceName, `${path}.workspaceName`);
	return {
		directory: identifier(item.directory, `${path}.directory`),
		workspaceName,
		registryName: workspaceName,
	};
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
function assertExactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const canonicalExpected = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(canonicalExpected), path, `expected keys ${canonicalExpected.join(', ')}`);
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
