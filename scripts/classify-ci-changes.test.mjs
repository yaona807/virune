import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyChangedPaths, isDocumentationPath } from './classify-ci-changes.mjs';

test('classifies maintained Markdown documentation as documentation-only', () => {
	const result = classifyChangedPaths(['README.md', 'docs/language-guide.md', 'docs/language-guide_ja.md']);
	assert.equal(result.docsOnly, true);
	assert.equal(result.changedCount, 3);
});

test('requires the full gate for workflow, dependency, source, and schema changes', () => {
	for (const path of [
		'.github/workflows/ci.yml',
		'package-lock.json',
		'packages/compiler/src/compiler.ts',
		'docs/documentation-examples.json',
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
	assert.equal(isDocumentationPath('.github/README.md'), false);
	assert.equal(isDocumentationPath('docs/schema.json'), false);
});
