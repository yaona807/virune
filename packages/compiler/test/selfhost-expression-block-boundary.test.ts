import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import {
	createSelfhostMvpKernel,
	type SelfhostMvpModule,
} from '../src/selfhost/mvp-adapter.js';
import { executeKernelOutputWithNode } from '../src/selfhost/node-executor.js';
import type { KernelInputV1 } from '../src/selfhost/contract.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

const input = (text: string): KernelInputV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const blockBoundarySource = [
	'fn choose(left: Int, right: Int, flag: Bool) -> Int {',
	'\tif flag {',
	'\t\treturn 1',
	'\t}',
	'\tif left == right {',
	'\t\treturn left',
	'\t}',
	'\treturn 0',
	'}',
	'',
	'fn find(values: List<Int>, expected: Int) -> Int {',
	'\tfor value in values {',
	'\t\tif value == expected {',
	'\t\t\treturn value',
	'\t\t}',
	'\t}',
	'\treturn 0',
	'}',
	'',
	'pub fn main() -> Int {',
	'\tif true {',
	'\t\treturn choose(2, 2, false) + find([3], 3)',
	'\t}',
	'\treturn 0',
	'}',
	'',
].join('\n');

const recordConstructionSource = [
	'record Point {',
	'\tx: Int',
	'}',
	'',
	'pub fn main() -> Int {',
	'\tlet point = Point { x: 1 }',
	'\treturn 5',
	'}',
	'',
].join('\n');

test('if and for block delimiters are not parsed as record construction', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(blockBoundarySource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 5);
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('record construction remains available when a field colon follows the brace', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(recordConstructionSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /const point = \(\{x: 1\}\);/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 5);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-expression-block-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) {
		await execFileAsync(process.execPath, ['--check', outputPath]);
	}
	const moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as SelfhostMvpModule };
}
