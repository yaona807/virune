import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compareReleaseDirectories } from './verify-reproducible-release.mjs';

async function fixture(run) {
	const root = await mkdtemp(resolve(tmpdir(), 'virune-repro-test-'));
	try {
		const a = resolve(root, 'a');
		const b = resolve(root, 'b');
		await mkdir(a);
		await mkdir(b);
		await run(a, b);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('identical release trees are reproducible', () => fixture(async (a, b) => {
	await writeFile(resolve(a, 'MANIFEST.json'), '{"schemaVersion":1}\n');
	await writeFile(resolve(b, 'MANIFEST.json'), '{"schemaVersion":1}\n');
	const result = await compareReleaseDirectories(a, b);
	assert.equal(result.passed, true);
	assert.deepEqual(result.differences, []);
}));

test('content and missing entries are reported with stable kinds', () => fixture(async (a, b) => {
	await writeFile(resolve(a, 'artifact.txt'), 'left');
	await writeFile(resolve(b, 'artifact.txt'), 'right');
	await writeFile(resolve(a, 'only-a.txt'), 'value');
	const result = await compareReleaseDirectories(a, b);
	assert.equal(result.passed, false);
	assert.ok(result.differences.some(item => item.kind === 'file-content' && item.path === 'artifact.txt'));
	assert.ok(result.differences.some(item => item.kind === 'missing-entry' && item.path === 'only-a.txt'));
}));

test('workspace paths embedded in output are rejected', () => fixture(async (a, b) => {
	const forbidden = resolve(a, 'workspace');
	await writeFile(resolve(a, 'metadata.txt'), `source=${forbidden}`);
	await writeFile(resolve(b, 'metadata.txt'), `source=${forbidden}`);
	const result = await compareReleaseDirectories(a, b, { forbiddenPaths: [forbidden] });
	assert.equal(result.passed, false);
	assert.ok(result.differences.some(item => item.kind === 'workspace-path'));
}));

test('file mode changes are reported on POSIX', { skip: process.platform === 'win32' }, () => fixture(async (a, b) => {
	const left = resolve(a, 'tool');
	const right = resolve(b, 'tool');
	await writeFile(left, 'same');
	await writeFile(right, 'same');
	await chmod(left, 0o755);
	await chmod(right, 0o644);
	const result = await compareReleaseDirectories(a, b);
	assert.ok(result.differences.some(item => item.kind === 'file-mode' && item.path === 'tool'));
}));
