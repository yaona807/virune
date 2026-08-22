import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
	NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
	NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
} from './npm-publication-authorization-contract.mjs';
import { runNpmPublicationAuthorization, validateEvidenceDocument } from './run-npm-publication-authorization.mjs';

const repositoryRoot = resolve('.');
const reviewedCommit = 'a'.repeat(40);
const evidenceSetId = 'github-actions:32550000000:1';
const version = '1.1.0-rc.1';

function publicationPlan() {
	return {
		stage: 'publication-candidate',
		publicationReady: true,
		unresolvedRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
		packages: [
			{ directory: 'cli', workspaceName: 'virune', registryName: 'virune', role: 'cli' },
		],
		authorization: {
			schemaVersion: 1,
			reportKind: NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
			evidenceSchemaVersion: 1,
			evidenceSetBindingRequired: true,
			preWriteRequirements: [...NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS],
			postWriteCompletionRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
		},
	};
}

function publicationManifestBytes() {
	return Buffer.from(`${JSON.stringify({
		schemaVersion: 1,
		version,
		githubReleaseTag: `v${version}`,
		publishSource: 'reviewed-release-registry-candidate-tarball',
		bundledCliReleaseAsset: `virune-${version}.tgz`,
		publicationReady: true,
		registryVersionEligible: true,
		distTag: 'next',
		packages: [
			{ registryName: 'virune', releaseAsset: `virune-npm-${version}.tgz`, sha256: '1'.repeat(64), bytes: 101 },
		],
	}, null, 2)}\n`, 'utf8');
}

function evidenceDocument(bytes = publicationManifestBytes()) {
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return {
		schemaVersion: 1,
		evidenceSetId,
		records: NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS.map(requirement => ({
			schemaVersion: 1,
			requirement,
			result: 'passed',
			reviewedCommit,
			evidenceSetId,
			version,
			publicationManifestSha256: sha256,
			publicationManifestBytes: bytes.byteLength,
		})),
	};
}

test('runtime authorization writes deterministic evidence only after exact inputs pass', async () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-auth-run-'));
	try {
		const outputPath = join(root, 'authorization.json');
		const bytes = publicationManifestBytes();
		const report = await runNpmPublicationAuthorization({
			reviewedCommit,
			releaseVersion: version,
			evidenceSetId,
			publicationManifestBytes: bytes,
			evidenceDocument: evidenceDocument(bytes),
			publicationPlan: publicationPlan(),
			reviewedRootManifest: { version },
			outputPath,
		});
		assert.equal(report.publicationReady, true);
		assert.equal(report.kind, NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND);
		assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), report);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a failed rerun invalidates stale passing authorization evidence before validation', async () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-auth-stale-'));
	try {
		const outputPath = join(root, 'authorization.json');
		writeFileSync(outputPath, '{"publicationReady":true}\n');
		const plan = publicationPlan();
		plan.publicationReady = false;
		await assert.rejects(() => runNpmPublicationAuthorization({
			reviewedCommit,
			releaseVersion: version,
			evidenceSetId,
			publicationManifestBytes: publicationManifestBytes(),
			evidenceDocument: evidenceDocument(),
			publicationPlan: plan,
			reviewedRootManifest: { version },
			outputPath,
		}));
		assert.equal(existsSync(outputPath), false, 'failed authorization must not leave stale passing evidence');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('evidence document schema and current execution identity fail closed', () => {
	for (const mutate of [
		document => { document.evidenceSetId = 'github-actions:older:1'; },
		document => { document.schemaVersion = 2; },
		document => { document.unexpected = true; },
		document => { delete document.records; },
	]) {
		const document = evidenceDocument();
		mutate(document);
		assert.throws(() => validateEvidenceDocument(document, evidenceSetId));
	}
});

test('production path reads plan and root version from the exact reviewed Git commit', async () => {
	const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
	assert.equal(git.status, 0, git.stderr);
	const exactHead = git.stdout.trim();
	assert.match(exactHead, /^[0-9a-f]{40}$/u);
	await assert.rejects(
		() => runNpmPublicationAuthorization({
			reviewedCommit: exactHead,
			releaseVersion: '1.0.0',
			evidenceSetId,
			publicationManifestBytes: Buffer.from('{}\n'),
			evidenceDocument: { schemaVersion: 1, evidenceSetId, records: [] },
			outputPath: null,
		}),
		/publication-candidate/u,
	);
	await assert.rejects(
		() => runNpmPublicationAuthorization({
			reviewedCommit: exactHead,
			releaseVersion: '1.1.0',
			evidenceSetId,
			publicationManifestBytes: Buffer.from('{}\n'),
			evidenceDocument: { schemaVersion: 1, evidenceSetId, records: [] },
			outputPath: null,
		}),
		/reviewed package\.json version is 1\.0\.0/u,
	);
});

test('unknown reviewed commits fail closed rather than falling back to checkout policy', async () => {
	await assert.rejects(
		() => runNpmPublicationAuthorization({
			reviewedCommit: 'f'.repeat(40),
			releaseVersion: version,
			evidenceSetId,
			publicationManifestBytes: publicationManifestBytes(),
			evidenceDocument: evidenceDocument(),
			outputPath: null,
		}),
		/Failed to read reviewed \.github\/release\/npm-publication-v1\.json/u,
	);
});
