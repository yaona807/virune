import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateNpmPublicationAuthorization } from './verify-npm-publication-authorization.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLICATION_PLAN_PATH = '.github/release/npm-publication-v1.json';
const ROOT_MANIFEST_PATH = 'package.json';
const DEFAULT_PUBLICATION_MANIFEST = resolve(repositoryRoot, '.cache/public-release/PUBLICATION-MANIFEST.json');
const DEFAULT_EVIDENCE = resolve(repositoryRoot, '.cache/npm-publication-authorization/pre-write-evidence.json');
const DEFAULT_OUTPUT = resolve(repositoryRoot, '.cache/npm-publication-authorization/npm-publication-authorization-report.json');

export async function runNpmPublicationAuthorization({
	reviewedCommit,
	releaseVersion,
	evidenceSetId,
	publicationManifestBytes,
	publicationManifestPath = DEFAULT_PUBLICATION_MANIFEST,
	evidenceDocument,
	evidencePath = DEFAULT_EVIDENCE,
	sourceRoot = repositoryRoot,
	outputPath = DEFAULT_OUTPUT,
} = {}) {
	const commit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const version = nonEmptyString(releaseVersion, '$.releaseVersion');
	const execution = evidenceSetIdentity(evidenceSetId, '$.evidenceSetId');
	if (outputPath !== null) await rm(outputPath, { force: true });

	const plan = readReviewedJson(commit, PUBLICATION_PLAN_PATH, { sourceRoot });
	const rootManifest = readReviewedJson(commit, ROOT_MANIFEST_PATH, { sourceRoot });
	assert(rootManifest.version === version, '$.releaseVersion', `reviewed ${ROOT_MANIFEST_PATH} version is ${String(rootManifest.version)}, expected ${version}`);

	const manifestBytes = publicationManifestBytes === undefined
		? await readFile(publicationManifestPath)
		: Buffer.from(publicationManifestBytes);
	const evidenceInput = evidenceDocument ?? await readJsonFile(evidencePath, '$.evidenceDocument');
	const records = validateEvidenceDocument(evidenceInput, execution);
	const report = evaluateNpmPublicationAuthorization({
		publicationPlan: plan,
		releaseVersion: version,
		reviewedCommit: commit,
		evidenceSetId: execution,
		publicationManifestBytes: manifestBytes,
		evidence: records,
	});
	if (outputPath !== null) {
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	}
	return report;
}

export function validateEvidenceDocument(value, expectedEvidenceSetId) {
	const document = record(value, '$.evidenceDocument');
	assertExactKeys(document, ['schemaVersion', 'evidenceSetId', 'records'], '$.evidenceDocument');
	assert(document.schemaVersion === 1, '$.evidenceDocument.schemaVersion', 'expected schemaVersion 1');
	const evidenceSetId = evidenceSetIdentity(document.evidenceSetId, '$.evidenceDocument.evidenceSetId');
	assert(evidenceSetId === expectedEvidenceSetId, '$.evidenceDocument.evidenceSetId', `expected current evidence set ${expectedEvidenceSetId}`);
	return array(document.records, '$.evidenceDocument.records');
}

function readReviewedJson(reviewedCommit, path, { sourceRoot }) {
	const result = spawnSync('git', ['show', `${reviewedCommit}:${path}`], {
		cwd: sourceRoot,
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

async function readJsonFile(path, logicalPath) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`${logicalPath} is missing or malformed: ${error instanceof Error ? error.message : String(error)}`);
	}
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
	assert(JSON.stringify(actual) === JSON.stringify(wanted), path, `expected exact keys ${wanted.join(', ')}`);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const reviewedCommit = argumentValue('--expected-commit=');
	const releaseVersion = argumentValue('--version=');
	const evidenceSetId = argumentValue('--evidence-set-id=');
	const publicationManifestPath = argumentValue('--publication-manifest=');
	const evidencePath = argumentValue('--evidence=');
	const outputPath = argumentValue('--output=');
	const report = await runNpmPublicationAuthorization({
		reviewedCommit,
		releaseVersion,
		evidenceSetId,
		...(publicationManifestPath === undefined ? {} : { publicationManifestPath: resolve(publicationManifestPath) }),
		...(evidencePath === undefined ? {} : { evidencePath: resolve(evidencePath) }),
		...(outputPath === undefined ? {} : { outputPath: resolve(outputPath) }),
	});
	process.stdout.write(`Authorized npm publication for ${report.version} at ${report.reviewedCommit}.\n`);
}

function argumentValue(prefix) {
	const matches = process.argv.filter(argument => argument.startsWith(prefix));
	assert(matches.length <= 1, '$.arguments', `duplicate ${prefix.slice(0, -1)} argument`);
	return matches[0]?.slice(prefix.length);
}
