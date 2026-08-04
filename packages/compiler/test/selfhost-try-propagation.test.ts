import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Err, None, Ok, Some } from '@virune/runtime/v2/index.js';
import { buildProject } from '../src/project/project.js';
import { createSelfhostMvpKernel, type SelfhostMvpModule } from '../src/selfhost/mvp-adapter.js';
import type { KernelInputV1, KernelOutputV1 } from '../src/selfhost/contract.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

const input = (text: string): KernelInputV1 => ({
	contractVersion: '1', languageVersion: '1.0', platform: 'node', entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text }], interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const source = [
	'fn identityOption(value: Int?) -> Int? {',
	'\treturn value',
	'}',
	'',
	'fn identityResult(value: Result<Int, String>) -> Result<Int, String> {',
	'\treturn value',
	'}',
	'',
	'pub fn propagateOption(value: Int?, fallback: Int?) -> Int? {',
	'\tlet ignored = identityOption(value)?',
	'\treturn fallback',
	'}',
	'',
	'pub fn propagateResult(value: Result<Int, String>, fallback: Result<Int, String>) -> Result<Int, String> {',
	'\tlet ignored = identityResult(value)?',
	'\treturn fallback',
	'}',
	'',
	'pub fn main() -> Int {',
	'\treturn 0',
	'}',
	'',
].join('\n');

const incompatibleOption = [
	'pub fn main(value: Int?) -> Int {',
	'\tlet unwrapped = value?',
	'\treturn unwrapped',
	'}',
	'',
].join('\n');

const incompatibleResultError = [
	'pub fn main(value: Result<Int, String>) -> Result<Int, Bool> {',
	'\tlet ignored = value?',
	'\treturn value',
	'}',
	'',
].join('\n');

test('postfix ? propagates Option and Result call results and preserves Legacy diagnostics', async () => {
	const loaded = await loadMvpModule();
	let runtimeRoot = '';
	try {
		const request = input(source);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		assert.match(output.emittedModules.map(item => item.code).join('\n'), /propagate\(identity(?:Option|Result)\(/);
		const materialized = await materializeOutput(request, output);
		runtimeRoot = materialized.root;
		const module = materialized.module as {
			propagateOption: (value: unknown, fallback: unknown) => unknown;
			propagateResult: (value: unknown, fallback: unknown) => unknown;
		};
		assert.deepEqual(module.propagateOption(Some(1), Some(9)), Some(9));
		assert.deepEqual(module.propagateOption(None, Some(9)), None);
		assert.deepEqual(module.propagateResult(Ok(1), Ok(9)), Ok(9));
		assert.deepEqual(module.propagateResult(Err('bad'), Ok(9)), Err('bad'));

		const optionFailure = await createSelfhostMvpKernel(loaded.module).compile(input(incompatibleOption));
		assert.equal(optionFailure.accepted, false);
		assert.equal(optionFailure.diagnostics[0]?.code, 'L2021');
		assert.equal(optionFailure.diagnostics[0]?.message, 'Cannot propagate Int? from function returning Int');

		const resultFailure = await createSelfhostMvpKernel(loaded.module).compile(input(incompatibleResultError));
		assert.equal(resultFailure.accepted, false);
		assert.equal(resultFailure.diagnostics[0]?.code, 'L2043');
		assert.equal(resultFailure.diagnostics[0]?.message, 'String cannot be used as Bool');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
		if (runtimeRoot !== '') await rm(runtimeRoot, { recursive: true, force: true });
	}
});

async function materializeOutput(inputValue: KernelInputV1, output: KernelOutputV1): Promise<{ readonly root: string; readonly module: unknown }> {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-try-output-'));
	for (const emitted of output.emittedModules) {
		const outputPath = join(root, emitted.outputPath);
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, emitted.code);
	}
	await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
	const entry = output.emittedModules.find(item => item.sourcePath === inputValue.entryPath);
	assert.ok(entry);
	return { root, module: await import(`${pathToFileURL(join(root, entry.outputPath)).href}?test=${Date.now()}`) };
}

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-try-compiler-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) await execFileAsync(process.execPath, ['--check', outputPath]);
	return { root, module: await import(`${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`) as SelfhostMvpModule };
}
