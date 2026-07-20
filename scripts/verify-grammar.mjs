// @virune-rule grammar.complete
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const path = resolve('spec/grammar.ebnf');
const original = await readFile(path, 'utf8');

// Remove comments, prose terminals, and quoted literals before collecting symbols.
const grammar = original
	.replace(/\(\*[\s\S]*?\*\)/gu, ' ')
	.replace(/"(?:\\.|[^"\\])*"/gu, ' ');

const definitionPattern = /^\s*([A-Z][A-Za-z0-9_]*)\s*=/gmu;
const definitions = new Map();
for (const match of grammar.matchAll(definitionPattern)) {
	const name = match[1];
	const count = definitions.get(name) ?? 0;
	definitions.set(name, count + 1);
}

const duplicates = [...definitions.entries()]
	.filter(([, count]) => count > 1)
	.map(([name]) => name)
	.sort();
if (duplicates.length > 0) {
	throw new Error(`Duplicate grammar definitions: ${duplicates.join(', ')}`);
}

const rhs = grammar.replace(definitionPattern, '');
const references = new Set(rhs.match(/\b[A-Z][A-Za-z0-9_]*\b/gu) ?? []);
const builtins = new Set(['EOF', 'UnicodeScalarExceptQuoteBackslashCrLf']);
const undefinedSymbols = [...references]
	.filter(name => !definitions.has(name) && !builtins.has(name))
	.sort();
if (undefinedSymbols.length > 0) {
	throw new Error(`Undefined grammar symbols: ${undefinedSymbols.join(', ')}`);
}

for (const required of [
	'Module',
	'Declaration',
	'Statement',
	'Expression',
	'Pattern',
	'TypeReference',
	'Identifier',
	'NewLine',
]) {
	if (!definitions.has(required)) throw new Error(`Required grammar definition is missing: ${required}`);
}

console.log(`Verified complete grammar with ${definitions.size} nonterminal definitions.`);
