import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const contractPath = join(repositoryRoot, 'selfhost', 'mvp', 'src', 'project-compiler-contract.virune');

test('project compiler line splitting avoids repeated whole-body scans', async () => {
	const source = await readFile(contractPath, 'utf8');
	const start = source.indexOf('fn splitLines(value: String) -> List<String> {');
	const end = source.indexOf('\nfn outputPath(', start);
	assert.notEqual(start, -1);
	assert.notEqual(end, -1);
	const implementation = source.slice(start, end);

	assert.match(implementation, /for character in String\.codePoints\(value\)/u);
	assert.match(implementation, /lines = List\.append\(lines, current\)/u);
	assert.match(implementation, /current = current \+ character/u);
	assert.match(implementation, /if current != ""/u);
	assert.doesNotMatch(implementation, /String\.length\(value\)/u);
	assert.doesNotMatch(implementation, /String\.slice\(value/u);
	assert.doesNotMatch(implementation, /String\.split\(value/u);
	assert.doesNotMatch(implementation, /String\.endsWith\(value/u);
	assert.doesNotMatch(implementation, /String\.isEmpty\(value\)/u);
	assert.doesNotMatch(implementation, /List\.take\(/u);
	assert.doesNotMatch(implementation, /\bwhile\b/u);
});
