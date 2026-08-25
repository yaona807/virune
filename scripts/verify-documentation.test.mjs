import assert from 'node:assert/strict';
import test from 'node:test';
import { linksToJapaneseCounterpart } from './verify-documentation.mjs';

test('recognizes the current Japanese-version link label', () => {
	assert.equal(linksToJapaneseCounterpart('[日本語版](README_ja.md)'), true);
	assert.equal(linksToJapaneseCounterpart('[日本語](README_ja.md)'), true);
	assert.equal(linksToJapaneseCounterpart('[Japanese](README_ja.md)'), false);
	assert.equal(linksToJapaneseCounterpart('[日本語版](README.md)'), false);
});
