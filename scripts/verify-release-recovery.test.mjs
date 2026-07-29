import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateRequest, verifyReleaseRecovery } from './verify-release-recovery.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'virune-release-recovery-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, '.github/release-recovery'), { recursive: true });
	await mkdir(join(root, '.github/release-verification'), { recursive: true });
	await mkdir(join(root, 'artifact/release'), { recursive: true });
	const bytes = Buffer.from('immutable release asset');
	const asset = { file: 'virune-1.0.0.tgz', sha256: digest(bytes), bytes: bytes.byteLength };
	const request = {
		schemaVersion: 1,
		repository: 'yaona807/virune',
		issue: 87,
		tag: 'v1.0.0',
		expectedCommit: 'a'.repeat(40),
		sourceRunId: 123,
		sourceArtifactId: 456,
		sourceArtifactName: 'release-evidence-v1.0.0',
		sourceArtifactDigest: `sha256:${'b'.repeat(64)}`,
		verificationFile: '.github/release-verification/v1.0.0.json',
		reason: 'Restore a deleted public stable release from retained immutable evidence.',
	};
	const verification = {
		schemaVersion: 1,
		repository: request.repository,
		tag: request.tag,
		tagCommit: request.expectedCommit,
		expectedCommit: request.expectedCommit,
		assets: [asset],
		passed: true,
	};
	await writeFile(join(root, '.github/release-recovery/v1.0.0.json'), `${JSON.stringify(request)}\n`);
	await writeFile(join(root, '.github/release-verification/v1.0.0.json'), `${JSON.stringify(verification)}\n`);
	await writeFile(join(root, 'artifact/release/virune-1.0.0.tgz'), bytes);
	await writeFile(join(root, 'artifact/release/SHA256SUMS'), `${asset.sha256}  ${asset.file}\n`);
	return { root };
}

test('accepts a retained artifact that exactly matches committed public verification evidence', async t => {
	const { root } = await fixture(t);
	const result = await verifyReleaseRecovery({ requestPath: '.github/release-recovery/v1.0.0.json', artifactDirectory: 'artifact', root });
	assert.equal(result.tag, 'v1.0.0');
	assert.equal(result.assetCount, 2);
});

test('rejects malformed or non-stable recovery requests', () => {
	assert.throws(() => validateRequest({}), /schemaVersion/u);
	assert.throws(() => validateRequest({
		schemaVersion: 1,
		repository: 'yaona807/virune',
		issue: 87,
		tag: 'v1.0.0-rc.1',
		expectedCommit: 'a'.repeat(40),
		sourceRunId: 1,
		sourceArtifactId: 1,
		sourceArtifactName: 'artifact',
		sourceArtifactDigest: `sha256:${'b'.repeat(64)}`,
		verificationFile: '.github/release-verification/v1.0.0-rc.1.json',
		reason: 'This reason is long enough to satisfy validation.',
	}), /stable/u);
});

test('rejects unexpected files and changed release bytes', async t => {
	const first = await fixture(t);
	await writeFile(join(first.root, 'artifact/release/unexpected.txt'), 'unexpected');
	await assert.rejects(() => verifyReleaseRecovery({ requestPath: '.github/release-recovery/v1.0.0.json', artifactDirectory: 'artifact', root: first.root }), /asset set mismatch/u);

	const second = await fixture(t);
	await writeFile(join(second.root, 'artifact/release/virune-1.0.0.tgz'), 'changed');
	await assert.rejects(() => verifyReleaseRecovery({ requestPath: '.github/release-recovery/v1.0.0.json', artifactDirectory: 'artifact', root: second.root }), /byte size mismatch|digest mismatch/u);
});
