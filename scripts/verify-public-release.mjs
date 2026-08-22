import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { registryPolicyForVersion } from './verify-npm-publication-identity.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXPECTED_LICENSE = 'Apache-2.0';
const REVIEWED_LEGAL_FILES = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_ja.md'];
const NPM_PUBLICATION_POLICY_PATH = '.github/release/npm-publication-v1.json';
const NPM_PUBLICATION_POLICY = JSON.parse(await readFile(new URL(`../${NPM_PUBLICATION_POLICY_PATH}`, import.meta.url), 'utf8'));

export async function verifyPublicRelease({
	version,
	expectedCommit,
	repository = process.env.GITHUB_REPOSITORY ?? 'yaona807/virune',
	token = process.env.GITHUB_TOKEN,
	outputDirectory = resolve(repositoryRoot, '.cache/public-release'),
	waitAttempts = 60,
	waitIntervalMs = 10_000,
	fetchImpl = fetch,
	runCommand = execute,
} = {}) {
	if (typeof version !== 'string' || !/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/u.test(version)) throw new Error('A prerelease semantic version is required.');
	if (expectedCommit !== undefined && !/^[0-9a-f]{40}$/u.test(expectedCommit)) throw new Error('expectedCommit must be a full commit SHA.');
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });
	const tag = `v${version}`;
	const release = await waitForRelease({ repository, tag, token, attempts: waitAttempts, intervalMs: waitIntervalMs, fetchImpl });
	const tagRef = await fetchJson(`https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, { token, fetchImpl });
	const reviewedCommit = resolveReviewedCommit(tag, tagRef?.object?.sha, expectedCommit);
	const npmPublicationPolicy = await readReviewedNpmPublicationPolicy(reviewedCommit, version);
	validateReleaseRecord(release, { tag, version, npmPublicationPolicy });
	for (const asset of release.assets) {
		const response = await fetchImpl(asset.browser_download_url, { headers: requestHeaders(token) });
		if (!response.ok) throw new Error(`Failed to download ${asset.name}: HTTP ${response.status}`);
		await writeFile(resolve(outputDirectory, asset.name), Buffer.from(await response.arrayBuffer()));
	}
	const integrity = await validateDownloadedRelease(outputDirectory, version, { reviewedCommit });
	const installation = await validatePublicInstallation({ version, repository, runCommand });
	const report = {
		schemaVersion: 1,
		version,
		tag,
		tagCommit: reviewedCommit,
		expectedCommit: expectedCommit ?? null,
		repository,
		release: {
			id: release.id,
			htmlUrl: release.html_url,
			publishedAt: release.published_at,
			prerelease: release.prerelease,
			draft: release.draft,
			targetCommitish: release.target_commitish,
		},
		assets: integrity.assets,
		manifest: integrity.manifest,
		sbom: integrity.sbom,
		installation,
		verifiedAt: new Date().toISOString(),
		passed: true,
	};
	await writeFile(resolve(outputDirectory, 'public-release-report.json'), `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	console.log(`Verified public release ${tag}: ${release.html_url}`);
	return report;
}

export function resolveReviewedCommit(tag, tagCommit, expectedCommit) {
	if (typeof tagCommit !== 'string' || !/^[0-9a-f]{40}$/u.test(tagCommit)) throw new Error(`Tag ${tag} did not resolve to a commit SHA.`);
	if (expectedCommit !== undefined && tagCommit !== expectedCommit) throw new Error(`Tag ${tag} points to ${tagCommit}, expected ${expectedCommit}.`);
	return tagCommit;
}

export async function readReviewedNpmPublicationPolicy(reviewedCommit, version, {
	sourceRoot = repositoryRoot,
	readReviewed = readReviewedFile,
	fallbackPolicy = NPM_PUBLICATION_POLICY,
} = {}) {
	let source;
	try {
		source = await readReviewed(NPM_PUBLICATION_POLICY_PATH, { sourceRoot, reviewedCommit });
	} catch (error) {
		const legacyPolicy = registryPolicyForVersion(version, fallbackPolicy.firstStableRegistryRelease, fallbackPolicy.distTagPolicy);
		if (legacyPolicy.registryVersionEligible) throw error;
		return fallbackPolicy;
	}
	try {
		return JSON.parse(Buffer.from(source).toString('utf8'));
	} catch (error) {
		throw new Error(`Reviewed npm publication policy is malformed at ${reviewedCommit}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function validateReleaseRecord(release, { tag, version, npmPublicationPolicy = NPM_PUBLICATION_POLICY }) {
	if (release?.tag_name !== tag) throw new Error(`Expected release tag ${tag}.`);
	if (release.draft !== false) throw new Error('Release must not be a draft.');
	if (release.prerelease !== true) throw new Error('Release candidate must be a prerelease.');
	if (!Array.isArray(release.assets) || release.assets.length === 0) throw new Error('Release has no uploaded assets.');
	const names = new Set(release.assets.map(asset => asset.name));
	for (const required of requiredAssetNames(version, npmPublicationPolicy)) if (!names.has(required)) throw new Error(`Release is missing ${required}.`);
}

export async function validateDownloadedRelease(directory, version, { sourceRoot = repositoryRoot, reviewedCommit } = {}) {
	if (reviewedCommit !== undefined && !/^[0-9a-f]{40}$/u.test(reviewedCommit)) throw new Error('reviewedCommit must be a full commit SHA.');
	const files = (await readdir(directory)).sort();
	const checksums = parseChecksums(await readFile(resolve(directory, 'SHA256SUMS'), 'utf8'));
	const expectedChecksumFiles = files.filter(file => file !== 'SHA256SUMS').sort();
	assertSameSet([...checksums.keys()].sort(), expectedChecksumFiles, 'SHA256SUMS file set');
	const assets = [];
	for (const file of expectedChecksumFiles) {
		const bytes = await readFile(resolve(directory, file));
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		if (checksums.get(file) !== sha256) throw new Error(`SHA-256 mismatch for ${file}.`);
		assets.push({ file, sha256, bytes: bytes.byteLength });
	}
	const manifest = JSON.parse(await readFile(resolve(directory, 'RELEASE-MANIFEST.json'), 'utf8'));
	if (manifest.schemaVersion !== 2 || manifest.version !== version) throw new Error('Invalid release manifest identity.');
	const manifestFiles = manifest.files.map(item => item.file).sort();
	const expectedManifestFiles = files.filter(file => file !== 'RELEASE-MANIFEST.json' && file !== 'SHA256SUMS').sort();
	assertSameSet(manifestFiles, expectedManifestFiles, 'RELEASE-MANIFEST file set');
	const assetByName = new Map(assets.map(item => [item.file, item]));
	for (const item of manifest.files) {
		const actual = assetByName.get(item.file);
		if (actual?.sha256 !== item.sha256 || actual.bytes !== item.bytes) throw new Error(`Manifest mismatch for ${item.file}.`);
	}

	const releasePackage = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
	if (releasePackage.version !== version) throw new Error('Public release package.json version does not match the candidate.');
	if (releasePackage.license !== EXPECTED_LICENSE) {
		throw new Error(`Public release package.json license must be exactly ${EXPECTED_LICENSE}.`);
	}
	for (const file of REVIEWED_LEGAL_FILES) {
		const [published, reviewed] = await Promise.all([
			readFile(resolve(directory, file)),
			readReviewedFile(file, { sourceRoot, reviewedCommit }),
		]);
		if (!published.equals(reviewed)) throw new Error(`Public release ${file} does not match the reviewed release source.`);
	}

	const sbom = JSON.parse(await readFile(resolve(directory, 'SBOM.cdx.json'), 'utf8'));
	if (sbom.bomFormat !== 'CycloneDX' || sbom.specVersion !== '1.6') throw new Error('Release SBOM is not CycloneDX 1.6.');
	if (sbom.metadata?.component?.version !== version) throw new Error('Release SBOM version does not match the candidate.');
	const rootLicenses = sbom.metadata?.component?.licenses;
	if (!Array.isArray(rootLicenses) || rootLicenses.length !== 1 || rootLicenses[0]?.license?.id !== EXPECTED_LICENSE) {
		throw new Error(`Release SBOM root license must be exactly ${EXPECTED_LICENSE}.`);
	}
	const sbomAsset = assetByName.get('SBOM.cdx.json');
	if (manifest.sbom?.sha256 !== sbomAsset?.sha256 || manifest.sbom?.bytes !== sbomAsset?.bytes) throw new Error('SBOM manifest digest mismatch.');
	return {
		assets,
		manifest: { schemaVersion: manifest.schemaVersion, version: manifest.version, fileCount: manifest.files.length },
		sbom: { format: sbom.bomFormat, specVersion: sbom.specVersion, serialNumber: sbom.serialNumber, componentCount: sbom.components?.length ?? 0, license: EXPECTED_LICENSE },
	};
}

export function parseChecksums(source) {
	const output = new Map();
	for (const line of source.trim().split(/\r?\n/u)) {
		const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
		if (match === null) throw new Error(`Invalid SHA256SUMS line: ${line}`);
		if (output.has(match[2])) throw new Error(`Duplicate checksum entry: ${match[2]}`);
		output.set(match[2], match[1]);
	}
	return output;
}

async function readReviewedFile(file, { sourceRoot, reviewedCommit }) {
	if (reviewedCommit === undefined) return readFile(resolve(sourceRoot, file));
	const result = spawnSync('git', ['show', `${reviewedCommit}:${file}`], {
		cwd: sourceRoot,
		encoding: null,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error !== undefined) throw new Error(`Failed to read reviewed ${file} from ${reviewedCommit}: ${result.error.message}`);
	if ((result.status ?? 1) !== 0) {
		throw new Error(`Failed to read reviewed ${file} from ${reviewedCommit}: ${(result.stderr ?? Buffer.alloc(0)).toString('utf8').trim()}`);
	}
	return result.stdout;
}

async function validatePublicInstallation({ version, repository, runCommand }) {
	const root = await mkdtemp(join(tmpdir(), 'virune-public-release-'));
	try {
		const prefix = resolve(root, 'prefix');
		const project = resolve(root, 'project');
		const cliUrl = `https://github.com/${repository}/releases/download/v${version}/virune-${version}.tgz`;
		runCommand('npm', ['install', '--global', cliUrl, '--prefix', prefix, '--no-audit', '--no-fund'], { cwd: root });
		const executable = resolve(prefix, 'bin/virune');
		await chmod(executable, 0o755);
		const versionResult = runCommand(executable, ['--version'], { cwd: root, capture: true });
		if (versionResult.stdout.trim() !== `virune ${version}`) throw new Error(`Unexpected CLI version: ${versionResult.stdout.trim()}`);
		runCommand(executable, ['init', project], { cwd: root });
		const generated = JSON.parse(await readFile(resolve(project, 'package.json'), 'utf8'));
		for (const url of [...Object.values(generated.dependencies ?? {}), ...Object.values(generated.devDependencies ?? {})]) {
			if (typeof url !== 'string' || !url.includes(`/releases/download/v${version}/`) || !url.includes(version)) throw new Error(`Generated project contains a non-candidate dependency: ${String(url)}`);
		}
		runCommand('npm', ['install', '--no-audit', '--no-fund'], { cwd: project });
		runCommand('npm', ['run', 'check'], { cwd: project });
		runCommand('npm', ['run', 'build'], { cwd: project });
		const run = runCommand('npm', ['run', 'start'], { cwd: project, capture: true });
		if (!run.stdout.includes('Hello from Virune')) throw new Error('Generated project did not run successfully.');
		return {
			cliUrl,
			versionOutput: versionResult.stdout.trim(),
			generatedProject: {
				dependencyCount: Object.keys(generated.dependencies ?? {}).length + Object.keys(generated.devDependencies ?? {}).length,
				check: 'passed', build: 'passed', run: 'passed',
			},
		};
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
	}
}

async function waitForRelease({ repository, tag, token, attempts, intervalMs, fetchImpl }) {
	const url = `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		const response = await fetchImpl(url, { headers: apiHeaders(token) });
		if (response.ok) return response.json();
		if (response.status !== 404 || attempt === attempts) throw new Error(`Release API returned HTTP ${response.status} for ${tag}.`);
		await new Promise(resolvePromise => setTimeout(resolvePromise, intervalMs));
	}
	throw new Error(`Release ${tag} was not published.`);
}

async function fetchJson(url, { token, fetchImpl }) {
	const response = await fetchImpl(url, { headers: apiHeaders(token) });
	if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status} for ${url}.`);
	return response.json();
}

function apiHeaders(token) {
	return { ...requestHeaders(token), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}

function requestHeaders(token) {
	return token === undefined || token === '' ? {} : { Authorization: `Bearer ${token}` };
}

function requiredAssetNames(version, npmPublicationPolicy) {
	const required = [
		'LICENSE', 'MANIFEST.json', 'NOTICE', 'README.md', 'README_ja.md', 'RELEASE-MANIFEST.json', 'SBOM.cdx.json', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_ja.md', 'package.json',
		`virune-${version}.tgz`, `virune-compiler-${version}.tgz`, `virune-formatter-${version}.tgz`, `virune-js-interop-${version}.tgz`, `virune-runtime-${version}.tgz`, `virune-stdlib-${version}.tgz`, `virune-vscode-${version}.vsix`,
	];
	const registryPolicy = registryPolicyForVersion(version, npmPublicationPolicy.firstStableRegistryRelease, npmPublicationPolicy.distTagPolicy);
	if (registryPolicy.registryVersionEligible) required.push('PUBLICATION-MANIFEST.json', `virune-npm-${version}.tgz`);
	return required;
}

function assertSameSet(actual, expected, label) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function execute(command, args, { cwd, capture = false } = {}) {
	const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
	const result = spawnSync(executable, args, {
		cwd, env: process.env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error !== undefined) throw result.error;
	if ((result.status ?? 1) !== 0) throw new Error(`${basename(command)} ${args.join(' ')} exited with ${result.status}${capture ? `\n${result.stdout}\n${result.stderr}` : ''}`);
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const version = process.argv.find(argument => argument.startsWith('--version='))?.slice('--version='.length);
	const expectedCommit = process.argv.find(argument => argument.startsWith('--expected-commit='))?.slice('--expected-commit='.length);
	const outputDirectory = process.argv.find(argument => argument.startsWith('--output='))?.slice('--output='.length);
	await verifyPublicRelease({ version, expectedCommit, ...(outputDirectory === undefined ? {} : { outputDirectory: resolve(outputDirectory) }) });
}
