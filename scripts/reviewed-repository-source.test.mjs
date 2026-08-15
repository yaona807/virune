import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { createReviewedRepositorySourceReader } from './reviewed-repository-source.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('reads the exact bytes from a reviewed Git commit', async () => {
	const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
	assert.match(commit, /^[0-9a-f]{40}$/u);
	const reader = createReviewedRepositorySourceReader(repositoryRoot, commit);
	const [reviewed, workingTree] = await Promise.all([
		reader.read('package.json'),
		readFile(resolve(repositoryRoot, 'package.json')),
	]);
	assert.deepEqual(reviewed, workingTree);
});

test('optional reviewed paths may be absent without weakening required reads', async () => {
	const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim();
	const reader = createReviewedRepositorySourceReader(repositoryRoot, commit);
	assert.equal(await reader.read('definitely-not-present-for-reviewed-source-test.txt', { optional: true }), undefined);
	await assert.rejects(
		() => reader.read('definitely-not-present-for-reviewed-source-test.txt'),
		/Failed to read reviewed source/u,
	);
});

test('working-tree mode preserves required and optional file semantics', async () => {
	const reader = createReviewedRepositorySourceReader(repositoryRoot, undefined);
	assert.deepEqual(await reader.read('package.json'), await readFile(resolve(repositoryRoot, 'package.json')));
	assert.equal(await reader.read('definitely-not-present-for-reviewed-source-test.txt', { optional: true }), undefined);
});

test('invalid or unavailable reviewed commits fail closed', () => {
	assert.throws(
		() => createReviewedRepositorySourceReader(repositoryRoot, 'HEAD'),
		/reviewedCommit must be a full commit SHA/u,
	);
	assert.throws(
		() => createReviewedRepositorySourceReader(repositoryRoot, '0000000000000000000000000000000000000000'),
		/not available in the repository/u,
	);
});

test('repository source paths cannot escape the repository root', async () => {
	const reader = createReviewedRepositorySourceReader(repositoryRoot, undefined);
	for (const path of ['../LICENSE', '/etc/passwd', 'packages//vscode/package.json', './package.json']) {
		await assert.rejects(
			() => reader.read(path),
			/normalized repository-relative path/u,
		);
	}
});
