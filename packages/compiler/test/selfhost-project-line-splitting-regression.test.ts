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

	assert.match(implementation, /String\.isEmpty\(value\)/u);
	assert.match(implementation, /String\.split\(value, "\\n"\)/u);
	assert.match(implementation, /String\.endsWith\(value, "\\n"\)/u);
	assert.match(implementation, /List\.take\(lines, List\.length\(lines\) - 1\)/u);
	assert.doesNotMatch(implementation, /String\.length\(value\)/u);
	assert.doesNotMatch(implementation, /String\.slice\(value/u);
	assert.doesNotMatch(implementation, /\bwhile\b/u);
});
