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

const runtimeSource = [
	'pub fn main() -> Int {',
	'\tlet mut sum = 0',
	'\tlet mut index = 0',
	'\twhile index < 10 {',
	'\t\tindex = index + 1',
	'\t\tif index == 2 {',
	'\t\t\tcontinue',
	'\t\t}',
	'\t\tif index == 6 {',
	'\t\t\tbreak',
	'\t\t}',
	'\t\tsum = sum + index',
	'\t}',
	'\tfor value in [1, 2, 3, 4] {',
	'\t\tif value == 2 {',
	'\t\t\tcontinue',
	'\t\t}',
	'\t\tif value == 4 {',
	'\t\t\tbreak',
	'\t\t}',
	'\t\tsum = sum + value',
	'\t}',
	'\treturn sum',
	'}',
	'',
].join('\n');

const nestedLoopSource = [
	'pub fn main() -> Int {',
	'\tlet mut total = 0',
	'\tfor outer in [1, 2, 3] {',
	'\t\tif outer == 3 {',
	'\t\t\tbreak',
	'\t\t}',
	'\t\tfor inner in [1, 2, 3] {',
	'\t\t\tif inner == 2 {',
	'\t\t\t\tcontinue',
	'\t\t\t}',
	'\t\t\tif inner == 3 {',
	'\t\t\t\tbreak',
	'\t\t\t}',
	'\t\t\ttotal = total + outer + inner',
	'\t\t}',
	'\t}',
	'\treturn total',
	'}',
	'',
].join('\n');

const breakOutsideLoop = [
	'pub fn main() -> Int {',
	'\tbreak',
	'\treturn 0',
	'}',
	'',
].join('\n');

const continueOutsideLoop = [
	'pub fn main() -> Int {',
	'\tcontinue',
	'\treturn 0',
	'}',
	'',
].join('\n');

test('break and continue execute in while, for, and nested loops and reject loop-external use', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(runtimeSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /break;/);
		assert.match(emittedCode, /continue;/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 17);
		assert.equal(runtime.panic, null);

		const nestedRequest = input(nestedLoopSource);
		const nestedOutput = await createSelfhostMvpKernel(loaded.module).compile(nestedRequest);
		assert.equal(nestedOutput.accepted, true, JSON.stringify(nestedOutput.diagnostics, null, 2));
		assert.deepEqual(nestedOutput.diagnostics, []);
		const nestedRuntime = await executeKernelOutputWithNode(nestedRequest, nestedOutput);
		assert.equal(nestedRuntime.returnValue, 5);
		assert.equal(nestedRuntime.panic, null);

		const invalidBreak = await createSelfhostMvpKernel(loaded.module).compile(input(breakOutsideLoop));
		assert.equal(invalidBreak.accepted, false);
		assert.equal(invalidBreak.diagnostics[0]?.code, 'L2095');
		assert.equal(invalidBreak.diagnostics[0]?.message, 'break can be used only inside a loop');

		const invalidContinue = await createSelfhostMvpKernel(loaded.module).compile(input(continueOutsideLoop));
		assert.equal(invalidContinue.accepted, false);
		assert.equal(invalidContinue.diagnostics[0]?.code, 'L2096');
		assert.equal(invalidContinue.diagnostics[0]?.message, 'continue can be used only inside a loop');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-break-continue-'));
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
