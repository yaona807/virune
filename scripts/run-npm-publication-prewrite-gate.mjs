import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
	NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
	NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
} from './npm-publication-authorization-contract.mjs';
import { parseReleaseVersion } from './npm-publication-version-policy.mjs';
import { runNpmPublicationAuthorization } from './run-npm-publication-authorization.mjs';
import { runStableReleaseGate } from './stable-release-gate.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const KIND = 'npm-publication-prewrite-gate-v1';
export const NPM_PUBLICATION_PREWRITE_OUTPUT = resolve(repositoryRoot, '.cache/npm-publication-prewrite/npm-publication-prewrite-gate.json');
const DEFAULT_STABLE_EVIDENCE = resolve(repositoryRoot, '.cache/npm-publication-prewrite/stable-release-evidence.json');
const DEFAULT_AUTHORIZATION_OUTPUT = resolve(repositoryRoot, '.cache/npm-publication-authorization/npm-publication-authorization-report.json');
const PUBLICATION_MANIFEST = resolve(repositoryRoot, 'release/PUBLICATION-MANIFEST.json');
const PRE_WRITE_EVIDENCE = resolve(repositoryRoot, '.cache/npm-publication-authorization/pre-write-evidence.json');
const CLI_OPTIONS = Object.freeze([
	['--expected-commit=', 'reviewedCommit'],
	['--version=', 'releaseVersion'],
]);

export async function runNpmPublicationPrewriteGate({ reviewedCommit, releaseVersion, mutation } = {}) {
	await invalidateExecutionEvidence();
	if (mutation !== undefined) assert(typeof mutation === 'function', '$.mutation', 'expected a function');
	const commit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const version = nonEmptyString(releaseVersion, '$.releaseVersion');
	const execution = githubEvidenceSetIdentity(process.env);
	verifyExactCleanCheckout(commit);
	assert(process.env.GITHUB_SHA === commit, '$.environment.GITHUB_SHA', `expected exact reviewed commit ${commit}`);

	const generatedStableReport = await runStableReleaseGate({ root: repositoryRoot, output: DEFAULT_STABLE_EVIDENCE });
	const stableEvidenceBytes = await readFile(DEFAULT_STABLE_EVIDENCE);
	const stableReleaseReport = parseJson(stableEvidenceBytes, '$.stableReleaseEvidence');
	validateGeneratedStableReleaseEvidence(stableReleaseReport, generatedStableReport, {
		reviewedCommit: commit,
		releaseVersion: version,
	});

	const generatedAuthorizationReport = await runNpmPublicationAuthorization({
		reviewedCommit: commit,
		releaseVersion: version,
		evidenceSetId: execution,
		publicationManifestPath: PUBLICATION_MANIFEST,
		evidencePath: PRE_WRITE_EVIDENCE,
		outputPath: DEFAULT_AUTHORIZATION_OUTPUT,
	});
	const authorizationEvidenceBytes = await readFile(DEFAULT_AUTHORIZATION_OUTPUT);
	const persistedAuthorizationReport = parseJson(authorizationEvidenceBytes, '$.authorizationEvidence');
	assert(
		isDeepStrictEqual(persistedAuthorizationReport, generatedAuthorizationReport),
		'$.authorizationEvidence',
		'persisted authorization evidence differs from the report generated in this execution',
	);
	const report = buildNpmPublicationPrewriteGateReport({
		stableReleaseEvidenceBytes: stableEvidenceBytes,
		authorizationEvidenceBytes,
		reviewedCommit: commit,
		releaseVersion: version,
		evidenceSetId: execution,
	});
	await mkdir(dirname(NPM_PUBLICATION_PREWRITE_OUTPUT), { recursive: true });
	await writeFile(NPM_PUBLICATION_PREWRITE_OUTPUT, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	const persistedReport = parseJson(await readFile(NPM_PUBLICATION_PREWRITE_OUTPUT), '$.prewriteGateOutput');
	assert(isDeepStrictEqual(persistedReport, report), '$.prewriteGateOutput', 'persisted pre-write gate evidence differs from the validated report');
	if (mutation !== undefined) {
		try {
			await mutation({
				prewriteGate: structuredClone(report),
				authorization: structuredClone(persistedAuthorizationReport),
			});
		} catch (error) {
			await rm(NPM_PUBLICATION_PREWRITE_OUTPUT, { force: true });
			throw error;
		}
	}
	return report;
}

export function buildNpmPublicationPrewriteGateReport({
	stableReleaseEvidenceBytes,
	authorizationEvidenceBytes,
	reviewedCommit,
	releaseVersion,
	evidenceSetId,
}) {
	const commit = fullCommitSha(reviewedCommit, '$.reviewedCommit');
	const version = nonEmptyString(releaseVersion, '$.releaseVersion');
	const execution = evidenceSetIdentity(evidenceSetId, '$.evidenceSetId');
	const stableBytes = Buffer.from(stableReleaseEvidenceBytes);
	const stableReleaseReport = parseJson(stableBytes, '$.stableReleaseEvidence');
	validateStableReleaseEvidence(stableReleaseReport, { reviewedCommit: commit, releaseVersion: version });
	const authorizationBytes = Buffer.from(authorizationEvidenceBytes);
	const authorization = validateAuthorizationReport(parseJson(authorizationBytes, '$.authorizationEvidence'), {
		reviewedCommit: commit,
		releaseVersion: version,
		evidenceSetId: execution,
	});
	return {
		schemaVersion: 1,
		kind: KIND,
		publicationReady: true,
		reviewedCommit: commit,
		evidenceSetId: execution,
		version,
		stableReleaseEvidence: {
			sha256: sha256(stableBytes),
			bytes: stableBytes.byteLength,
		},
		authorization: {
			sha256: sha256(authorizationBytes),
			bytes: authorizationBytes.byteLength,
			kind: authorization.kind,
			publicationManifest: { ...authorization.publicationManifest },
			satisfiedPreWriteRequirements: [...authorization.satisfiedPreWriteRequirements],
			remainingPostWriteCompletionRequirements: [...authorization.remainingPostWriteCompletionRequirements],
		},
	};
}

export function githubEvidenceSetIdentity(environment = process.env) {
	const runId = positiveDecimal(environment.GITHUB_RUN_ID, '$.environment.GITHUB_RUN_ID');
	const runAttempt = positiveDecimal(environment.GITHUB_RUN_ATTEMPT, '$.environment.GITHUB_RUN_ATTEMPT');
	return `github-actions:${runId}:${runAttempt}`;
}

export function validateGeneratedStableReleaseEvidence(persistedReport, generatedReport, expected) {
	assert(isDeepStrictEqual(persistedReport, generatedReport), '$.stableReleaseEvidence', 'persisted stable release evidence differs from the report generated in this execution');
	return validateStableReleaseEvidence(persistedReport, expected);
}

export function validateStableReleaseEvidence(value, { reviewedCommit, releaseVersion }) {
	const report = record(value, '$.stableReleaseEvidence');
	assertExactKeys(report, [
		'schemaVersion',
		'version',
		'commit',
		'expectedNightlySha',
		'ref',
		'generatedAt',
		'checks',
		'requirements',
		'passed',
	], '$.stableReleaseEvidence');
	assert(report.schemaVersion === 1, '$.stableReleaseEvidence.schemaVersion', 'expected schemaVersion 1');
	assert(report.version === releaseVersion, '$.stableReleaseEvidence.version', `expected release version ${releaseVersion}`);
	assert(report.commit === reviewedCommit, '$.stableReleaseEvidence.commit', `expected reviewed commit ${reviewedCommit}`);
	assert(report.expectedNightlySha === reviewedCommit, '$.stableReleaseEvidence.expectedNightlySha', `expected Nightly evidence for ${reviewedCommit}`);
	assert(report.passed === true, '$.stableReleaseEvidence.passed', 'stable release gate must have passed');
	validateReleaseRef(report.ref, releaseVersion);
	assert(typeof report.generatedAt === 'string' && Number.isFinite(Date.parse(report.generatedAt)), '$.stableReleaseEvidence.generatedAt', 'expected an ISO timestamp');
	const checks = array(report.checks, '$.stableReleaseEvidence.checks');
	const requirements = array(report.requirements, '$.stableReleaseEvidence.requirements');
	assert(checks.length > 0, '$.stableReleaseEvidence.checks', 'expected stable release checks');
	assert(requirements.length > 0, '$.stableReleaseEvidence.requirements', 'expected stable release requirements');
	assertUniquePassedRecords(checks, '$.stableReleaseEvidence.checks');
	assertUniquePassedRecords(requirements, '$.stableReleaseEvidence.requirements');
	return report;
}

export function validateAuthorizationReport(value, { reviewedCommit, releaseVersion, evidenceSetId }) {
	const report = record(value, '$.authorization');
	assertExactKeys(report, [
		'schemaVersion',
		'kind',
		'publicationReady',
		'reviewedCommit',
		'evidenceSetId',
		'version',
		'publicationManifest',
		'satisfiedPreWriteRequirements',
		'remainingPostWriteCompletionRequirements',
	], '$.authorization');
	assert(report.schemaVersion === 1, '$.authorization.schemaVersion', 'expected schemaVersion 1');
	assert(report.kind === NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND, '$.authorization.kind', `expected ${NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND}`);
	assert(report.publicationReady === true, '$.authorization.publicationReady', 'authorization must be ready');
	assert(report.reviewedCommit === reviewedCommit, '$.authorization.reviewedCommit', `expected reviewed commit ${reviewedCommit}`);
	assert(report.evidenceSetId === evidenceSetId, '$.authorization.evidenceSetId', `expected evidence set ${evidenceSetId}`);
	assert(report.version === releaseVersion, '$.authorization.version', `expected release version ${releaseVersion}`);
	const manifest = record(report.publicationManifest, '$.authorization.publicationManifest');
	assertExactKeys(manifest, ['sha256', 'bytes'], '$.authorization.publicationManifest');
	assert(typeof manifest.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(manifest.sha256), '$.authorization.publicationManifest.sha256', 'expected lowercase SHA-256');
	assert(Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0, '$.authorization.publicationManifest.bytes', 'expected positive byte count');
	assertExactList(report.satisfiedPreWriteRequirements, NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS, '$.authorization.satisfiedPreWriteRequirements');
	assertExactList(report.remainingPostWriteCompletionRequirements, NPM_PUBLICATION_POST_WRITE_REQUIREMENTS, '$.authorization.remainingPostWriteCompletionRequirements');
	return report;
}

export function parseNpmPublicationPrewriteArguments(argumentsList) {
	const args = array(argumentsList, '$.arguments');
	const parsed = {};
	for (const argument of args) {
		assert(typeof argument === 'string', '$.arguments', 'expected string arguments');
		const matches = CLI_OPTIONS.filter(([prefix]) => argument.startsWith(prefix));
		assert(matches.length === 1, '$.arguments', `unknown pre-write gate argument ${argument}`);
		const [prefix, property] = matches[0];
		assert(parsed[property] === undefined, '$.arguments', `duplicate ${prefix.slice(0, -1)} argument`);
		const value = argument.slice(prefix.length);
		assert(value.length > 0, '$.arguments', `empty ${prefix.slice(0, -1)} argument`);
		parsed[property] = value;
	}
	return parsed;
}

export async function runNpmPublicationPrewriteGateCli(argumentsList) {
	await invalidateExecutionEvidence();
	const parsed = parseNpmPublicationPrewriteArguments(argumentsList);
	return runNpmPublicationPrewriteGate({
		reviewedCommit: parsed.reviewedCommit,
		releaseVersion: parsed.releaseVersion,
	});
}

function validateReleaseRef(value, releaseVersion) {
	const ref = nonEmptyString(value, '$.stableReleaseEvidence.ref');
	const expectedTag = `refs/tags/v${releaseVersion}`;
	const expectedCandidate = `refs/heads/release-candidate/v${releaseVersion}`;
	if (ref === expectedTag) return;
	assert(ref === expectedCandidate, '$.stableReleaseEvidence.ref', `expected ${expectedTag} or ${expectedCandidate}`);
	const parsed = parseReleaseVersion(releaseVersion, '$.stableReleaseEvidence.version');
	assert(parsed.channel === 'prerelease', '$.stableReleaseEvidence.ref', 'release-candidate branch may authorize prerelease versions only');
}

async function invalidateExecutionEvidence() {
	await rm(NPM_PUBLICATION_PREWRITE_OUTPUT, { force: true });
	await rm(DEFAULT_STABLE_EVIDENCE, { force: true });
	await rm(DEFAULT_AUTHORIZATION_OUTPUT, { force: true });
}

function verifyExactCleanCheckout(reviewedCommit) {
	const head = git(['rev-parse', 'HEAD']);
	assert(head === reviewedCommit, '$.reviewedCommit', `checkout HEAD ${head} does not match reviewed commit ${reviewedCommit}`);
	const status = git(['status', '--porcelain=v1', '--untracked-files=normal']);
	assert(status.length === 0, '$.checkout', 'working tree must be clean before npm publication authorization');
}

function git(args) {
	const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
	if (result.error !== undefined) throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
	if ((result.status ?? 1) !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
	return result.stdout.trim();
}

function assertUniquePassedRecords(values, path) {
	const ids = [];
	for (let index = 0; index < values.length; index += 1) {
		const value = record(values[index], `${path}[${index}]`);
		const id = nonEmptyString(value.id, `${path}[${index}].id`);
		assert(value.passed === true, `${path}[${index}].passed`, `${id} must have passed`);
		ids.push(id);
	}
	assert(new Set(ids).size === ids.length, path, 'duplicate evidence id');
}

function assertExactList(value, expected, path) {
	const actual = array(value, path).map((item, index) => nonEmptyString(item, `${path}[${index}]`));
	assert(JSON.stringify(actual) === JSON.stringify(expected), path, `expected ${expected.join(', ')}`);
}

function parseJson(bytes, path) {
	try {
		return JSON.parse(Buffer.from(bytes).toString('utf8'));
	} catch (error) {
		throw new Error(`${path}: malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
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

function positiveDecimal(value, path) {
	assert(typeof value === 'string' && /^[1-9]\d*$/u.test(value), path, 'expected a positive decimal integer string');
	return value;
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
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
	const report = await runNpmPublicationPrewriteGateCli(process.argv.slice(2));
	process.stdout.write(`npm pre-write publication gate passed for ${report.version} at ${report.reviewedCommit}.\n`);
}
