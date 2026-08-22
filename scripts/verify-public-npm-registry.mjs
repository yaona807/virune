import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
	bundledCliReleaseAssetName,
	registryPolicyForVersion,
	registryReleaseAssetNameForPackage,
} from './verify-npm-publication-identity.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const DEFAULT_PUBLICATION_MANIFEST = resolve(repositoryRoot, '.cache/public-release/PUBLICATION-MANIFEST.json');
const DEFAULT_PUBLIC_RELEASE_REPORT = resolve(repositoryRoot, '.cache/public-release/public-release-report.json');
const DEFAULT_OUTPUT = resolve(repositoryRoot, '.cache/public-npm-registry/public-npm-registry-report.json');
const PUBLICATION_PLAN_PATH = '.github/release/npm-publication-v1.json';
const SAFE_PROCESS_ENV = new Set(['CI', 'COMSPEC', 'LANG', 'LC_ALL', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'WINDIR']);

export async function verifyPublicNpmRegistry({
	reviewedCommit,
	publicationManifest,
	publicationManifestPath = DEFAULT_PUBLICATION_MANIFEST,
	publicReleaseReport,
	publicReleaseReportPath = DEFAULT_PUBLIC_RELEASE_REPORT,
	publicationPlan,
	sourceRoot = repositoryRoot,
	outputPath = DEFAULT_OUTPUT,
	fetchImpl = fetch,
	runCommand = execute,
	platform = process.platform,
	baseEnv = process.env,
} = {}) {
	if (outputPath !== null) await rm(outputPath, { force: true });
	const exactCommit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const plan = publicationPlan ?? readReviewedPublicationPlan(exactCommit, { sourceRoot });
	const publicationManifestBytes = publicationManifest === undefined
		? await readFile(publicationManifestPath)
		: Buffer.from(`${JSON.stringify(publicationManifest, null, 2)}\n`, 'utf8');
	let manifest;
	try {
		manifest = publicationManifest ?? JSON.parse(publicationManifestBytes.toString('utf8'));
	} catch (error) {
		throw new Error(`Reviewed PUBLICATION-MANIFEST.json is malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	let releaseReport = publicReleaseReport;
	if (releaseReport === undefined) {
		try {
			releaseReport = JSON.parse(await readFile(publicReleaseReportPath, 'utf8'));
		} catch (error) {
			throw new Error(`Public release verification report is missing or malformed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const releaseBinding = validatePublicReleaseBinding(releaseReport, {
		reviewedCommit: exactCommit,
		publicationManifestBytes,
		version: manifest?.version,
	});
	const reviewed = validateReviewedPublicationManifest(manifest, plan);
	const packages = [];
	for (const pkg of reviewed.packages) {
		packages.push(await verifyRegistryPackage(pkg, reviewed.version, reviewed.distTag, { fetchImpl }));
	}
	packages.sort((left, right) => compareText(left.registryName, right.registryName));
	const installation = await verifyCleanGlobalCliInstall(reviewed.version, { runCommand, platform, baseEnv });
	const report = {
		schemaVersion: 1,
		registry: PUBLIC_REGISTRY,
		version: reviewed.version,
		githubReleaseTag: reviewed.githubReleaseTag,
		reviewedCommit: exactCommit,
		distTag: reviewed.distTag,
		releaseBinding,
		packages,
		installation,
		passed: true,
	};
	if (outputPath !== null) {
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	}
	return report;
}

export function validatePublicReleaseBinding(report, { reviewedCommit, publicationManifestBytes, version }) {
	const document = record(report, '$.publicReleaseReport');
	assert(document.schemaVersion === 1, '$.publicReleaseReport.schemaVersion', 'expected 1');
	const releaseVersion = nonEmptyString(version, '$.publicationManifest.version');
	assert(document.version === releaseVersion, '$.publicReleaseReport.version', `expected ${releaseVersion}`);
	assert(document.tag === `v${releaseVersion}`, '$.publicReleaseReport.tag', `expected v${releaseVersion}`);
	assert(document.tagCommit === reviewedCommit, '$.publicReleaseReport.tagCommit', `expected ${reviewedCommit}`);
	assert(document.expectedCommit === reviewedCommit, '$.publicReleaseReport.expectedCommit', `expected ${reviewedCommit}`);
	assert(document.passed === true, '$.publicReleaseReport.passed', 'public release verification must have passed');
	const release = record(document.release, '$.publicReleaseReport.release');
	assert(release.draft === false, '$.publicReleaseReport.release.draft', 'release must not be a draft');
	const expectedPrerelease = releaseVersion.includes('-');
	assert(
		release.prerelease === expectedPrerelease,
		'$.publicReleaseReport.release.prerelease',
		expectedPrerelease ? 'release must be a prerelease' : 'stable release must not be a prerelease',
	);
	const attestations = record(document.attestations, '$.publicReleaseReport.attestations');
	assertExactKeys(attestations, ['cyclonedx', 'provenance'], '$.publicReleaseReport.attestations');
	assert(attestations.provenance === 'passed', '$.publicReleaseReport.attestations.provenance', 'provenance verification must have passed');
	assert(attestations.cyclonedx === 'passed', '$.publicReleaseReport.attestations.cyclonedx', 'CycloneDX attestation verification must have passed');
	const vsix = record(document.vsix, '$.publicReleaseReport.vsix');
	assertExactKeys(vsix, ['activation', 'cleanInstall', 'file', 'languageServer', 'uninstall'], '$.publicReleaseReport.vsix');
	assert(vsix.file === `virune-vscode-${releaseVersion}.vsix`, '$.publicReleaseReport.vsix.file', `expected virune-vscode-${releaseVersion}.vsix`);
	for (const field of ['cleanInstall', 'activation', 'languageServer', 'uninstall']) {
		assert(vsix[field] === 'passed', `$.publicReleaseReport.vsix.${field}`, 'VSIX verification must have passed');
	}
	const assets = array(document.assets, '$.publicReleaseReport.assets');
	const publicationAssets = assets.filter((item, index) => {
		const asset = record(item, `$.publicReleaseReport.assets[${index}]`);
		return asset.file === 'PUBLICATION-MANIFEST.json';
	});
	assert(publicationAssets.length === 1, '$.publicReleaseReport.assets', 'expected exactly one PUBLICATION-MANIFEST.json asset');
	const asset = record(publicationAssets[0], '$.publicReleaseReport.assets.PUBLICATION-MANIFEST.json');
	const expectedSha256 = nonEmptyString(asset.sha256, '$.publicReleaseReport.assets.PUBLICATION-MANIFEST.json.sha256');
	assert(/^[0-9a-f]{64}$/u.test(expectedSha256), '$.publicReleaseReport.assets.PUBLICATION-MANIFEST.json.sha256', 'expected lowercase SHA-256');
	assert(Number.isSafeInteger(asset.bytes) && asset.bytes > 0, '$.publicReleaseReport.assets.PUBLICATION-MANIFEST.json.bytes', 'expected positive safe integer byte size');
	const bytes = Buffer.from(publicationManifestBytes);
	const actualSha256 = createHash('sha256').update(bytes).digest('hex');
	assert(actualSha256 === expectedSha256, '$.publicReleaseReport.assets.PUBLICATION-MANIFEST.json.sha256', 'does not match reviewed PUBLICATION-MANIFEST.json bytes');
	assert(bytes.byteLength === asset.bytes, '$.publicReleaseReport.assets.PUBLICATION-MANIFEST.json.bytes', 'does not match reviewed PUBLICATION-MANIFEST.json byte size');
	return { publicationManifestSha256: actualSha256, publicationManifestBytes: bytes.byteLength };
}

export function validateReviewedPublicationManifest(manifest, plan) {
	const document = record(manifest, '$.publicationManifest');
	assertExactKeys(document, [
		'schemaVersion', 'version', 'githubReleaseTag', 'publishSource', 'bundledCliReleaseAsset',
		'publicationReady', 'registryVersionEligible', 'distTag', 'packages',
	], '$.publicationManifest');
	assert(document.schemaVersion === 1, '$.publicationManifest.schemaVersion', 'expected 1');
	const version = nonEmptyString(document.version, '$.publicationManifest.version');
	assert(document.githubReleaseTag === `v${version}`, '$.publicationManifest.githubReleaseTag', `expected v${version}`);
	assert(document.publishSource === 'reviewed-release-registry-candidate-tarball', '$.publicationManifest.publishSource', 'unexpected publication source');
	assert(document.bundledCliReleaseAsset === bundledCliReleaseAssetName(version), '$.publicationManifest.bundledCliReleaseAsset', 'bundled CLI release asset drift');
	assert(document.publicationReady === true, '$.publicationManifest.publicationReady', 'public Registry verification requires a reviewed publication-ready candidate');
	assert(document.registryVersionEligible === true, '$.publicationManifest.registryVersionEligible', 'public Registry verification requires a Registry-eligible version');

	const policy = record(plan, '$.publicationPlan');
	const registryPolicy = registryPolicyForVersion(
		version,
		nonEmptyString(policy.firstStableRegistryRelease, '$.publicationPlan.firstStableRegistryRelease'),
		record(policy.distTagPolicy, '$.publicationPlan.distTagPolicy'),
	);
	assert(registryPolicy.registryVersionEligible === true, '$.publicationManifest.version', 'version is not eligible for npm Registry publication');
	assert(document.distTag === registryPolicy.distTag, '$.publicationManifest.distTag', `expected ${String(registryPolicy.distTag)}`);

	const planPackages = array(policy.packages, '$.publicationPlan.packages').map((item, index) => {
		const pkg = record(item, `$.publicationPlan.packages[${index}]`);
		return nonEmptyString(pkg.registryName, `$.publicationPlan.packages[${index}].registryName`);
	});
	assertUnique(planPackages, '$.publicationPlan.packages', 'registryName');
	const expectedNames = [...planPackages].sort(compareText);
	const packages = array(document.packages, '$.publicationManifest.packages').map((item, index) => {
		const pkg = record(item, `$.publicationManifest.packages[${index}]`);
		assertExactKeys(pkg, ['registryName', 'releaseAsset', 'sha256', 'bytes'], `$.publicationManifest.packages[${index}]`);
		const registryName = nonEmptyString(pkg.registryName, `$.publicationManifest.packages[${index}].registryName`);
		const releaseAsset = nonEmptyString(pkg.releaseAsset, `$.publicationManifest.packages[${index}].releaseAsset`);
		assert(releaseAsset === registryReleaseAssetNameForPackage(registryName, version), `$.publicationManifest.packages[${index}].releaseAsset`, 'candidate filename drift');
		const sha256 = nonEmptyString(pkg.sha256, `$.publicationManifest.packages[${index}].sha256`);
		assert(/^[0-9a-f]{64}$/u.test(sha256), `$.publicationManifest.packages[${index}].sha256`, 'expected lowercase SHA-256');
		assert(Number.isSafeInteger(pkg.bytes) && pkg.bytes > 0, `$.publicationManifest.packages[${index}].bytes`, 'expected positive safe integer byte size');
		return { registryName, releaseAsset, sha256, bytes: pkg.bytes };
	});
	assertUnique(packages.map(item => item.registryName), '$.publicationManifest.packages', 'registryName');
	assertUnique(packages.map(item => item.releaseAsset), '$.publicationManifest.packages', 'releaseAsset');
	const actualNames = packages.map(item => item.registryName).sort(compareText);
	assert(JSON.stringify(actualNames) === JSON.stringify(expectedNames), '$.publicationManifest.packages', `expected exact Registry package set ${expectedNames.join(', ')}`);
	packages.sort((left, right) => compareText(left.registryName, right.registryName));
	return {
		version,
		githubReleaseTag: document.githubReleaseTag,
		distTag: document.distTag,
		packages,
	};
}

export async function verifyRegistryPackage(reviewed, version, distTag, { fetchImpl = fetch } = {}) {
	const packageUrl = registryPackageUrl(reviewed.registryName);
	const versionUrl = `${packageUrl}/${encodeURIComponent(version)}`;
	const [metadata, packument] = await Promise.all([
		fetchJson(versionUrl, fetchImpl, `package metadata for ${reviewed.registryName}@${version}`),
		fetchJson(packageUrl, fetchImpl, `package document for ${reviewed.registryName}`),
	]);
	assert(metadata?.name === reviewed.registryName, `$.registry.${reviewed.registryName}.name`, `expected ${reviewed.registryName}`);
	assert(metadata?.version === version, `$.registry.${reviewed.registryName}.version`, `expected ${version}`);
	assert(packument?.name === reviewed.registryName, `$.registry.${reviewed.registryName}.packument.name`, `expected ${reviewed.registryName}`);
	const tags = record(packument['dist-tags'], `$.registry.${reviewed.registryName}.dist-tags`);
	assert(tags[distTag] === version, `$.registry.${reviewed.registryName}.dist-tags.${distTag}`, `expected ${version}`);

	const dist = record(metadata.dist, `$.registry.${reviewed.registryName}.dist`);
	const tarballUrl = nonEmptyString(dist.tarball, `$.registry.${reviewed.registryName}.dist.tarball`);
	const tarball = new URL(tarballUrl);
	assert(tarball.protocol === 'https:' && tarball.origin === new URL(PUBLIC_REGISTRY).origin, `$.registry.${reviewed.registryName}.dist.tarball`, 'tarball must come from the public npm Registry origin');
	const integrity = nonEmptyString(dist.integrity, `$.registry.${reviewed.registryName}.dist.integrity`);
	const integrityMatch = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(integrity);
	assert(integrityMatch !== null, `$.registry.${reviewed.registryName}.dist.integrity`, 'expected one SHA-512 integrity digest');
	const shasum = nonEmptyString(dist.shasum, `$.registry.${reviewed.registryName}.dist.shasum`);
	assert(/^[0-9a-f]{40}$/u.test(shasum), `$.registry.${reviewed.registryName}.dist.shasum`, 'expected lowercase SHA-1');

	const response = await fetchImpl(tarballUrl, { cache: 'no-store' });
	if (!response?.ok) throw new Error(`Public npm Registry tarball request failed for ${reviewed.registryName}@${version}: HTTP ${response?.status ?? 'unknown'}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	const actualIntegrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
	const actualShasum = createHash('sha1').update(bytes).digest('hex');
	const actualSha256 = createHash('sha256').update(bytes).digest('hex');
	assert(actualIntegrity === integrity, `$.registry.${reviewed.registryName}.dist.integrity`, 'does not match downloaded Registry tarball bytes');
	assert(actualShasum === shasum, `$.registry.${reviewed.registryName}.dist.shasum`, 'does not match downloaded Registry tarball bytes');
	assert(actualSha256 === reviewed.sha256, `$.registry.${reviewed.registryName}.sha256`, 'does not match reviewed PUBLICATION-MANIFEST identity');
	assert(bytes.byteLength === reviewed.bytes, `$.registry.${reviewed.registryName}.bytes`, 'does not match reviewed PUBLICATION-MANIFEST byte size');
	return {
		registryName: reviewed.registryName,
		version,
		distTag,
		tarball: tarballUrl,
		integrity,
		shasum,
		sha256: actualSha256,
		bytes: bytes.byteLength,
	};
}

export async function verifyCleanGlobalCliInstall(version, {
	runCommand = execute,
	platform = process.platform,
	baseEnv = process.env,
} = {}) {
	const root = await mkdtemp(join(tmpdir(), 'virune-public-npm-'));
	try {
		const prefix = resolve(root, 'prefix');
		const npmrc = resolve(root, 'user.npmrc');
		const globalNpmrc = resolve(root, 'global.npmrc');
		const cache = resolve(root, 'npm-cache');
		const projectRoot = resolve(root, 'generated-project');
		await Promise.all([
			writeFile(npmrc, `registry=${PUBLIC_REGISTRY}\n@virune:registry=${PUBLIC_REGISTRY}\nreplace-registry-host=never\n`, 'utf8'),
			writeFile(globalNpmrc, '', 'utf8'),
			mkdir(cache, { recursive: true }),
		]);
		const env = cleanNpmEnvironment({ root, npmrc, globalNpmrc, cache, baseEnv });
		runCommand('npm', [
			'install', '--global', `virune@${version}`, `--prefix=${prefix}`,
			`--registry=${PUBLIC_REGISTRY}`, `--userconfig=${npmrc}`,
			'--replace-registry-host=never', '--no-audit', '--no-fund',
		], { cwd: root, env });
		const executable = platform === 'win32' ? resolve(prefix, 'virune.cmd') : resolve(prefix, 'bin/virune');
		const result = runCommand(executable, ['--version'], { cwd: root, env, capture: true });
		const versionOutput = result.stdout.trim();
		assert(versionOutput === `virune ${version}`, '$.installation.versionOutput', `expected virune ${version}, got ${versionOutput || '<empty>'}`);

		runCommand(executable, ['init', projectRoot], { cwd: root, env, capture: true });
		const packageJsonPath = resolve(projectRoot, 'package.json');
		const packageJsonBytes = await readFile(packageJsonPath);
		let generatedManifest;
		try {
			generatedManifest = JSON.parse(packageJsonBytes.toString('utf8'));
		} catch (error) {
			throw new Error(`Registry-installed CLI generated malformed package.json: ${error instanceof Error ? error.message : String(error)}`);
		}
		const generatedProject = validateGeneratedProjectManifest(generatedManifest, version);
		runCommand('npm', [
			'install', `--registry=${PUBLIC_REGISTRY}`, `--userconfig=${npmrc}`,
			'--replace-registry-host=never', '--no-audit', '--no-fund',
		], { cwd: projectRoot, env });
		for (const script of ['check', 'build']) {
			runCommand('npm', ['run', script], { cwd: projectRoot, env, capture: true });
		}
		const start = runCommand('npm', ['run', 'start'], { cwd: projectRoot, env, capture: true });
		assert(start.stdout.includes('Hello from Virune'), '$.installation.generatedProject.startOutput', 'generated project did not execute the default Virune program');
		const packageJsonAfter = await readFile(packageJsonPath);
		assert(packageJsonAfter.equals(packageJsonBytes), '$.installation.generatedProject.packageJson', 'generated package.json changed during consumer verification');

		return {
			package: `virune@${version}`,
			registry: PUBLIC_REGISTRY,
			versionOutput,
			generatedProject: {
				...generatedProject,
				commands: ['npm install', 'npm run check', 'npm run build', 'npm run start'],
			},
		};
	} finally {
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
	}
}

function validateGeneratedProjectManifest(manifest, version) {
	const document = record(manifest, '$.installation.generatedProject.packageJson');
	const dependencies = record(document.dependencies, '$.installation.generatedProject.packageJson.dependencies');
	const devDependencies = record(document.devDependencies, '$.installation.generatedProject.packageJson.devDependencies');
	assertExactKeys(dependencies, ['@virune/runtime', '@virune/stdlib'], '$.installation.generatedProject.packageJson.dependencies');
	assertExactKeys(devDependencies, ['virune'], '$.installation.generatedProject.packageJson.devDependencies');
	assert(dependencies['@virune/runtime'] === version, '$.installation.generatedProject.packageJson.dependencies.@virune/runtime', `expected ${version}`);
	assert(dependencies['@virune/stdlib'] === version, '$.installation.generatedProject.packageJson.dependencies.@virune/stdlib', `expected ${version}`);
	assert(devDependencies.virune === version, '$.installation.generatedProject.packageJson.devDependencies.virune', `expected ${version}`);
	return {
		dependencies: { '@virune/runtime': version, '@virune/stdlib': version },
		devDependencies: { virune: version },
	};
}

function readReviewedPublicationPlan(reviewedCommit, { sourceRoot }) {
	const result = spawnSync('git', ['show', `${reviewedCommit}:${PUBLICATION_PLAN_PATH}`], {
		cwd: sourceRoot,
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
	});
	if (result.error !== undefined) throw new Error(`Failed to read reviewed npm publication plan from ${reviewedCommit}: ${result.error.message}`);
	if ((result.status ?? 1) !== 0) throw new Error(`Failed to read reviewed npm publication plan from ${reviewedCommit}: ${result.stderr.trim()}`);
	try {
		return JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`Reviewed npm publication plan is malformed JSON at ${reviewedCommit}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function cleanNpmEnvironment({ root, npmrc, globalNpmrc, cache, baseEnv }) {
	const env = {};
	for (const [key, value] of Object.entries(baseEnv)) {
		if (!SAFE_PROCESS_ENV.has(key.toUpperCase())) continue;
		if (value !== undefined) env[key] = value;
	}
	env.HOME = root;
	env.USERPROFILE = root;
	env.XDG_CONFIG_HOME = resolve(root, 'xdg-config');
	env.NPM_CONFIG_USERCONFIG = npmrc;
	env.NPM_CONFIG_GLOBALCONFIG = globalNpmrc;
	env.NPM_CONFIG_CACHE = cache;
	env.NPM_CONFIG_REGISTRY = PUBLIC_REGISTRY;
	env.NPM_CONFIG_REPLACE_REGISTRY_HOST = 'never';
	return env;
}

function registryPackageUrl(registryName) {
	return `${PUBLIC_REGISTRY}${encodeURIComponent(registryName)}`;
}

async function fetchJson(url, fetchImpl, label) {
	const response = await fetchImpl(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
	if (!response?.ok) throw new Error(`Public npm Registry request failed for ${label}: HTTP ${response?.status ?? 'unknown'}`);
	try {
		return await response.json();
	} catch (error) {
		throw new Error(`Public npm Registry returned malformed JSON for ${label}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function fullCommitSha(value, path) {
	assert(typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value), path, 'expected a full lowercase commit SHA');
	return value;
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function array(value, path) {
	assert(Array.isArray(value), path, 'expected an array');
	return value;
}

function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.length > 0, path, 'expected a non-empty string');
	return value;
}

function assertExactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(wanted), path, `expected exact keys ${wanted.join(', ')}`);
}

function assertUnique(values, path, label) {
	assert(new Set(values).size === values.length, path, `duplicate ${label}`);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function execute(command, args, { cwd, env = process.env, capture = false } = {}) {
	const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
	const result = spawnSync(executable, args, {
		cwd,
		env,
		encoding: 'utf8',
		stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		timeout: 10 * 60 * 1000,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error !== undefined) throw result.error;
	if ((result.status ?? 1) !== 0) throw new Error(`${basename(command)} ${args.join(' ')} exited with ${result.status}${capture ? `\n${result.stdout}\n${result.stderr}` : ''}`);
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const reviewedCommit = process.argv.find(argument => argument.startsWith('--expected-commit='))?.slice('--expected-commit='.length);
	const publicationManifestPath = process.argv.find(argument => argument.startsWith('--publication-manifest='))?.slice('--publication-manifest='.length);
	const publicReleaseReportPath = process.argv.find(argument => argument.startsWith('--public-release-report='))?.slice('--public-release-report='.length);
	const outputPath = process.argv.find(argument => argument.startsWith('--output='))?.slice('--output='.length);
	const report = await verifyPublicNpmRegistry({
		reviewedCommit,
		...(publicationManifestPath === undefined ? {} : { publicationManifestPath: resolve(publicationManifestPath) }),
		...(publicReleaseReportPath === undefined ? {} : { publicReleaseReportPath: resolve(publicReleaseReportPath) }),
		...(outputPath === undefined ? {} : { outputPath: resolve(outputPath) }),
	});
	process.stdout.write(`Verified ${report.packages.length} public npm Registry packages for ${report.version}.\n`);
}
