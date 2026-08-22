import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { githubEvidenceSetIdentity } from './run-npm-publication-prewrite-gate.mjs';
import { parseReleaseVersion } from './npm-publication-version-policy.mjs';
import { validateDownloadedRelease } from './verify-public-release.mjs';
import {
	readRegularReleaseAsset,
	verifyNpmPublicationIdentity,
} from './verify-npm-publication-identity.mjs';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';
import { verifyNpmReleaseCandidateContents } from './verify-npm-release-candidate-contents.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLICATION_PLAN_PATH = '.github/release/npm-publication-v1.json';
const ROOT_MANIFEST_PATH = 'package.json';
const PUBLICATION_MANIFEST_FILE = 'PUBLICATION-MANIFEST.json';
const RELEASE_DIRECTORY = resolve(repositoryRoot, 'release');
const OUTPUT_PATH = resolve(repositoryRoot, '.cache/npm-release-identity/npm-release-identity-report.json');
const EVIDENCE_OUTPUT_PATH = resolve(repositoryRoot, '.cache/npm-release-identity/release-identity-integration-evidence.json');
const REPORT_KIND = 'npm-release-identity-integration-v1';
const CLI_OPTIONS = Object.freeze([
	['--expected-commit=', 'reviewedCommit'],
	['--version=', 'releaseVersion'],
]);

export async function runNpmReleaseIdentityEvidence({ reviewedCommit, releaseVersion } = {}) {
	await invalidateOutputs();
	const commit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const version = parseReleaseVersion(releaseVersion, '$.releaseVersion').text;
	const evidenceSetId = githubEvidenceSetIdentity(process.env);
	let snapshotDirectory;
	try {
		verifyExactCleanCheckout(commit);
		assert(process.env.GITHUB_SHA === commit, '$.environment.GITHUB_SHA', `expected exact reviewed commit ${commit}`);
		const reviewedPlan = readReviewedJson(commit, PUBLICATION_PLAN_PATH);
		const reviewedRootManifest = readReviewedJson(commit, ROOT_MANIFEST_PATH);
		const checkoutPlan = await readJson(resolve(repositoryRoot, PUBLICATION_PLAN_PATH), '$.checkoutPublicationPlan');
		const checkoutRootManifest = await readJson(resolve(repositoryRoot, ROOT_MANIFEST_PATH), '$.checkoutRootManifest');
		assert(isDeepStrictEqual(checkoutPlan, reviewedPlan), '$.checkoutPublicationPlan', 'checkout publication plan differs from the exact reviewed commit');
		assert(isDeepStrictEqual(checkoutRootManifest, reviewedRootManifest), '$.checkoutRootManifest', 'checkout root manifest differs from the exact reviewed commit');
		assert(reviewedRootManifest.version === version, '$.releaseVersion', `reviewed root version is ${String(reviewedRootManifest.version)}, expected ${version}`);

		const publicationPlan = verifyNpmPublicationPlan(repositoryRoot);
		assert(publicationPlan.stage === 'publication-candidate', '$.publicationPlan.stage', 'release-identity evidence requires publication-candidate stage');
		assert(publicationPlan.publicationReady === true, '$.publicationPlan.publicationReady', 'release-identity evidence requires publicationReady:true');
		assert(publicationPlan.currentVersion === version, '$.publicationPlan.currentVersion', `expected ${version}`);

		const snapshot = await snapshotReleaseDirectory(RELEASE_DIRECTORY);
		snapshotDirectory = await materializeReleaseSnapshot(snapshot);
		const integrity = await validateDownloadedRelease(snapshotDirectory, version, {
			sourceRoot: repositoryRoot,
			reviewedCommit: commit,
		});
		const publicationIdentity = verifyNpmPublicationIdentity({
			root: repositoryRoot,
			releaseDirectory: snapshotDirectory,
		});
		assert(publicationIdentity.version === version, '$.publicationIdentity.version', `expected ${version}`);
		assert(publicationIdentity.publicationReady === true, '$.publicationIdentity.publicationReady', 'reviewed publication identity must be ready');
		assert(publicationIdentity.registryVersionEligible === true, '$.publicationIdentity.registryVersionEligible', 'reviewed publication identity must be Registry-eligible');
		const candidateAudit = verifyNpmReleaseCandidateContents({
			root: repositoryRoot,
			releaseDirectory: snapshotDirectory,
			verifyIdentity: () => publicationIdentity,
		});
		assert(candidateAudit.version === version, '$.candidateAudit.version', `expected ${version}`);
		assert(candidateAudit.packageCount === publicationIdentity.packages.length, '$.candidateAudit.packageCount', 'candidate audit package count differs from publication identity');

		const publicationManifestEntry = snapshot.entries.find(item => item.file === PUBLICATION_MANIFEST_FILE);
		assert(publicationManifestEntry !== undefined, '$.releaseArtifacts', `${PUBLICATION_MANIFEST_FILE} is missing`);
		const publicationManifestBytes = publicationManifestEntry.content;
		const publicationManifest = {
			sha256: sha256(publicationManifestBytes),
			bytes: publicationManifestBytes.byteLength,
		};
		const report = buildReleaseIdentityReport({
			reviewedCommit: commit,
			evidenceSetId,
			version,
			publicationManifest,
			publicationIdentity,
			integrity,
			candidateAudit,
			releaseArtifactSet: snapshot.identity,
		});

		verifyExactCleanCheckout(commit);
		await assertReleaseSnapshotUnchanged(snapshot.identity);
		await persistJson(OUTPUT_PATH, report);
		const persistedReport = await readJson(OUTPUT_PATH, '$.releaseIdentityReport');
		assert(isDeepStrictEqual(persistedReport, report), '$.releaseIdentityReport', 'persisted release-identity report differs from the validated report');
		verifyExactCleanCheckout(commit);
		const evidence = buildCanonicalEvidence(report);
		await persistJson(EVIDENCE_OUTPUT_PATH, evidence);
		const persistedEvidence = await readJson(EVIDENCE_OUTPUT_PATH, '$.releaseIdentityEvidence');
		assert(isDeepStrictEqual(persistedEvidence, evidence), '$.releaseIdentityEvidence', 'persisted release-identity evidence differs from the canonical evidence');
		verifyExactCleanCheckout(commit);
		await assertReleaseSnapshotUnchanged(snapshot.identity);
		return { report, evidence };
	} catch (error) {
		await invalidateOutputs();
		throw error;
	} finally {
		if (snapshotDirectory !== undefined) await rm(snapshotDirectory, { recursive: true, force: true });
	}
}

export function buildReleaseIdentityReport({
	reviewedCommit,
	evidenceSetId,
	version,
	publicationManifest,
	publicationIdentity,
	integrity,
	candidateAudit,
	releaseArtifactSet,
}) {
	const commit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const execution = evidenceSetIdentity(evidenceSetId, '$.evidenceSetId');
	const releaseVersion = parseReleaseVersion(version, '$.version').text;
	const manifest = artifactIdentity(publicationManifest, '$.publicationManifest');
	const identity = record(publicationIdentity, '$.publicationIdentity');
	assert(identity.version === releaseVersion, '$.publicationIdentity.version', `expected ${releaseVersion}`);
	assert(identity.publicationReady === true, '$.publicationIdentity.publicationReady', 'expected true');
	assert(identity.registryVersionEligible === true, '$.publicationIdentity.registryVersionEligible', 'expected true');
	assert(identity.publishSource === 'reviewed-release-registry-candidate-tarball', '$.publicationIdentity.publishSource', 'unexpected publication source');
	const packages = array(identity.packages, '$.publicationIdentity.packages').map((item, index) => {
		const pkg = record(item, `$.publicationIdentity.packages[${index}]`);
		return {
			registryName: nonEmptyString(pkg.registryName, `$.publicationIdentity.packages[${index}].registryName`),
			releaseAsset: nonEmptyString(pkg.releaseAsset, `$.publicationIdentity.packages[${index}].releaseAsset`),
			sha256: sha256Digest(pkg.sha256, `$.publicationIdentity.packages[${index}].sha256`),
			bytes: positiveSafeInteger(pkg.bytes, `$.publicationIdentity.packages[${index}].bytes`),
		};
	}).sort((left, right) => compareText(left.registryName, right.registryName));
	assertUnique(packages.map(item => item.registryName), '$.publicationIdentity.packages', 'registryName');
	assertUnique(packages.map(item => item.releaseAsset), '$.publicationIdentity.packages', 'releaseAsset');

	const releaseSet = artifactSetIdentity(releaseArtifactSet, '$.releaseArtifactSet');
	const manifestFile = releaseSet.files.find(item => item.file === PUBLICATION_MANIFEST_FILE);
	assert(manifestFile !== undefined, '$.releaseArtifactSet.files', `${PUBLICATION_MANIFEST_FILE} is missing`);
	assert(manifestFile.sha256 === manifest.sha256, '$.publicationManifest.sha256', 'does not match release artifact set');
	assert(manifestFile.bytes === manifest.bytes, '$.publicationManifest.bytes', 'does not match release artifact set');
	for (const pkg of packages) {
		const releaseFile = releaseSet.files.find(item => item.file === pkg.releaseAsset);
		assert(releaseFile !== undefined, '$.releaseArtifactSet.files', `missing reviewed candidate ${pkg.releaseAsset}`);
		assert(releaseFile.sha256 === pkg.sha256, `$.publicationIdentity.packages.${pkg.registryName}.sha256`, 'does not match release artifact set');
		assert(releaseFile.bytes === pkg.bytes, `$.publicationIdentity.packages.${pkg.registryName}.bytes`, 'does not match release artifact set');
	}

	const downloaded = record(integrity, '$.releaseIntegrity');
	assert(downloaded.manifest?.version === releaseVersion, '$.releaseIntegrity.manifest.version', `expected ${releaseVersion}`);
	const integrityAssets = array(downloaded.assets, '$.releaseIntegrity.assets').map((item, index) => {
		const asset = record(item, `$.releaseIntegrity.assets[${index}]`);
		assertExactKeys(asset, ['file', 'sha256', 'bytes'], `$.releaseIntegrity.assets[${index}]`);
		return {
			file: nonEmptyString(asset.file, `$.releaseIntegrity.assets[${index}].file`),
			sha256: sha256Digest(asset.sha256, `$.releaseIntegrity.assets[${index}].sha256`),
			bytes: positiveSafeInteger(asset.bytes, `$.releaseIntegrity.assets[${index}].bytes`),
		};
	}).sort((left, right) => compareText(left.file, right.file));
	const expectedIntegrityAssets = releaseSet.files
		.filter(item => item.file !== 'SHA256SUMS')
		.sort((left, right) => compareText(left.file, right.file));
	assert(isDeepStrictEqual(integrityAssets, expectedIntegrityAssets), '$.releaseIntegrity.assets', 'release-integrity evidence does not match the exact release artifact set');

	const audit = record(candidateAudit, '$.candidateAudit');
	assert(audit.version === releaseVersion, '$.candidateAudit.version', `expected ${releaseVersion}`);
	assert(audit.packageCount === packages.length, '$.candidateAudit.packageCount', `expected ${packages.length}`);
	const auditedPackages = array(audit.packages, '$.candidateAudit.packages').map((item, index) => {
		const pkg = record(item, `$.candidateAudit.packages[${index}]`);
		return {
			registryName: nonEmptyString(pkg.registryName, `$.candidateAudit.packages[${index}].registryName`),
			releaseAsset: nonEmptyString(pkg.releaseAsset, `$.candidateAudit.packages[${index}].releaseAsset`),
			sha256: sha256Digest(pkg.sha256, `$.candidateAudit.packages[${index}].sha256`),
			bytes: positiveSafeInteger(pkg.bytes, `$.candidateAudit.packages[${index}].bytes`),
		};
	}).sort((left, right) => compareText(left.registryName, right.registryName));
	assert(isDeepStrictEqual(auditedPackages, packages), '$.candidateAudit.packages', 'exact candidate audit does not match publication identity');

	return {
		schemaVersion: 1,
		kind: REPORT_KIND,
		state: 'verified',
		reviewedCommit: commit,
		evidenceSetId: execution,
		version: releaseVersion,
		publicationManifest: manifest,
		releaseArtifactSet: releaseSet,
		packages,
		checks: {
			releaseIntegrity: 'passed',
			publicationIdentity: 'passed',
			exactCandidateContents: 'passed',
		},
	};
}

export async function snapshotReleaseDirectory(releaseDirectory) {
	const directory = resolve(releaseDirectory);
	const directoryEntries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => compareText(left.name, right.name));
	assert(directoryEntries.length > 0, '$.releaseArtifacts', 'release directory is empty');
	const entries = [];
	for (const entry of directoryEntries) {
		assert(entry.isFile() && !entry.isSymbolicLink(), `$.releaseArtifacts.${entry.name}`, 'release artifact must be a regular file');
		const content = readRegularReleaseAsset(resolve(directory, entry.name), `$.releaseArtifacts.${entry.name}`);
		entries.push({
			file: entry.name,
			sha256: sha256(content),
			bytes: content.byteLength,
			content,
		});
	}
	const identityEntries = entries.map(({ content: _content, ...item }) => item);
	return {
		entries,
		identity: {
			fileCount: identityEntries.length,
			sha256: createHash('sha256')
				.update(identityEntries.map(item => `${item.file}\0${item.sha256}\0${item.bytes}\n`).join(''))
				.digest('hex'),
			files: identityEntries,
		},
	};
}

export function parseNpmReleaseIdentityArguments(argumentsList) {
	const args = array(argumentsList, '$.arguments');
	const parsed = {};
	for (const argument of args) {
		assert(typeof argument === 'string', '$.arguments', 'expected string arguments');
		const matches = CLI_OPTIONS.filter(([prefix]) => argument.startsWith(prefix));
		assert(matches.length === 1, '$.arguments', `unknown release-identity argument ${argument}`);
		const [prefix, property] = matches[0];
		assert(parsed[property] === undefined, '$.arguments', `duplicate ${prefix.slice(0, -1)} argument`);
		const value = argument.slice(prefix.length);
		assert(value.length > 0, '$.arguments', `empty ${prefix.slice(0, -1)} argument`);
		parsed[property] = value;
	}
	assert(parsed.reviewedCommit !== undefined, '$.arguments', 'missing --expected-commit argument');
	assert(parsed.releaseVersion !== undefined, '$.arguments', 'missing --version argument');
	return parsed;
}

async function assertReleaseSnapshotUnchanged(expectedIdentity) {
	const actual = await snapshotReleaseDirectory(RELEASE_DIRECTORY);
	assert(
		isDeepStrictEqual(actual.identity, expectedIdentity),
		'$.releaseArtifacts',
		'release artifact set changed while release-identity evidence was being generated',
	);
}

async function materializeReleaseSnapshot(snapshot) {
	const directory = await mkdtemp(resolve(tmpdir(), 'virune-release-identity-'));
	for (const entry of snapshot.entries) await writeFile(resolve(directory, entry.file), entry.content);
	return directory;
}

function buildCanonicalEvidence(report) {
	const value = record(report, '$.releaseIdentityReport');
	assertExactKeys(value, [
		'schemaVersion',
		'kind',
		'state',
		'reviewedCommit',
		'evidenceSetId',
		'version',
		'publicationManifest',
		'releaseArtifactSet',
		'packages',
		'checks',
	], '$.releaseIdentityReport');
	assert(value.schemaVersion === 1, '$.releaseIdentityReport.schemaVersion', 'expected 1');
	assert(value.kind === REPORT_KIND, '$.releaseIdentityReport.kind', `expected ${REPORT_KIND}`);
	assert(value.state === 'verified', '$.releaseIdentityReport.state', 'only verified release identity may emit evidence');
	const checks = record(value.checks, '$.releaseIdentityReport.checks');
	assertExactKeys(checks, ['releaseIntegrity', 'publicationIdentity', 'exactCandidateContents'], '$.releaseIdentityReport.checks');
	assert(checks.releaseIntegrity === 'passed', '$.releaseIdentityReport.checks.releaseIntegrity', 'release integrity must pass');
	assert(checks.publicationIdentity === 'passed', '$.releaseIdentityReport.checks.publicationIdentity', 'publication identity must pass');
	assert(checks.exactCandidateContents === 'passed', '$.releaseIdentityReport.checks.exactCandidateContents', 'exact candidate contents must pass');
	return {
		schemaVersion: 1,
		requirement: 'release-identity-integration',
		result: 'passed',
		reviewedCommit: fullCommitSha(value.reviewedCommit, '$.releaseIdentityReport.reviewedCommit'),
		evidenceSetId: evidenceSetIdentity(value.evidenceSetId, '$.releaseIdentityReport.evidenceSetId'),
		version: parseReleaseVersion(value.version, '$.releaseIdentityReport.version').text,
		publicationManifestSha256: artifactIdentity(value.publicationManifest, '$.releaseIdentityReport.publicationManifest').sha256,
		publicationManifestBytes: artifactIdentity(value.publicationManifest, '$.releaseIdentityReport.publicationManifest').bytes,
	};
}

function readReviewedJson(reviewedCommit, path) {
	const result = spawnSync('git', ['show', `${reviewedCommit}:${path}`], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
	});
	if (result.error !== undefined) throw new Error(`Failed to read reviewed ${path} from ${reviewedCommit}: ${result.error.message}`);
	if ((result.status ?? 1) !== 0) throw new Error(`Failed to read reviewed ${path} from ${reviewedCommit}: ${result.stderr.trim()}`);
	try {
		return JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`Reviewed ${path} is malformed JSON at ${reviewedCommit}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function verifyExactCleanCheckout(reviewedCommit) {
	const head = git(['rev-parse', 'HEAD']);
	assert(head === reviewedCommit, '$.reviewedCommit', `checkout HEAD ${head} does not match reviewed commit ${reviewedCommit}`);
	const status = git(['status', '--porcelain=v1', '--untracked-files=normal']);
	assert(status.length === 0, '$.checkout', 'working tree must be clean during release-identity evidence generation');
}

function git(args) {
	const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
	if (result.error !== undefined) throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
	if ((result.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
	return result.stdout.trim();
}

async function persistJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, '\t')}\n`, 'utf8');
}

async function readJson(path, logicalPath) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`${logicalPath} is missing or malformed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function invalidateOutputs() {
	await rm(OUTPUT_PATH, { force: true });
	await rm(EVIDENCE_OUTPUT_PATH, { force: true });
}

function artifactIdentity(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['sha256', 'bytes'], path);
	return {
		sha256: sha256Digest(item.sha256, `${path}.sha256`),
		bytes: positiveSafeInteger(item.bytes, `${path}.bytes`),
	};
}

function artifactSetIdentity(value, path) {
	const item = record(value, path);
	assertExactKeys(item, ['fileCount', 'sha256', 'files'], path);
	const files = array(item.files, `${path}.files`).map((value, index) => {
		const file = record(value, `${path}.files[${index}]`);
		assertExactKeys(file, ['file', 'sha256', 'bytes'], `${path}.files[${index}]`);
		return {
			file: nonEmptyString(file.file, `${path}.files[${index}].file`),
			sha256: sha256Digest(file.sha256, `${path}.files[${index}].sha256`),
			bytes: positiveSafeInteger(file.bytes, `${path}.files[${index}].bytes`),
		};
	});
	assert(item.fileCount === files.length, `${path}.fileCount`, `expected ${files.length}`);
	assertUnique(files.map(file => file.file), `${path}.files`, 'file');
	const sorted = [...files].sort((left, right) => compareText(left.file, right.file));
	assert(isDeepStrictEqual(files, sorted), `${path}.files`, 'release artifact files must be canonically sorted');
	const expectedDigest = createHash('sha256')
		.update(files.map(file => `${file.file}\0${file.sha256}\0${file.bytes}\n`).join(''))
		.digest('hex');
	assert(item.sha256 === expectedDigest, `${path}.sha256`, 'release artifact set digest does not match its file identities');
	return { fileCount: files.length, sha256: expectedDigest, files };
}

function fullCommitSha(value, path) {
	assert(typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value), path, 'expected a full lowercase commit SHA');
	return value;
}

function evidenceSetIdentity(value, path) {
	const identity = nonEmptyString(value, path);
	assert(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(identity), path, 'invalid evidence set identity');
	return identity;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function sha256Digest(value, path) {
	assert(typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value), path, 'expected lowercase SHA-256');
	return value;
}

function positiveSafeInteger(value, path) {
	assert(Number.isSafeInteger(value) && value > 0, path, 'expected positive safe integer');
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
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
	return value;
}

function assertExactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(isDeepStrictEqual(actual, wanted), path, `expected exact keys ${wanted.join(', ')}`);
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

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const parsed = parseNpmReleaseIdentityArguments(process.argv.slice(2));
	const result = await runNpmReleaseIdentityEvidence(parsed);
	process.stdout.write(`Verified npm release identity integration for ${result.report.version} at ${result.report.reviewedCommit}.\n`);
}
