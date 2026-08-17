import { createHash } from 'node:crypto';
import { posix } from 'node:path';

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

export function auditNpmPackageFileSet({ manifest, files, manifestPath, filesPath }) {
	const packageManifest = record(manifest, manifestPath);
	const packedFiles = array(files, filesPath)
		.map((value, index) => packedFile(value, `${filesPath}[${index}]`));
	assert(packedFiles.length > 0, filesPath, 'npm package must contain files');
	assertUnique(packedFiles.map(file => file.path), filesPath, 'path');

	const rules = array(packageManifest.files, `${manifestPath}.files`)
		.map((value, index) => manifestFileRule(value, `${manifestPath}.files[${index}]`));
	assert(rules.length > 0, `${manifestPath}.files`, 'files allowlist is required');
	assertUnique(rules, `${manifestPath}.files`, 'file rule');

	const paths = packedFiles.map(file => file.path).sort(compareText);
	assert(paths.includes('package.json'), filesPath, 'package.json is required');
	for (const path of paths) {
		assert(
			path === 'package.json' || rules.some(rule => matchesRule(path, rule)),
			filesPath,
			`unexpected file outside package.json files allowlist: ${path}`,
		);
		assertSafePackedPath(path, filesPath);
	}
	for (const rule of rules) {
		assert(
			paths.some(path => matchesRule(path, rule)),
			`${manifestPath}.files`,
			`allowlist entry does not select any packed file: ${rule}`,
		);
	}

	for (const target of collectManifestTargets(packageManifest.exports, `${manifestPath}.exports`)) {
		assertTargetPacked(paths, target, `${manifestPath}.exports`);
	}
	if (packageManifest.bin !== undefined) {
		if (typeof packageManifest.bin === 'string') {
			assertTargetPacked(paths, packageManifest.bin, `${manifestPath}.bin`);
		} else {
			const bins = record(packageManifest.bin, `${manifestPath}.bin`);
			for (const [name, target] of Object.entries(bins)) {
				assertTargetPacked(paths, target, `${manifestPath}.bin.${name}`);
			}
		}
	}

	return {
		fileCount: paths.length,
		fileSetSha256: createHash('sha256').update(`${paths.join('\n')}\n`).digest('hex'),
		unpackedBytes: packedFiles.reduce((total, file) => total + file.size, 0),
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

function assertSafePackedPath(path, filesPath) {
	const lower = path.toLowerCase();
	const segments = lower.split('/');
	const basename = segments.at(-1) ?? '';
	for (const segment of segments) {
		assert(!FORBIDDEN_SEGMENTS.has(segment), filesPath, `development-only path is forbidden: ${path}`);
	}
	assert(!FORBIDDEN_BASENAMES.has(basename), filesPath, `high-risk development or credential file is forbidden: ${path}`);
	assert(!/\.(?:pem|p12|pfx|key)$/iu.test(basename), filesPath, `credential-like file is forbidden: ${path}`);
	assert(!/\.(?:test|spec)\.(?:[cm]?[jt]sx?|d\.[cm]?ts|js\.map)$/iu.test(basename), filesPath, `test artifact is forbidden: ${path}`);
	if (/\.(?:ts|tsx|mts|cts)$/iu.test(basename)) {
		assert(/\.d\.(?:ts|mts|cts)$/iu.test(basename), filesPath, `raw TypeScript source is forbidden: ${path}`);
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
