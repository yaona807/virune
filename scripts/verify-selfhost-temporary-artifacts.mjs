import { readFile } from 'node:fs/promises';
import { basename, posix, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const defaultRepositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultRegistryPath = '.github/self-hosting-operations/temporary-artifacts.json';
const temporaryDirectories = Object.freeze([
	'.github/workflows/',
	'.github/scripts/',
	'scripts/',
]);

export function verifyTemporaryArtifacts({ paths, registry, requireClean = false }) {
	const normalizedPaths = [...new Set(paths.map(normalizePath).filter(Boolean))].sort();
	const temporaryPaths = normalizedPaths.filter(isTemporaryArtifactPath);
	const entries = validateRegistry(registry);
	const entriesByPath = new Map(entries.map(entry => [entry.path, entry]));

	for (const path of temporaryPaths) {
		if (!entriesByPath.has(path)) throw new Error(`Temporary artifact is not declared: ${path}`);
	}
	for (const entry of entries) {
		if (!normalizedPaths.includes(entry.path)) throw new Error(`Temporary artifact registry entry is stale: ${entry.path}`);
		if (!isTemporaryArtifactPath(entry.path)) throw new Error(`Registry path does not match a temporary-artifact naming rule: ${entry.path}`);
	}
	if (requireClean && entries.length > 0) {
		throw new Error(`Temporary artifacts must be removed before merge: ${entries.map(entry => entry.path).join(', ')}`);
	}

	return {
		schemaVersion: 1,
		claim: 'selfhost-temporary-artifact-inventory',
		status: entries.length === 0 ? 'clean' : 'declared',
		requireClean,
		temporaryArtifactCount: entries.length,
		artifacts: entries,
	};
}

export function isTemporaryArtifactPath(value) {
	const path = normalizePath(value);
	if (!temporaryDirectories.some(directory => path.startsWith(directory))) return false;
	const name = basename(path);
	return /^tmp-/u.test(name) || /\.temporary\.(?:mjs|cjs|js|ts|json|ya?ml)$/u.test(name);
}

function validateRegistry(value) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Temporary artifact registry must be an object');
	}
	const keys = Object.keys(value).sort();
	if (JSON.stringify(keys) !== JSON.stringify(['artifacts', 'schemaVersion'])) {
		throw new Error('Temporary artifact registry must contain only schemaVersion and artifacts');
	}
	if (value.schemaVersion !== 1) throw new Error('Temporary artifact registry schemaVersion must be 1');
	if (!Array.isArray(value.artifacts)) throw new Error('Temporary artifact registry artifacts must be an array');

	const ids = new Set();
	const paths = new Set();
	const entries = value.artifacts.map((entry, index) => validateEntry(entry, index));
	for (const entry of entries) {
		if (ids.has(entry.id)) throw new Error(`Duplicate temporary artifact id: ${entry.id}`);
		if (paths.has(entry.path)) throw new Error(`Duplicate temporary artifact path: ${entry.path}`);
		ids.add(entry.id);
		paths.add(entry.path);
	}
	return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function validateEntry(value, index) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`artifacts[${index}] must be an object`);
	}
	const expectedKeys = [
		'id',
		'path',
		'responsiblePullRequest',
		'removalTrigger',
		'mergeDisposition',
	];
	const actualKeys = Object.keys(value).sort();
	if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
		throw new Error(`artifacts[${index}] has unexpected keys`);
	}
	if (typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.id)) {
		throw new Error(`artifacts[${index}].id must be a lowercase hyphenated identifier`);
	}
	const path = normalizePath(value.path);
	if (path === '' || path !== value.path || path.startsWith('/') || path.split('/').includes('..')) {
		throw new Error(`artifacts[${index}].path must be a normalized repository-relative POSIX path`);
	}
	if (!Number.isSafeInteger(value.responsiblePullRequest) || value.responsiblePullRequest <= 0) {
		throw new Error(`artifacts[${index}].responsiblePullRequest must be a positive safe integer`);
	}
	if (typeof value.removalTrigger !== 'string' || value.removalTrigger.trim() === '') {
		throw new Error(`artifacts[${index}].removalTrigger must be a non-empty string`);
	}
	if (value.mergeDisposition !== 'do-not-merge') {
		throw new Error(`artifacts[${index}].mergeDisposition must be do-not-merge`);
	}
	return {
		id: value.id,
		path,
		responsiblePullRequest: value.responsiblePullRequest,
		removalTrigger: value.removalTrigger,
		mergeDisposition: value.mergeDisposition,
	};
}

function normalizePath(value) {
	if (typeof value !== 'string') return '';
	return posix.normalize(value.trim().replaceAll('\\', '/')).replace(/^\.\//u, '');
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	const repositoryRoot = resolve(options.repositoryRoot ?? defaultRepositoryRoot);
	const registryPath = resolve(repositoryRoot, options.registry ?? defaultRegistryPath);
	const registry = JSON.parse(await readFile(registryPath, 'utf8'));
	const paths = options.pathsFile === undefined
		? trackedPaths(repositoryRoot)
		: (await readFile(resolve(options.pathsFile), 'utf8')).split(/\r?\n/u);
	const result = verifyTemporaryArtifacts({ paths, registry, requireClean: options.requireClean });
	process.stdout.write(`${JSON.stringify(result, null, '\t')}\n`);
}

function trackedPaths(repositoryRoot) {
	const result = spawnSync('git', ['ls-files'], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error !== undefined || result.status !== 0) {
		throw new Error(`Unable to list tracked repository paths: ${result.stderr || result.error?.message}`);
	}
	return result.stdout.split(/\r?\n/u);
}

function parseArguments(argumentsList) {
	const result = { requireClean: false };
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		if (argument === '--repository-root') result.repositoryRoot = argumentsList[++index];
		else if (argument === '--registry') result.registry = argumentsList[++index];
		else if (argument === '--paths-file') result.pathsFile = argumentsList[++index];
		else if (argument === '--require-clean') result.requireClean = true;
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return result;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
