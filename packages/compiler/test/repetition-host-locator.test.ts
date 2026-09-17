import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';
import { discoverRepetitionHostLocator } from '../src/interop/repetition-host-locator.js';
import { buildProject } from '../src/project/project.js';

const source = (text: string, id = 1) => ({ id, path: `test-${id}.virune`, text });
const errorCodes = (result: { readonly diagnostics: readonly { readonly severity: string; readonly code: string }[] }): string[] =>
	result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);

test('repetition Host locator accepts the prototype extern declaration and resolves its tuple', () => {
	const result = compileSource(source('@repetitionHost("render", 1)\nextern js "./host.js" {}\n'), { emit: false });
	assert.deepEqual(errorCodes(result), []);
	assert.ok(result.ast);
	const resolution = discoverRepetitionHostLocator([result.ast]);
	assert.equal(resolution.status, 'ready');
	if (resolution.status !== 'ready') return;
	assert.equal(resolution.locator.module, './host.js');
	assert.equal(resolution.locator.exportName, 'render');
	assert.equal(resolution.locator.protocolVersion, 1);
});

test('repetition Host locator discovery returns none without a valid locator', () => {
	const result = compileSource(source('fn value() -> Int => 1\n'), { emit: false });
	assert.deepEqual(errorCodes(result), []);
	assert.ok(result.ast);
	assert.deepEqual(discoverRepetitionHostLocator([result.ast]), { status: 'none' });
});

test('repetition Host locator rejects invalid declaration targets, arguments, versions, and unsafe externs', () => {
	const cases = [
		['@repetitionHost("render", 1)\nfn value() -> Int => 1\n', 'L2130'],
		['@repetitionHost("render")\nextern js "./host.js" {}\n', 'L2131'],
		['@repetitionHost("render", "1")\nextern js "./host.js" {}\n', 'L2131'],
		['@repetitionHost("render", 2)\nextern js "./host.js" {}\n', 'L2132'],
		['@repetitionHost("render", 1)\nunsafe extern js "./host.js" {}\n', 'L2133'],
	] as const;
	for (const [text, expected] of cases) {
		const result = compileSource(source(text), { emit: false });
		assert.ok(errorCodes(result).includes(expected), `${expected}: ${text}`);
	}
});

test('duplicate repetition Host attributes keep existing duplicate-attribute diagnostics authoritative', () => {
	const result = compileSource(source('@repetitionHost("render", 1)\n@repetitionHost("render", 1)\nextern js "./host.js" {}\n'), { emit: false });
	assert.equal(errorCodes(result).filter(code => code === 'L2051').length, 1);
	assert.equal(errorCodes(result).includes('L2134'), false);
});

test('project build rejects more than one valid repetition Host locator deterministically', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-repetition-host-locator-'));
	try {
		await mkdir(join(root, 'src'), { recursive: true });
		await writeFile(join(root, 'virune.json'), JSON.stringify({
			languageVersion: '1.0',
			platform: 'browser',
			sourceDir: 'src',
			outDir: 'dist',
			entry: 'src/main.virune',
			target: 'es2022',
			sourceMap: true,
			sourcesContent: true,
		}));
		await writeFile(join(root, 'src/main.virune'), 'import "./first.virune"\nimport "./second.virune"\nfn main() -> Int => 0\n');
		await writeFile(join(root, 'src/first.virune'), '@repetitionHost("renderFirst", 1)\nextern js "./first-host.js" {}\n');
		await writeFile(join(root, 'src/second.virune'), '@repetitionHost("renderSecond", 1)\nextern js "./second-host.js" {}\n');
		const result = await buildProject(root, { write: false });
		assert.equal(result.diagnostics.filter(item => item.severity === 'error' && item.code === 'L2134').length, 2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
