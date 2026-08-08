import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import './run-selfhost-fixed-seed-bootstrap.test.mjs';
import { verifySelfhostSeed } from './verify-selfhost-seed.mjs';

const artifactBytes = Buffer.from('reviewed-stage-zero-seed');
const artifactSha = createHash('sha256').update(artifactBytes).digest('hex');

function manifest(overrides = {}) {
	const value = {
		schemaVersion: 1,
		seedId: 'virune-stage0-v1.0.0',
		viruneVersion: '1.0.0',
		languageVersion: '1.0',
		release: {
			repository: 'yaona807/virune',
			tag: 'v1.0.0',
			commit: 'dcaf89b2f557fde38cdfd9bceb7d23af3ba8ed51',
			url: 'https://github.com/yaona807/virune/releases/tag/v1.0.0',
			verificationEvidence: '.github/release-verification/v1.0.0.json',
			verificationRunId: 30417979118,
			recoveryRunId: 30467471246,
		},
		artifact: {
			file: 'virune-compiler-1.0.0.tgz',
			url: 'https://github.com/yaona807/virune/releases/download/v1.0.0/virune-compiler-1.0.0.tgz',
			sha256: artifactSha,
			bytes: artifactBytes.byteLength,
			package: { name: '@virune/compiler', version: '1.0.0', type: 'module', node: '>=24.0.0', runtimeDependency: '1.0.0' },
		},
		baselines: { node: '24.0.0', runtimeAbi: '2', interopAbi: '2', normalizedArtifactPolicy: '1' },
		policy: { updateMode: 'reviewed-pull-request-only', automaticUpdates: false, review: { issue: 90, pullRequest: 105 } },
	};
	return { ...value, ...overrides };
}

async function fixture(overrides = {}) {
	const root = await mkdtemp(resolve(tmpdir(), 'virune-seed-test-'));
	await mkdir(resolve(root, '.github/release-verification'), { recursive: true });
	await mkdir(resolve(root, '.github/workflows'), { recursive: true });
	await mkdir(resolve(root, '.github/self-hosting'), { recursive: true });
	await writeFile(resolve(root, 'package.json'), JSON.stringify({ scripts: { 'selfhost:seed:verify': 'node scripts/verify-selfhost-seed.mjs' } }), 'utf8');
	await writeFile(resolve(root, '.github/workflows/ci.yml'), 'name: CI\n', 'utf8');
	const seed = manifest(overrides);
	await writeFile(resolve(root, '.github/self-hosting/stage0-seed.json'), JSON.stringify(seed), 'utf8');
	await writeFile(resolve(root, '.github/release-verification/v1.0.0.json'), JSON.stringify({
		version: '1.0.0', tag: 'v1.0.0', tagCommit: seed.release.commit, verificationRunId: seed.release.verificationRunId, passed: true,
		assets: [{ file: seed.artifact.file, sha256: seed.artifact.sha256, bytes: seed.artifact.bytes }],
	}), 'utf8');
	const artifactPath = resolve(root, seed.artifact.file);
	await writeFile(artifactPath, artifactBytes);
	return { root, artifactPath };
}

const packageMetadataReader = async () => ({
	name: '@virune/compiler', version: '1.0.0', type: 'module', engines: { node: '>=24.0.0' }, dependencies: { '@virune/runtime': '1.0.0' },
});

test('verifies a reviewed local Stage 0 seed', async () => {
	const { root, artifactPath } = await fixture();
	const report = await verifySelfhostSeed({ root, artifactPath, packageMetadataReader });
	assert.equal(report.passed, true);
	assert.equal(report.sha256, artifactSha);
});

test('fails when the seed artifact is missing', async () => {
	const { root } = await fixture();
	await assert.rejects(verifySelfhostSeed({ root, artifactPath: resolve(root, 'missing.tgz'), packageMetadataReader }), /artifact is missing/u);
});

test('fails when the seed checksum is tampered', async () => {
	const { root, artifactPath } = await fixture({ artifact: { ...manifest().artifact, sha256: '0'.repeat(64) } });
	await writeFile(resolve(root, '.github/release-verification/v1.0.0.json'), JSON.stringify({
		version: '1.0.0', tag: 'v1.0.0', tagCommit: manifest().release.commit, verificationRunId: manifest().release.verificationRunId, passed: true,
		assets: [{ file: manifest().artifact.file, sha256: '0'.repeat(64), bytes: artifactBytes.byteLength }],
	}), 'utf8');
	await assert.rejects(verifySelfhostSeed({ root, artifactPath, packageMetadataReader }), /checksum mismatch/u);
});

test('fails on Virune package version mismatch', async () => {
	const { root, artifactPath } = await fixture();
	await assert.rejects(verifySelfhostSeed({ root, artifactPath, packageMetadataReader: async () => ({
		name: '@virune/compiler', version: '1.0.1', type: 'module', engines: { node: '>=24.0.0' }, dependencies: { '@virune/runtime': '1.0.0' },
	}) }), /package version mismatch/u);
});

test('fails on Runtime ABI mismatch', async () => {
	const { root, artifactPath } = await fixture({ baselines: { ...manifest().baselines, runtimeAbi: '3' } });
	await assert.rejects(verifySelfhostSeed({ root, artifactPath, packageMetadataReader }), /runtimeAbi mismatch/u);
});

test('fails when automatic seed updates are enabled', async () => {
	const { root, artifactPath } = await fixture({ policy: { ...manifest().policy, automaticUpdates: true } });
	await assert.rejects(verifySelfhostSeed({ root, artifactPath, packageMetadataReader }), /automaticUpdates mismatch/u);
});

test('fails when a package script can rewrite the seed manifest', async () => {
	const { root, artifactPath } = await fixture();
	const packagePath = resolve(root, 'package.json');
	const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'));
	packageManifest.scripts['selfhost:seed:update'] = 'node scripts/write stage0-seed.json';
	await writeFile(packagePath, JSON.stringify(packageManifest), 'utf8');
	await assert.rejects(verifySelfhostSeed({ root, artifactPath, packageMetadataReader }), /Automatic Stage 0 seed update path is forbidden/u);
});
