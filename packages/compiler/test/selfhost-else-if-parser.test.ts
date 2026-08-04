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

const source = [
	'fn classify(value: Int) -> Int {',
	'\tif value == 0 {',
	'\t\treturn 10',
	'\t} else if value == 1 {',
	'\t\treturn 20',
	'\t} else if value == 2 {',
	'\t\treturn 30',
	'\t} else {',
	'\t\treturn 40',
	'\t}',
	'}',
	'',
	'pub fn main() -> Int {',
	'\treturn classify(2)',
	'}',
	'',
].join('\n');

test('else-if chains lower to nested IfValue statements and execute', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(source);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.ok((emittedCode.match(/if \(/g) ?? []).length >= 3);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 30);
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-else-if-parser-'));
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
