import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildInteropAdapters, copyInteropRuntimeAssets } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('adapter build emits ESM and versioned ABI metadata', async () => {
	const root = await fixtureRoot();
	await mkdir(join(root, 'src/interop'), { recursive: true });
	await writeFile(join(root, 'src/interop/library.interop.ts'), `import { greet } from "../library.js";\nexport function invoke(value: unknown): unknown {\n\treturn typeof value === "string" ? greet(value) : undefined\n}\n`, 'utf8');
	const result = await buildInteropAdapters({ projectRoot: root, sourceDir: 'src', outDir: 'dist', write: true });
	assert.deepEqual(result.diagnostics, []);
	assert.equal(result.artifacts.length, 1);
	assert.match(await readFile(join(root, 'dist/interop/library.interop.mjs'), 'utf8'), /export function invoke/u);
	const abi = JSON.parse(await readFile(join(root, 'dist/interop/library.interop.virune-abi.json'), 'utf8')) as { schemaVersion: number; abiVersion: number; sourceHash: string; abiHash: string; provider: { id: string; version: string }; exports: unknown[] };
	assert.equal(abi.schemaVersion, 1);
	assert.equal(abi.abiVersion, 1);
	assert.match(abi.sourceHash, /^[0-9a-f]{64}$/u);
	assert.match(abi.abiHash, /^[0-9a-f]{64}$/u);
	assert.deepEqual(abi.provider, { id: 'typescript', version: '6.0.3' });
	assert.equal(abi.exports.length, 1);
});

test('adapter ABI rejects generics and callbacks', async () => {
	const root = await fixtureRoot();
	await mkdir(join(root, 'src/interop'), { recursive: true });
	await writeFile(join(root, 'src/interop/invalid.interop.ts'), `export function generic<T>(value: T): T { return value }\nexport function callback(fn: (value: string) => string): string { return fn("x") }\n`, 'utf8');
	const result = await buildInteropAdapters({ projectRoot: root, sourceDir: 'src', outDir: 'dist', write: false });
	assert.ok(result.diagnostics.some(item => item.includes('must not be generic')));
	assert.ok(result.diagnostics.some(item => item.includes('callbacks and callable objects')));
});

test('copies local JavaScript runtime assets beside emitted modules', async () => {
	const root = await fixtureRoot();
	const result = await copyInteropRuntimeAssets({ projectRoot: root, sourceDir: 'src', outDir: 'dist' });
	assert.ok(result.files.some(file => file.endsWith('library.js')));
	assert.match(await readFile(join(root, 'dist/library.js'), 'utf8'), /export function greet/u);
});
