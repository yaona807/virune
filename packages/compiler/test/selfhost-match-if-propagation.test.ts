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

const branchSource = [
	'pub fn choose(flag: Bool) -> Int {',
	'\tif flag {',
	'\t\treturn 1',
	'\t} else {',
	'\t\treturn 2',
	'\t}',
	'}',
	'',
	'pub fn main() -> Int {',
	'\treturn choose(false)',
	'}',
	'',
].join('\n');

const earlyReturnSource = [
	'pub fn choose(flag: Bool) -> Int {',
	'\tif flag {',
	'\t\treturn 7',
	'\t}',
	'\treturn 3',
	'}',
	'',
	'pub fn main() -> Int {',
	'\treturn choose(true)',
	'}',
	'',
].join('\n');

const scopedLocalSource = [
	'pub fn scoped(flag: Bool) -> Int {',
	'\tif flag {',
	'\t\tlet inner = 1',
	'\t}',
	'\treturn inner',
	'}',
	'',
	'pub fn main() -> Int {',
	'\treturn scoped(true)',
	'}',
	'',
].join('\n');

const invalidConditionSource = [
	'pub fn main() -> Int {',
	'\tif 1 {',
	'\t\treturn 1',
	'\t}',
	'\treturn 0',
	'}',
	'',
].join('\n');

test('block if/else lowers through the generated compiler and executes', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(branchSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /if \(flag\) \{/);
		assert.match(emittedCode, /\} else \{/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 2);
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('block if without else supports early return', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(earlyReturnSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 7);
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('block locals do not escape either branch', async () => {
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

test('block if requires a Bool condition', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(invalidConditionSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L2043');
		assert.equal(output.diagnostics[0]?.message, 'Int cannot be used as Bool');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-block-if-'));
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
