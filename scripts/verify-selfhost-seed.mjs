import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DEFAULT_SEED_MANIFEST = resolve(repositoryRoot, '.github/self-hosting/stage0-seed.json');
export const EXPECTED_BASELINES = Object.freeze({
	node: '24.0.0',
	runtimeAbi: '2',
	interopAbi: '2',
	normalizedArtifactPolicy: '1',
});

export async function verifySelfhostSeed({
	root = repositoryRoot,
	manifestPath = resolve(root, '.github/self-hosting/stage0-seed.json'),
	artifactPath,
	cacheDirectory = resolve(root, '.cache/selfhost-seed'),
	fetchImpl = globalThis.fetch,
	packageMetadataReader = readPackageMetadataFromTarball,
} = {}) {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	validateSeedManifest(manifest);
	await verifyReleaseEvidence(root, manifest);
	await verifyNoAutomaticSeedUpdate(root, manifest);

	const resolvedArtifact = artifactPath ?? resolve(cacheDirectory, manifest.artifact.file);
	if (artifactPath === undefined && !await exists(resolvedArtifact)) {
		await downloadArtifact(manifest.artifact.url, resolvedArtifact, fetchImpl);
	}
	if (!await exists(resolvedArtifact)) throw new Error(`Stage 0 seed artifact is missing: ${resolvedArtifact}`);

	const bytes = await readFile(resolvedArtifact);
	if (bytes.byteLength !== manifest.artifact.bytes) {
		throw new Error(`Stage 0 seed size mismatch for ${manifest.artifact.file}: expected ${manifest.artifact.bytes}, received ${bytes.byteLength}`);
	}
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	if (sha256 !== manifest.artifact.sha256) {
		throw new Error(`Stage 0 seed checksum mismatch for ${manifest.artifact.file}: expected ${manifest.artifact.sha256}, received ${sha256}`);
	}

	const packageMetadata = await packageMetadataReader(resolvedArtifact);
	verifyPackageMetadata(packageMetadata, manifest);
	return {
		schemaVersion: 1,
		seedId: manifest.seedId,
		artifact: resolvedArtifact,
		sha256,
		bytes: bytes.byteLength,
		package: {
			name: packageMetadata.name,
			version: packageMetadata.version,
			node: packageMetadata.engines?.node,
		},
		baselines: manifest.baselines,
		passed: true,
	};
}

export function validateSeedManifest(manifest) {
	assertRecord(manifest, 'manifest');
	assertExactKeys(manifest, ['schemaVersion', 'seedId', 'viruneVersion', 'languageVersion', 'release', 'artifact', 'baselines', 'policy'], 'manifest');
	assertEqual(manifest.schemaVersion, 1, 'manifest.schemaVersion');
	assertNonEmptyString(manifest.seedId, 'manifest.seedId');
	assertVersion(manifest.viruneVersion, 'manifest.viruneVersion');
	assertEqual(manifest.languageVersion, '1.0', 'manifest.languageVersion');

	assertRecord(manifest.release, 'manifest.release');
	assertExactKeys(manifest.release, ['repository', 'tag', 'commit', 'url', 'verificationEvidence', 'verificationRunId', 'recoveryRunId'], 'manifest.release');
	assertEqual(manifest.release.repository, 'yaona807/virune', 'manifest.release.repository');
	assertEqual(manifest.release.tag, `v${manifest.viruneVersion}`, 'manifest.release.tag');
	assertSha(manifest.release.commit, 'manifest.release.commit', 40);
	assertEqual(manifest.release.url, `https://github.com/${manifest.release.repository}/releases/tag/${manifest.release.tag}`, 'manifest.release.url');
	assertEqual(manifest.release.verificationEvidence, `.github/release-verification/v${manifest.viruneVersion}.json`, 'manifest.release.verificationEvidence');
	assertPositiveInteger(manifest.release.verificationRunId, 'manifest.release.verificationRunId');
	assertPositiveInteger(manifest.release.recoveryRunId, 'manifest.release.recoveryRunId');

	assertRecord(manifest.artifact, 'manifest.artifact');
	assertExactKeys(manifest.artifact, ['file', 'url', 'sha256', 'bytes', 'package'], 'manifest.artifact');
	assertEqual(manifest.artifact.file, `virune-compiler-${manifest.viruneVersion}.tgz`, 'manifest.artifact.file');
	assertEqual(manifest.artifact.url, `https://github.com/${manifest.release.repository}/releases/download/${manifest.release.tag}/${manifest.artifact.file}`, 'manifest.artifact.url');
	assertSha(manifest.artifact.sha256, 'manifest.artifact.sha256', 64);
	assertPositiveInteger(manifest.artifact.bytes, 'manifest.artifact.bytes');
	assertRecord(manifest.artifact.package, 'manifest.artifact.package');
	assertExactKeys(manifest.artifact.package, ['name', 'version', 'type', 'node', 'runtimeDependency'], 'manifest.artifact.package');
	assertEqual(manifest.artifact.package.name, '@virune/compiler', 'manifest.artifact.package.name');
	assertEqual(manifest.artifact.package.version, manifest.viruneVersion, 'manifest.artifact.package.version');
	assertEqual(manifest.artifact.package.type, 'module', 'manifest.artifact.package.type');
	assertEqual(manifest.artifact.package.node, '>=24.0.0', 'manifest.artifact.package.node');
	assertEqual(manifest.artifact.package.runtimeDependency, manifest.viruneVersion, 'manifest.artifact.package.runtimeDependency');

	assertRecord(manifest.baselines, 'manifest.baselines');
	assertExactKeys(manifest.baselines, ['node', 'runtimeAbi', 'interopAbi', 'normalizedArtifactPolicy'], 'manifest.baselines');
	for (const [key, expected] of Object.entries(EXPECTED_BASELINES)) assertEqual(manifest.baselines[key], expected, `manifest.baselines.${key}`);

	assertRecord(manifest.policy, 'manifest.policy');
	assertExactKeys(manifest.policy, ['updateMode', 'automaticUpdates', 'review'], 'manifest.policy');
	assertEqual(manifest.policy.updateMode, 'reviewed-pull-request-only', 'manifest.policy.updateMode');
	assertEqual(manifest.policy.automaticUpdates, false, 'manifest.policy.automaticUpdates');
	assertRecord(manifest.policy.review, 'manifest.policy.review');
	assertExactKeys(manifest.policy.review, ['issue', 'pullRequest'], 'manifest.policy.review');
	assertPositiveInteger(manifest.policy.review.issue, 'manifest.policy.review.issue');
	assertPositiveInteger(manifest.policy.review.pullRequest, 'manifest.policy.review.pullRequest');
	return manifest;
}

async function verifyReleaseEvidence(root, manifest) {
	const evidencePath = resolve(root, manifest.release.verificationEvidence);
	const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
	if (evidence.passed !== true) throw new Error(`Release verification evidence is not successful: ${manifest.release.verificationEvidence}`);
	assertEqual(evidence.version, manifest.viruneVersion, 'release evidence version');
	assertEqual(evidence.tag, manifest.release.tag, 'release evidence tag');
	assertEqual(evidence.tagCommit, manifest.release.commit, 'release evidence tag commit');
	assertEqual(evidence.verificationRunId, manifest.release.verificationRunId, 'release evidence verification run');
	const asset = evidence.assets?.find(item => item.file === manifest.artifact.file);
	if (asset === undefined) throw new Error(`Release verification evidence does not contain ${manifest.artifact.file}`);
	assertEqual(asset.sha256, manifest.artifact.sha256, 'release evidence asset sha256');
	assertEqual(asset.bytes, manifest.artifact.bytes, 'release evidence asset bytes');
}

async function verifyNoAutomaticSeedUpdate(root, manifest) {
	const packageManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
	for (const [name, command] of Object.entries(packageManifest.scripts ?? {})) {
		if (/selfhost.*seed.*update|seed.*update.*selfhost/iu.test(name) || (/stage0-seed\.json/u.test(String(command)) && /(?:write|update|replace|copy|\bcp\b|\bmv\b|\btee\b|>)/iu.test(String(command)))) {
			throw new Error(`Automatic Stage 0 seed update path is forbidden: package script ${name}`);
		}
	}
	const workflowRoot = resolve(root, '.github/workflows');
	for (const entry of await readdir(workflowRoot, { withFileTypes: true })) {
		if (!entry.isFile() || !/\.ya?ml$/u.test(entry.name)) continue;
		const source = await readFile(resolve(workflowRoot, entry.name), 'utf8');
		if (/stage0-seed\.json/u.test(source) && /(?:sed\s+-i|writeFile|\bcp\b|\bmv\b|\btee\b|gh\s+api[^\n]*--method\s+(?:PUT|PATCH)|>\s*[^\n]*stage0-seed\.json)/iu.test(source)) {
			throw new Error(`Automatic Stage 0 seed update path is forbidden: .github/workflows/${entry.name}`);
		}
	}
	if (manifest.policy.automaticUpdates !== false) throw new Error('Stage 0 seed automatic updates must remain disabled');
}

async function downloadArtifact(url, target, fetchImpl) {
	if (typeof fetchImpl !== 'function') throw new Error('Global fetch is unavailable; pass --artifact with a local Stage 0 seed file');
	const response = await fetchImpl(url, { redirect: 'follow', headers: { 'user-agent': 'virune-selfhost-seed-verifier/1' } });
	if (!response.ok) throw new Error(`Failed to download Stage 0 seed: HTTP ${response.status} ${response.statusText}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	await mkdir(dirname(target), { recursive: true });
	const temporary = `${target}.part`;
	await writeFile(temporary, bytes);
	await rename(temporary, target);
}

export async function readPackageMetadataFromTarball(artifactPath) {
	const result = spawnSync('tar', ['-xOf', artifactPath, 'package/package.json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
	if (result.error !== undefined) throw new Error(`Failed to start tar while reading Stage 0 seed metadata: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`Failed to read package/package.json from Stage 0 seed: ${(result.stderr || result.stdout).trim()}`);
	try { return JSON.parse(result.stdout); }
	catch (error) { throw new Error(`Stage 0 seed package metadata is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function verifyPackageMetadata(metadata, manifest) {
	assertRecord(metadata, 'seed package metadata');
	assertEqual(metadata.name, manifest.artifact.package.name, 'seed package name');
	assertEqual(metadata.version, manifest.artifact.package.version, 'seed package version');
	assertEqual(metadata.type, manifest.artifact.package.type, 'seed package type');
	assertEqual(metadata.engines?.node, manifest.artifact.package.node, 'seed package Node.js baseline');
	assertEqual(metadata.dependencies?.['@virune/runtime'], manifest.artifact.package.runtimeDependency, 'seed package runtime dependency');
}

function assertRecord(value, path) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
}
function assertExactKeys(value, expected, path) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${path} keys mismatch: expected ${wanted.join(', ')}, received ${actual.join(', ')}`);
}
function assertEqual(actual, expected, path) {
	if (actual !== expected) throw new Error(`${path} mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}
function assertNonEmptyString(value, path) {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string`);
}
function assertVersion(value, path) {
	if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) throw new Error(`${path} must be a semantic version`);
}
function assertSha(value, path, length) {
	if (typeof value !== 'string' || !new RegExp(`^[0-9a-f]{${length}}$`, 'u').test(value)) throw new Error(`${path} must be a lowercase ${length}-character hexadecimal digest`);
}
function assertPositiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer`);
}
async function exists(path) {
	try { await access(path); return true; } catch { return false; }
}

function parseArguments(argumentsList) {
	const options = {};
	for (let index = 0; index < argumentsList.length; index++) {
		const argument = argumentsList[index];
		if (argument === '--manifest') options.manifestPath = resolve(argumentsList[++index] ?? '');
		else if (argument === '--artifact') options.artifactPath = resolve(argumentsList[++index] ?? '');
		else if (argument === '--cache-dir') options.cacheDirectory = resolve(argumentsList[++index] ?? '');
		else if (argument === '--json') options.json = true;
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return options;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const options = parseArguments(process.argv.slice(2));
		const report = await verifySelfhostSeed(options);
		if (options.json) console.log(JSON.stringify(report, null, '\t'));
		else console.log(`Verified Stage 0 seed ${report.seedId}: ${report.sha256} (${report.bytes} bytes)`);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
