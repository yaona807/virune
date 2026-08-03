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

const mutableSource = [
	'pub fn main() -> Int {',
	'\tlet mut value: Int = 1',
	'\tvalue = value + 2',
	'\treturn value',
	'}',
	'',
].join('\n');

const immutableAssignmentSource = [
	'pub fn main() -> Int {',
	'\tlet value: Int = 1',
	'\tvalue = 2',
	'\treturn value',
	'}',
	'',
].join('\n');

const unknownAssignmentSource = [
	'pub fn main() -> Int {',
	'\tmissing = 1',
	'\treturn 0',
	'}',
	'',
].join('\n');

const assignmentTypeMismatchSource = [
	'pub fn main() -> Int {',
	'\tlet mut value: Int = 1',
	'\tvalue = "wrong"',
	'\treturn value',
	'}',
	'',
].join('\n');

test('mutable locals and assignments lower through generated compiler and execute', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(mutableSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /let value = 1;/);
		assert.match(emittedCode, /value = intAdd\(value, 2\);/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 3);
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('assignment to an immutable local preserves Legacy L2010', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(immutableAssignmentSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L2010');
		assert.equal(output.diagnostics[0]?.message, 'Cannot assign to immutable name value');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('assignment to an unknown local preserves Legacy L1009', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(unknownAssignmentSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L1009');
		assert.equal(output.diagnostics[0]?.message, 'Unknown name missing');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('assignment type mismatches preserve L2043', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(assignmentTypeMismatchSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L2043');
		assert.equal(output.diagnostics[0]?.message, 'String cannot be used as Int');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-mutable-locals-'));
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
