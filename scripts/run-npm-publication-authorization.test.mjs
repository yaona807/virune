import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
	NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
	NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
} from './npm-publication-authorization-contract.mjs';
import { runNpmPublicationAuthorization, validateEvidenceDocument } from './run-npm-publication-authorization.mjs';

const repositoryRoot = resolve('.');
const evidenceSetId = 'github-actions:32550000000:1';

function exactHead() {
	const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
	assert.equal(git.status, 0, git.stderr);
	const head = git.stdout.trim();
	assert.match(head, /^[0-9a-f]{40}$/u);
	return head;
}

function evidenceDocument() {
	return { schemaVersion: 1, evidenceSetId, records: [] };
}

function injectedCandidatePlan() {
	return {
		stage: 'publication-candidate',
		publicationReady: true,
		unresolvedRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
		packages: [{ directory: 'cli', workspaceName: 'virune', registryName: 'virune', role: 'cli' }],
		authorization: {
			schemaVersion: 1,
			reportKind: 'npm-publication-authorization-v1',
			evidenceSchemaVersion: 1,
			evidenceSetBindingRequired: true,
			preWriteRequirements: [...NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS],
			postWriteCompletionRequirements: [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS],
		},
	};
}

test('a failed exact-head rerun invalidates stale passing authorization evidence before validation', async () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-auth-stale-'));
	try {
		const outputPath = join(root, 'authorization.json');
		writeFileSync(outputPath, '{"publicationReady":true}\n');
		await assert.rejects(() => runNpmPublicationAuthorization({
			reviewedCommit: exactHead(),
			releaseVersion: '1.0.0',
			evidenceSetId,
			publicationManifestBytes: Buffer.from('{}\n'),
			evidenceDocument: evidenceDocument(),
			outputPath,
		}), /publication-candidate/u);
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

test('production path always reads plan, root version and repository from the exact reviewed Git commit', async () => {
	const head = exactHead();
	await assert.rejects(
		() => runNpmPublicationAuthorization({
			reviewedCommit: head,
			releaseVersion: '1.0.0',
			evidenceSetId,
			publicationManifestBytes: Buffer.from('{}\n'),
			evidenceDocument: evidenceDocument(),
			publicationPlan: injectedCandidatePlan(),
			reviewedRootManifest: { version: '1.0.0' },
			sourceRoot: '/definitely/not/the/virune/repository',
			outputPath: null,
		}),
		/publication-candidate/u,
		'injected source state and repository root must be ignored in favor of the exact reviewed Virune commit',
	);
	await assert.rejects(
		() => runNpmPublicationAuthorization({
			reviewedCommit: head,
			releaseVersion: '1.1.0',
			evidenceSetId,
			publicationManifestBytes: Buffer.from('{}\n'),
			evidenceDocument: evidenceDocument(),
			reviewedRootManifest: { version: '1.1.0' },
			outputPath: null,
		}),
		/reviewed package\.json version is 1\.0\.0/u,
		'injected root version must not replace the exact reviewed package.json',
	);
});

test('unknown reviewed commits fail closed rather than falling back to checkout policy', async () => {
	await assert.rejects(
		() => runNpmPublicationAuthorization({
			reviewedCommit: 'f'.repeat(40),
			releaseVersion: '1.1.0-rc.1',
			evidenceSetId,
			publicationManifestBytes: Buffer.from('{}\n'),
			evidenceDocument: evidenceDocument(),
			outputPath: null,
		}),
		/Failed to read reviewed \.github\/release\/npm-publication-v1\.json/u,
	);
});
