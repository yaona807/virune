import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
	NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
	NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
} from './npm-publication-authorization-contract.mjs';
import {
	NPM_PUBLICATION_PREWRITE_OUTPUT,
	buildNpmPublicationPrewriteGateReport,
	githubEvidenceSetIdentity,
	parseNpmPublicationPrewriteArguments,
	runNpmPublicationPrewriteGate,
	runNpmPublicationPrewriteGateCli,
	validateAuthorizationReport,
	validateGeneratedStableReleaseEvidence,
	validateStableReleaseEvidence,
} from './run-npm-publication-prewrite-gate.mjs';

const reviewedCommit = 'a'.repeat(40);
const releaseVersion = '1.1.0-rc.1';
const evidenceSetId = 'github-actions:32560000000:1';

function stableReleaseReport() {
	return {
		schemaVersion: 1,
		version: releaseVersion,
		commit: reviewedCommit,
		expectedNightlySha: reviewedCommit,
		ref: `refs/heads/release-candidate/v${releaseVersion}`,
		generatedAt: '2026-08-22T04:30:00.000Z',
		checks: [
			{ id: 'quality', command: ['npm', 'run', 'verify'], passed: true, status: 0, durationMs: 100 },
			{ id: 'nightly', passed: true, headSha: reviewedCommit },
		],
		requirements: [
			{ id: 'formatter', evidence: ['quality'], passed: true },
			{ id: 'nightly-evidence', evidence: ['nightly'], passed: true },
		],
		passed: true,
	};
}

function authorizationReport() {
	return {
		schemaVersion: 1,
		kind: NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
		publicationReady: true,
		reviewedCommit,
		evidenceSetId,
		version: releaseVersion,
		publicationManifest: { sha256: '1'.repeat(64), bytes: 1024 },
		satisfiedPreWriteRequirements: [...NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS],
		remainingPostWriteCompletionRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
	};
}

function stableBytes(report = stableReleaseReport()) {
	return Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function authorizationBytes(report = authorizationReport()) {
	return Buffer.from(`${JSON.stringify(report, null, '\t')}\n`, 'utf8');
}

function build(overrides = {}) {
	return buildNpmPublicationPrewriteGateReport({
		stableReleaseEvidenceBytes: stableBytes(),
		authorizationEvidenceBytes: authorizationBytes(),
		reviewedCommit,
		releaseVersion,
		evidenceSetId,
		...overrides,
	});
}

function seedCanonicalStaleOutput() {
	mkdirSync(dirname(NPM_PUBLICATION_PREWRITE_OUTPUT), { recursive: true });
	writeFileSync(NPM_PUBLICATION_PREWRITE_OUTPUT, '{"publicationReady":true}\n');
}

function clearCanonicalOutput() {
	rmSync(NPM_PUBLICATION_PREWRITE_OUTPUT, { force: true });
}

test('existing GitHub stable release gate does not acquire an unconditional npm pre-write dependency', () => {
	const policy = JSON.parse(readFileSync(resolve('.github/stable-release-gate.json'), 'utf8'));
	assert.equal(policy.checks.some(check => check.id.includes('prewrite') || check.id.includes('pre-write')), false);
	assert.equal(policy.requirements.some(requirement => requirement.id.includes('prewrite') || requirement.id.includes('pre-write')), false);
});

test('valid finalized release and canonical authorization build exact pre-write evidence', () => {
	const report = build();
	assert.equal(report.publicationReady, true);
	assert.equal(report.reviewedCommit, reviewedCommit);
	assert.equal(report.evidenceSetId, evidenceSetId);
	assert.equal(report.version, releaseVersion);
	assert.equal(report.authorization.kind, NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND);
	assert.deepEqual(report.stableReleaseEvidence, {
		sha256: createHash('sha256').update(stableBytes()).digest('hex'),
		bytes: stableBytes().byteLength,
	});
	assert.equal(report.authorization.sha256, createHash('sha256').update(authorizationBytes()).digest('hex'));
	assert.equal(report.authorization.bytes, authorizationBytes().byteLength);
});

test('pure report builder cannot invoke a caller-supplied mutation capability', () => {
	let calls = 0;
	const report = build({ mutation: () => { calls += 1; } });
	assert.equal(report.publicationReady, true);
	assert.equal(calls, 0);
});

test('GitHub execution identity is derived from run id and rerun attempt', () => {
	assert.equal(githubEvidenceSetIdentity({
		GITHUB_RUN_ID: '32560000000',
		GITHUB_RUN_ATTEMPT: '1',
	}), 'github-actions:32560000000:1');
	assert.equal(githubEvidenceSetIdentity({
		GITHUB_RUN_ID: '32560000000',
		GITHUB_RUN_ATTEMPT: '2',
	}), 'github-actions:32560000000:2');
});

test('GitHub execution identity fails closed on missing or malformed run identity', () => {
	for (const environment of [
		{},
		{ GITHUB_RUN_ID: '32560000000' },
		{ GITHUB_RUN_ATTEMPT: '1' },
		{ GITHUB_RUN_ID: '0', GITHUB_RUN_ATTEMPT: '1' },
		{ GITHUB_RUN_ID: '-1', GITHUB_RUN_ATTEMPT: '1' },
		{ GITHUB_RUN_ID: '032560000000', GITHUB_RUN_ATTEMPT: '1' },
		{ GITHUB_RUN_ID: '32560000000', GITHUB_RUN_ATTEMPT: '0' },
		{ GITHUB_RUN_ID: '32560000000', GITHUB_RUN_ATTEMPT: '01' },
		{ GITHUB_RUN_ID: 'run', GITHUB_RUN_ATTEMPT: '1' },
	]) {
		assert.throws(() => githubEvidenceSetIdentity(environment), /positive decimal integer string/u);
	}
});

test('stable release evidence identity and pass state fail closed', () => {
	const mutations = [
		report => { report.schemaVersion = 2; },
		report => { report.version = '1.1.0-rc.2'; },
		report => { report.commit = 'b'.repeat(40); },
		report => { report.expectedNightlySha = 'b'.repeat(40); },
		report => { report.ref = ''; },
		report => { report.ref = 'refs/heads/main'; },
		report => { report.generatedAt = 'not-a-time'; },
		report => { report.passed = false; },
		report => { report.checks[0].passed = false; },
		report => { report.requirements[0].passed = false; },
		report => { report.checks.push({ ...report.checks[0] }); },
		report => { report.requirements.push({ ...report.requirements[0] }); },
		report => { report.unexpected = true; },
		report => { delete report.requirements; },
	];
	for (const mutate of mutations) {
		const stable = stableReleaseReport();
		mutate(stable);
		assert.throws(() => build({ stableReleaseEvidenceBytes: stableBytes(stable) }));
	}
});

test('release ref binding accepts exact tags and restricts release-candidate branches to prereleases', () => {
	const stable = stableReleaseReport();
	stable.version = '1.1.0';
	stable.ref = 'refs/tags/v1.1.0';
	assert.doesNotThrow(() => validateStableReleaseEvidence(stable, { reviewedCommit, releaseVersion: '1.1.0' }));
	stable.ref = 'refs/heads/release-candidate/v1.1.0';
	assert.throws(() => validateStableReleaseEvidence(stable, { reviewedCommit, releaseVersion: '1.1.0' }), /prerelease versions only/u);
});

test('malformed Virune release versions fail closed even when tag and evidence agree', () => {
	for (const malformed of ['1.1', '01.1.0', '1.1.0-rc', '1.1.0-dev.1', ' 1.1.0']) {
		const stable = stableReleaseReport();
		stable.version = malformed;
		stable.ref = `refs/tags/v${malformed}`;
		const authorization = authorizationReport();
		authorization.version = malformed;
		assert.throws(() => build({
			releaseVersion: malformed,
			stableReleaseEvidenceBytes: stableBytes(stable),
			authorizationEvidenceBytes: authorizationBytes(authorization),
		}), /expected stable, alpha, beta, rc, or nightly Virune semantic version/u);
		assert.throws(() => validateStableReleaseEvidence(stable, { reviewedCommit, releaseVersion: malformed }), /expected stable, alpha, beta, rc, or nightly Virune semantic version/u);
		assert.throws(() => validateAuthorizationReport(authorization, { reviewedCommit, releaseVersion: malformed, evidenceSetId }), /expected stable, alpha, beta, rc, or nightly Virune semantic version/u);
	}
});

test('fresh stable gate bytes must match the exact report generated in the same execution', () => {
	const generated = stableReleaseReport();
	const persisted = structuredClone(generated);
	persisted.checks.pop();
	assert.throws(() => validateGeneratedStableReleaseEvidence(persisted, generated, { reviewedCommit, releaseVersion }), /differs from the report generated/u);
	assert.doesNotThrow(() => validateGeneratedStableReleaseEvidence(structuredClone(generated), generated, { reviewedCommit, releaseVersion }));
});

test('authorization report bytes are the validated and hashed source of truth', () => {
	const changed = authorizationReport();
	changed.publicationManifest.bytes += 1;
	const first = build();
	const second = build({ authorizationEvidenceBytes: authorizationBytes(changed) });
	assert.notEqual(second.authorization.sha256, first.authorization.sha256);
	assert.equal(second.authorization.publicationManifest.bytes, changed.publicationManifest.bytes);
});

test('authorization report drift fails closed', () => {
	const mutations = [
		report => { report.schemaVersion = 2; },
		report => { report.kind = 'other'; },
		report => { report.publicationReady = false; },
		report => { report.reviewedCommit = 'b'.repeat(40); },
		report => { report.evidenceSetId = 'github-actions:old:1'; },
		report => { report.version = '1.1.0-rc.2'; },
		report => { report.publicationManifest.sha256 = 'A'.repeat(64); },
		report => { report.publicationManifest.bytes = 0; },
		report => { report.satisfiedPreWriteRequirements.pop(); },
		report => { report.remainingPostWriteCompletionRequirements.reverse(); },
		report => { report.unexpected = true; },
		report => { delete report.publicationManifest; },
	];
	for (const mutate of mutations) {
		const authorization = authorizationReport();
		mutate(authorization);
		assert.throws(() => build({ authorizationEvidenceBytes: authorizationBytes(authorization) }));
	}
	assert.throws(() => build({ authorizationEvidenceBytes: Buffer.from('{') }), /malformed JSON/u);
});

test('stable and authorization validators reject malformed outer schemas independently', () => {
	assert.throws(() => validateStableReleaseEvidence(null, { reviewedCommit, releaseVersion }));
	assert.throws(() => validateAuthorizationReport([], { reviewedCommit, releaseVersion, evidenceSetId }));
});

test('pre-write CLI parser rejects unknown, positional, duplicate and empty options', () => {
	assert.deepEqual(parseNpmPublicationPrewriteArguments([
		`--expected-commit=${reviewedCommit}`,
		`--version=${releaseVersion}`,
	]), { reviewedCommit, releaseVersion });
	for (const args of [
		['--unknown=value'],
		['positional'],
		['--versoin=1.1.0-rc.1'],
		['--version=1.1.0', '--version=1.1.0-rc.1'],
		['--version='],
		[`--evidence-set-id=${evidenceSetId}`],
		['--output=/tmp/prewrite.json'],
	]) {
		assert.throws(() => parseNpmPublicationPrewriteArguments(args));
	}
});

test('CLI parse failure invalidates stale canonical passing output before validation', async () => {
	seedCanonicalStaleOutput();
	try {
		await assert.rejects(() => runNpmPublicationPrewriteGateCli(['--unknown=value']));
		assert.equal(existsSync(NPM_PUBLICATION_PREWRITE_OUTPUT), false);
	} finally {
		clearCanonicalOutput();
	}
});

test('malformed direct-run identity invalidates stale canonical output without touching caller paths', async () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-prewrite-arbitrary-'));
	const arbitrary = join(root, 'do-not-touch.json');
	writeFileSync(arbitrary, 'sentinel\n');
	seedCanonicalStaleOutput();
	try {
		await assert.rejects(() => runNpmPublicationPrewriteGate({
			reviewedCommit: 'ABC',
			releaseVersion,
			outputPath: arbitrary,
		}), /full lowercase commit SHA/u);
		assert.equal(existsSync(NPM_PUBLICATION_PREWRITE_OUTPUT), false);
		assert.equal(readFileSync(arbitrary, 'utf8'), 'sentinel\n');
	} finally {
		clearCanonicalOutput();
		rmSync(root, { recursive: true, force: true });
	}
});

test('gate evidence is deterministic for identical stable and authorization inputs', () => {
	const first = build();
	const second = build();
	assert.deepEqual(second, first);
});