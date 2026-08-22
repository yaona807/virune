import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as releaseIdentityModule from './run-npm-release-identity-evidence.mjs';
import {
	buildReleaseIdentityReport,
	parseNpmReleaseIdentityArguments,
	runNpmReleaseIdentityEvidence,
	runNpmReleaseIdentityEvidenceCli,
	snapshotReleaseDirectory,
} from './run-npm-release-identity-evidence.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const reviewedCommit = 'a'.repeat(40);
const evidenceSetId = 'github-actions:123:1';
const version = '1.1.0-rc.1';

function fixture() {
	const publicationManifest = artifact('PUBLICATION-MANIFEST.json', 'publication-manifest\n');
	const cli = artifact(`virune-npm-${version}.tgz`, 'cli-candidate\n');
	const runtime = artifact(`virune-runtime-${version}.tgz`, 'runtime-candidate\n');
	const releaseManifest = artifact('RELEASE-MANIFEST.json', 'release-manifest\n');
	const sbom = artifact('SBOM.cdx.json', 'sbom\n');
	const checksums = artifact('SHA256SUMS', 'checksums\n');
	const files = [publicationManifest, releaseManifest, sbom, checksums, runtime, cli]
		.sort((left, right) => compareText(left.file, right.file));
	const releaseArtifactSet = artifactSet(files);
	const packages = [
		{ registryName: '@virune/runtime', releaseAsset: runtime.file, sha256: runtime.sha256, bytes: runtime.bytes },
		{ registryName: 'virune', releaseAsset: cli.file, sha256: cli.sha256, bytes: cli.bytes },
	];
	const publicationIdentity = {
		schemaVersion: 1,
		version,
		githubReleaseTag: `v${version}`,
		publishSource: 'reviewed-release-registry-candidate-tarball',
		bundledCliReleaseAsset: `virune-${version}.tgz`,
		publicationReady: true,
		registryVersionEligible: true,
		distTag: 'next',
		packages,
	};
	const integrityAssets = files
		.filter(item => item.file !== 'SHA256SUMS')
		.map(item => ({ file: item.file, sha256: item.sha256, bytes: item.bytes }));
	const integrity = {
		assets: integrityAssets,
		manifest: { schemaVersion: 2, version, fileCount: integrityAssets.length - 1 },
		sbom: { format: 'CycloneDX', specVersion: '1.6', serialNumber: 'urn:uuid:test', componentCount: 1, license: 'Apache-2.0' },
	};
	const candidateAudit = {
		schemaVersion: 1,
		stage: 'exact-reviewed-registry-candidate-contents-audit',
		version,
		packageCount: packages.length,
		packages: packages.map(item => ({
			...item,
			fileCount: 3,
			totalBytes: 100,
			fileSetSha256: 'b'.repeat(64),
		})),
	};
	return {
		publicationManifest: { sha256: publicationManifest.sha256, bytes: publicationManifest.bytes },
		publicationIdentity,
		integrity,
		candidateAudit,
		releaseArtifactSet,
	};
}

test('release identity report binds one exact manifest, candidate set, integrity set, and candidate audit', () => {
	const current = fixture();
	const report = buildReleaseIdentityReport({
		reviewedCommit,
		evidenceSetId,
		version,
		...current,
	});
	assert.equal(report.schemaVersion, 1);
	assert.equal(report.kind, 'npm-release-identity-integration-v1');
	assert.equal(report.state, 'verified');
	assert.equal(report.reviewedCommit, reviewedCommit);
	assert.equal(report.evidenceSetId, evidenceSetId);
	assert.equal(report.version, version);
	assert.deepEqual(report.publicationManifest, current.publicationManifest);
	assert.deepEqual(report.packages, current.publicationIdentity.packages);
	assert.deepEqual(report.checks, {
		releaseIntegrity: 'passed',
		publicationIdentity: 'passed',
		exactCandidateContents: 'passed',
	});
});

test('report construction fails closed on manifest, release-set, integrity, and candidate-audit drift', () => {
	const cases = [
		current => { current.publicationManifest.sha256 = 'c'.repeat(64); },
		current => {
			current.releaseArtifactSet.files = current.releaseArtifactSet.files.filter(item => !item.file.startsWith('virune-runtime-'));
			current.releaseArtifactSet.fileCount = current.releaseArtifactSet.files.length;
			current.releaseArtifactSet.sha256 = artifactSet(current.releaseArtifactSet.files).sha256;
		},
		current => { current.integrity.assets[0].sha256 = 'd'.repeat(64); },
		current => { current.candidateAudit.packages[0].sha256 = 'e'.repeat(64); },
		current => { current.publicationIdentity.publicationReady = false; },
		current => { current.publicationIdentity.registryVersionEligible = false; },
	];
	for (const mutate of cases) {
		const current = fixture();
		mutate(current);
		assert.throws(() => buildReleaseIdentityReport({
			reviewedCommit,
			evidenceSetId,
			version,
			...current,
		}));
	}
});

test('release identity CLI parser rejects unknown, duplicate, empty, and partial arguments', () => {
	assert.deepEqual(parseNpmReleaseIdentityArguments([
		`--expected-commit=${reviewedCommit}`,
		`--version=${version}`,
	]), { reviewedCommit, releaseVersion: version });
	for (const args of [
		[`--expected-commit=${reviewedCommit}`],
		[`--version=${version}`],
		[`--expected-commit=${reviewedCommit}`, '--version='],
		[`--expected-commit=${reviewedCommit}`, `--version=${version}`, '--unexpected=value'],
		[`--expected-commit=${reviewedCommit}`, `--expected-commit=${reviewedCommit}`, `--version=${version}`],
		['positional', `--expected-commit=${reviewedCommit}`, `--version=${version}`],
	]) {
		assert.throws(() => parseNpmReleaseIdentityArguments(args));
	}
});

test('malformed CLI invocation invalidates stale passing identity evidence before argument validation', async () => {
	const outputDirectory = resolve(repositoryRoot, '.cache/npm-release-identity');
	const reportPath = resolve(outputDirectory, 'npm-release-identity-report.json');
	const evidencePath = resolve(outputDirectory, 'release-identity-integration-evidence.json');
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(reportPath, '{"schemaVersion":1,"state":"verified"}\n', 'utf8');
	await writeFile(evidencePath, '{"schemaVersion":1,"result":"passed"}\n', 'utf8');
	try {
		await assert.rejects(
			() => runNpmReleaseIdentityEvidenceCli(['--versoin=1.1.0-rc.1']),
			/unknown release-identity argument/u,
		);
		await assert.rejects(() => access(reportPath));
		await assert.rejects(() => access(evidencePath));
	} finally {
		await rm(outputDirectory, { recursive: true, force: true });
	}
});

test('canonical passed evidence builder is not exported as a caller authority surface', () => {
	assert.equal('buildCanonicalEvidence' in releaseIdentityModule, false);
	assert.equal(typeof releaseIdentityModule.runNpmReleaseIdentityEvidence, 'function');
});

test('current prepublication source cannot emit release-identity evidence and invalidates stale success outputs', async () => {
	const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
	const rootManifest = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
	const outputDirectory = resolve(repositoryRoot, '.cache/npm-release-identity');
	const reportPath = resolve(outputDirectory, 'npm-release-identity-report.json');
	const evidencePath = resolve(outputDirectory, 'release-identity-integration-evidence.json');
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(reportPath, '{"schemaVersion":1,"state":"verified"}\n', 'utf8');
	await writeFile(evidencePath, '{"schemaVersion":1,"result":"passed"}\n', 'utf8');
	const previous = {
		GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
		GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT,
		GITHUB_SHA: process.env.GITHUB_SHA,
	};
	try {
		process.env.GITHUB_RUN_ID = '123';
		process.env.GITHUB_RUN_ATTEMPT = '1';
		process.env.GITHUB_SHA = head;
		await assert.rejects(
			() => runNpmReleaseIdentityEvidence({ reviewedCommit: head, releaseVersion: rootManifest.version }),
			/requires publication-candidate stage/u,
		);
		await assert.rejects(() => access(reportPath));
		await assert.rejects(() => access(evidencePath));
	} finally {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		await rm(outputDirectory, { recursive: true, force: true });
	}
});

test('release snapshot is deterministic and rejects non-regular release artifacts', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-release-identity-test-'));
	try {
		await writeFile(join(root, 'b.txt'), 'b\n');
		await writeFile(join(root, 'a.txt'), 'a\n');
		const first = await snapshotReleaseDirectory(root);
		assert.deepEqual(first.identity.files.map(item => item.file), ['a.txt', 'b.txt']);
		const second = await snapshotReleaseDirectory(root);
		assert.deepEqual(second.identity, first.identity);
		await mkdir(join(root, 'directory'));
		await assert.rejects(() => snapshotReleaseDirectory(root), /must be a regular file/u);
		await rm(join(root, 'directory'), { recursive: true, force: true });
		if (process.platform !== 'win32') {
			await symlink(join(root, 'a.txt'), join(root, 'link.txt'));
			await assert.rejects(() => snapshotReleaseDirectory(root), /must be a regular file/u);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function artifact(file, contents) {
	const bytes = Buffer.from(contents, 'utf8');
	return {
		file,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		bytes: bytes.byteLength,
	};
}

function artifactSet(files) {
	return {
		fileCount: files.length,
		sha256: createHash('sha256')
			.update(files.map(item => `${item.file}\0${item.sha256}\0${item.bytes}\n`).join(''))
			.digest('hex'),
		files: files.map(item => ({ ...item })),
	};
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
