import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const grammarUrl = new URL('../syntaxes/virune.tmLanguage.json', import.meta.url);
const languageConfigurationUrl = new URL('../language-configuration.json', import.meta.url);
const tokensUrl = new URL('../../compiler/src/syntax/tokens.ts', import.meta.url);

const readJson = async url => JSON.parse(await readFile(url, 'utf8'));

test('TextMate grammar registers the Virune source scope', async () => {
	const grammar = await readJson(grammarUrl);
	assert.equal(grammar.scopeName, 'source.virune');
	assert.ok(Array.isArray(grammar.patterns));
	assert.ok(grammar.patterns.length > 0);
});

test('TextMate grammar contains every compiler keyword', async () => {
	const [grammarText, tokensText] = await Promise.all([
		readFile(grammarUrl, 'utf8'),
		readFile(tokensUrl, 'utf8'),
	]);
	const keywords = [...tokensText.matchAll(/keyword\('[^']+', \/([a-z]+)\\b\/\)/gu)].map(match => match[1]);
	assert.ok(keywords.length > 0);
	for (const keyword of keywords) assert.match(grammarText, new RegExp(`\\b${keyword}\\b`, 'u'), `Missing keyword: ${keyword}`);
});

test('TextMate grammar does not declare Rust-only keywords', async () => {
	const grammarText = await readFile(grammarUrl, 'utf8');
	for (const keyword of ['crate', 'macro_rules', 'struct', 'trait']) {
		assert.doesNotMatch(grammarText, new RegExp(`\\b${keyword}\\b`, 'u'));
	}
});

test('language configuration enables only Virune line comments', async () => {
	const configuration = await readJson(languageConfigurationUrl);
	assert.equal(configuration.comments.lineComment, '//');
	assert.equal(configuration.comments.blockComment, undefined);
	assert.deepEqual(configuration.brackets, [['{', '}'], ['[', ']'], ['(', ')']]);
});


test('TextMate grammar recognizes Virune string interpolation', async () => {
	const grammarText = await readFile(grammarUrl, 'utf8');
	assert.match(grammarText, /meta\.interpolation\.virune/u);
	assert.match(grammarText, /punctuation\.section\.interpolation\.begin\.virune/u);
	assert.match(grammarText, /constant\.character\.escape\.brace\.virune/u);
});
