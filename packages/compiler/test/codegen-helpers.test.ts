import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeTemplate, javascriptStringLiteral, safeName } from '../src/codegen/helpers.js';

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

test('escapeTemplate preserves the cooked value while escaping script-sensitive fragments', () => {
	const value = '</script>\u2028\u2029';
	const escaped = escapeTemplate(value);
	assert.equal(escaped, '\\u003C\\u002Fscript\\u003E\\u2028\\u2029');
	assert.equal(Function(`return \`${escaped}\`;`)(), value);
	assert.doesNotMatch(escaped, /<\/script>/u);
});

test('safeName escapes ECMAScript strict-mode binding restrictions', () => {
	for (const name of ['enum', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'eval', 'arguments']) {
		assert.equal(safeName(name), `$v_${name}`);
	}
	assert.equal(safeName('ordinary'), 'ordinary');
});

test('safeName rejects text that is not a JavaScript identifier', () => {
	assert.throws(() => safeName('bad-name'), /Invalid JavaScript identifier/u);
});
