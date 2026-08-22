import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
	NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
	NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
} from './npm-publication-authorization-contract.mjs';
import {
	finalizeNpmPublicationPrewriteGate,
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

function finalize(overrides = {}) {
	return finalizeNpmPublicationPrewriteGate({
		stableReleaseEvidenceBytes: stableBytes(),
		authorizationReport: authorizationReport(),
		reviewedCommit,
		releaseVersion,
		evidenceSetId,
		...overrides,
	});
}

test('existing GitHub stable release gate does not acquire an unconditional npm pre-write dependency', () => {
	const policy = JSON.parse(readFileSync(resolve('.github/stable-release-gate.json'), 'utf8'));
	assert.equal(policy.checks.some(check => check.id.includes('prewrite') || check.id.includes('pre-write')), false);
	assert.equal(policy.requirements.some(requirement => requirement.id.includes('prewrite') || requirement.id.includes('pre-write')), false);
});

test('valid finalized release and canonical authorization persist before reaching mutation exactly once', async () => {
	const order = [];
	let received;
	let persisted;
	const report = await finalize({
		persist: async value => {
			order.push('persist');
			persisted = value;
		},
		mutation: async value => {
			order.push('mutation');
			received = value;
		},
	});
	assert.deepEqual(order, ['persist', 'mutation']);
	assert.equal(report.publicationReady, true);
	assert.equal(report.reviewedCommit, reviewedCommit);
	assert.equal(report.evidenceSetId, evidenceSetId);
	assert.equal(report.version, releaseVersion);
	assert.deepEqual(persisted, report);
	assert.deepEqual(received.prewriteGate, report);
	assert.equal(received.authorization.kind, NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND);
	assert.deepEqual(report.stableReleaseEvidence, {
		sha256: createHash('sha256').update(stableBytes()).digest('hex'),
		bytes: stableBytes().byteLength,
	});
});

test('mutation cannot run without persisted pre-write gate evidence', async () => {
	let calls = 0;
	await assert.rejects(() => finalize({ mutation: async () => { calls += 1; } }), /requires persisted pre-write gate evidence/u);
	assert.equal(calls, 0);
});

test('stable release evidence identity and pass state fail closed before persistence or mutation', async () => {
	const mutations = [
		report => { report.schemaVersion = 2; },
		report => { report.version = '1.1.0-rc.2'; },
		report => { report.commit = 'b'.repeat(40); },
		report => { report.expectedNightlySha = 'b'.repeat(40); },
		report => { report.ref = ''; },
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
		let persisted = 0;
		let mutationsCalled = 0;
		await assert.rejects(() => finalize({
			stableReleaseEvidenceBytes: stableBytes(stable),
			persist: async () => { persisted += 1; },
			mutation: async () => { mutationsCalled += 1; },
		}));
		assert.equal(persisted, 0);
		assert.equal(mutationsCalled, 0);
	}
});

test('fresh stable gate bytes must match the exact report generated in the same execution', () => {
	const generated = stableReleaseReport();
	const persisted = structuredClone(generated);
	persisted.checks.pop();
	assert.throws(() => validateGeneratedStableReleaseEvidence(persisted, generated, { reviewedCommit, releaseVersion }), /differs from the report generated/u);
	assert.doesNotThrow(() => validateGeneratedStableReleaseEvidence(structuredClone(generated), generated, { reviewedCommit, releaseVersion }));
});

test('authorization report drift fails closed before persistence or mutation', async () => {
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
		let persisted = 0;
		let mutationsCalled = 0;
		await assert.rejects(() => finalize({
			authorizationReport: authorization,
			persist: async () => { persisted += 1; },
			mutation: async () => { mutationsCalled += 1; },
		}));
		assert.equal(persisted, 0);
		assert.equal(mutationsCalled, 0);
	}
});

test('stable and authorization validators reject malformed outer schemas independently', () => {
	assert.throws(() => validateStableReleaseEvidence(null, { reviewedCommit, releaseVersion }));
	assert.throws(() => validateAuthorizationReport([], { reviewedCommit, releaseVersion, evidenceSetId }));
});

test('pre-write CLI parser rejects unknown, positional, duplicate and empty options', () => {
	assert.deepEqual(parseNpmPublicationPrewriteArguments([
		`--expected-commit=${reviewedCommit}`,
		`--version=${releaseVersion}`,
		`--evidence-set-id=${evidenceSetId}`,
	]), { reviewedCommit, releaseVersion, evidenceSetId });
	for (const args of [
		['--unknown=value'],
		['positional'],
		['--versoin=1.1.0-rc.1'],
		['--version=1.1.0', '--version=1.1.0-rc.1'],
		['--evidence-set-id='],
	]) {
		assert.throws(() => parseNpmPublicationPrewriteArguments(args));
	}
});

test('CLI parse failure invalidates stale passing pre-write output before validation', async () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-prewrite-cli-'));
	try {
		const outputPath = join(root, 'prewrite.json');
		writeFileSync(outputPath, '{"publicationReady":true}\n');
		await assert.rejects(() => runNpmPublicationPrewriteGateCli(['--unknown=value'], { outputPath }));
		assert.equal(existsSync(outputPath), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('malformed direct-run identity invalidates stale passing pre-write output before repository checks', async () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-prewrite-direct-'));
	try {
		const outputPath = join(root, 'prewrite.json');
		writeFileSync(outputPath, '{"publicationReady":true}\n');
		await assert.rejects(() => runNpmPublicationPrewriteGate({
			reviewedCommit: 'ABC',
			releaseVersion,
			evidenceSetId,
			outputPath,
		}), /full lowercase commit SHA/u);
		assert.equal(existsSync(outputPath), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('gate evidence is deterministic for identical stable and authorization inputs', async () => {
	const first = await finalize();
	const second = await finalize();
	assert.deepEqual(second, first);
});
