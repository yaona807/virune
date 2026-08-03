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
	'fn identity(value: Int) -> Int {',
	'\treturn match value {',
	'\t\tfound => found',
	'\t}',
	'}',
	'',
	'fn choose(value: Int) -> String {',
	'\treturn match value {',
	'\t\t1 => "one"',
	'\t\t_ => "other"',
	'\t}',
	'}',
	'',
	'pub fn main() -> String {',
	'\treturn choose(identity(1))',
	'}',
	'',
].join('\n');

const variantSource = [
	'pub fn inspect(value: Result<Int, String>) -> Int {',
	'\treturn match value {',
	'\t\tOk(found) => found',
	'\t\tErr(_) => 0',
	'\t}',
	'}',
	'',
	'pub fn main() -> Int {',
	'\treturn 0',
	'}',
	'',
].join('\n');

const mismatchSource = [
	'pub fn main() -> Int {',
	'\treturn match 1 {',
	'\t\t1 => 1',
	'\t\t_ => "bad"',
	'\t}',
	'}',
	'',
].join('\n');

const shadowSource = [
	'fn inspect(value: Int) -> Int {',
	'\treturn match value {',
	'\t\tvalue => value',
	'\t}',
	'}',
	'',
	'pub fn main() -> Int {',
	'\treturn inspect(1)',
	'}',
	'',
].join('\n');

test('match expressions lower through generated Checker and Emitter and execute', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(runtimeSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /const \$match\d+ = value;/);
		assert.match(emittedCode, /viruneEquals\(\$match\d+, 1\)/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 'one');
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('variant patterns emit tag tests and payload bindings', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(variantSource));
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /\?\.\$tag === "Ok"/);
		assert.match(emittedCode, /const found = \(\$match\d+\)\.\$values\[0\];/);
		assert.match(emittedCode, /\?\.\$tag === "Err"/);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('match arms must produce compatible types', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(mismatchSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L2043');
		assert.equal(output.diagnostics[0]?.message, 'Match arms must produce the same type');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('pattern bindings cannot shadow existing names', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(shadowSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L1007');
		assert.equal(output.diagnostics[0]?.message, 'Pattern binding value shadows an existing name');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-match-lowering-'));
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
