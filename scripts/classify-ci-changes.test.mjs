import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { classifyChangedPaths, isDocumentationPath } from './classify-ci-changes.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('classifies maintained Markdown documentation as documentation-only', () => {
	const result = classifyChangedPaths([
		'README.md',
		'docs/language-guide.md',
		'docs/language-guide_ja.md',
		'.github/PULL_REQUEST_TEMPLATE/self-hosting.md',
		'.github/self-hosting-operations/README.md',
		'.github/self-hosting-operations/README_ja.md',
	]);
	assert.equal(result.docsOnly, true);
	assert.equal(result.changedCount, 6);
});

test('requires the full gate for workflow, dependency, source, schema, and executable policy changes', () => {
	for (const path of [
		'.github/workflows/ci.yml',
		'.github/PULL_REQUEST_TEMPLATE/config.yml',
		'.github/self-hosting-operations/schema.json',
		'package-lock.json',
		'packages/compiler/src/compiler.ts',
		'docs/documentation-examples.json',
		'scripts/classify-ci-changes.mjs',
		'spec/grammar.ebnf',
	]) {
		assert.equal(classifyChangedPaths(['README.md', path]).docsOnly, false, path);
	}
});

test('does not treat an empty change set as documentation-only', () => {
	assert.deepEqual(classifyChangedPaths([]), { docsOnly: false, changedCount: 0, paths: [] });
});

test('normalizes separators and removes duplicate paths', () => {
	const result = classifyChangedPaths(['docs\\guide.md', 'docs/guide.md', '']);
	assert.deepEqual(result, { docsOnly: true, changedCount: 1, paths: ['docs/guide.md'] });
});

test('limits documentation paths to reviewed Markdown locations', () => {
	assert.equal(isDocumentationPath('SECURITY.md'), true);
	assert.equal(isDocumentationPath('docs/release-channels.md'), true);
	assert.equal(isDocumentationPath('.github/PULL_REQUEST_TEMPLATE/self-hosting.md'), true);
	assert.equal(isDocumentationPath('.github/self-hosting-operations/README_ja.md'), true);
	assert.equal(isDocumentationPath('.github/README.md'), false);
	assert.equal(isDocumentationPath('.github/PULL_REQUEST_TEMPLATE/config.yml'), false);
	assert.equal(isDocumentationPath('docs/schema.json'), false);
});

test('runs self-host CI triage and temporary-artifact policy tests', () => {
	const result = spawnSync(process.execPath, [
		'--test',
		'scripts/classify-selfhost-ci-failure.test.mjs',
		'scripts/verify-selfhost-temporary-artifacts.test.mjs',
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('requires the current tracked tree to declare every temporary artifact', () => {
	const result = spawnSync(process.execPath, [
		'scripts/verify-selfhost-temporary-artifacts.mjs',
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const evidence = JSON.parse(result.stdout);
	assert.equal(evidence.claim, 'selfhost-temporary-artifact-inventory');
});
