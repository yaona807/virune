import assert from 'node:assert/strict';
import test from 'node:test';
import { javascriptStringLiteral } from '../src/codegen/helpers.js';

test('javascriptStringLiteral preserves the value while escaping script-sensitive characters', () => {
	const value = '</script>\u2028\u2029';
	const literal = javascriptStringLiteral(value);
	assert.equal(JSON.parse(literal), value);
	assert.equal(literal, '"\\u003C\\u002Fscript\\u003E\\u2028\\u2029"');
	assert.doesNotMatch(literal, /[<>]/u);
});

test('javascriptStringLiteral retains JSON escaping for quotes and backslashes', () => {
	const value = 'quoted "value" \\ path';
	const literal = javascriptStringLiteral(value);
	assert.equal(JSON.parse(literal), value);
	assert.equal(literal, JSON.stringify(value));
});
