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

const listIterationSource = [
	'pub fn main() -> Int {',
	'\tlet values = [1, 2, 3]',
	'\tlet mut total: Int = 0',
	'\tfor value in values {',
	'\t\ttotal = total + value',
	'\t}',
	'\treturn total',
	'}',
	'',
].join('\n');

const stringIterationSource = [
	'pub fn main() -> String {',
	'\tlet mut result: String = ""',
	'\tfor value in "ab" {',
	'\t\tresult = result + value',
	'\t}',
	'\treturn result',
	'}',
	'',
].join('\n');

const invalidIterableSource = [
	'pub fn main() -> Int {',
	'\tfor value in 1 {',
	'\t\treturn value',
	'\t}',
	'\treturn 0',
	'}',
	'',
].join('\n');

const shadowingSource = [
	'pub fn main() -> Int {',
	'\tlet value = 1',
	'\tfor value in [2] {',
	'\t\treturn value',
	'\t}',
	'\treturn value',
	'}',
	'',
].join('\n');

const scopedLocalSource = [
	'pub fn main() -> Int {',
	'\tfor value in [1] {',
	'\t\tlet inner = value',
	'\t}',
	'\treturn inner',
	'}',
	'',
].join('\n');

test('for-in over a List lowers through the generated compiler and executes', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(listIterationSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /for \(const value of values\) \{/);
		assert.match(emittedCode, /total = intAdd\(total, value\);/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 6);
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('for-in over a String exposes String elements and executes', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(stringIterationSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 'ab');
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('for-in preserves Legacy L2004 for non-iterable values', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(invalidIterableSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L2004');
		assert.equal(output.diagnostics[0]?.message, 'for requires an iterable List, Set, Map, or String value');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('for-in preserves Legacy L1008 for a shadowing loop variable', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(shadowingSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L1008');
		assert.equal(output.diagnostics[0]?.message, 'Loop variable value shadows an existing name');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('for-in body locals do not escape the loop scope', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(scopedLocalSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L1010');
		assert.equal(output.diagnostics[0]?.message, 'Unknown name inner');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-for-in-statements-'));
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
