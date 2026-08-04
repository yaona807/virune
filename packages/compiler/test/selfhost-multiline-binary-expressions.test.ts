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

const multilineSource = [
	'pub fn classify(kind: String, enabled: Bool) -> Bool {',
	'\treturn kind == "block"',
	'\t\t|| kind == "return"',
	'\t\t|| kind == "expression"',
	'\t\t&& enabled',
	'}',
	'',
	'pub fn total() -> Int {',
	'\treturn 1 +',
	'\t\t2 * 3 +',
	'\t\t4',
	'}',
	'',
	'pub fn compose(prefix: String) -> String {',
	'\treturn prefix + "function " +',
	'\t\t"body"',
	'}',
	'',
	'pub fn grouped() -> Bool {',
	'\treturn (',
	'\t\tfalse',
	'\t\t|| true',
	'\t) && true',
	'}',
	'',
	'pub fn indexed(values: List<Int>) -> Int {',
	'\treturn values[',
	'\t\t1',
	'\t]',
	'}',
	'',
	'pub fn main() -> Int {',
	'\tif classify("return", false) && grouped() {',
	'\t\treturn total() + indexed([5, 7])',
	'\t}',
	'\treturn 0',
	'}',
	'',
].join('\n');

test('multiline binary expressions preserve precedence and execute through the generated compiler', async () => {
	const loaded = await loadMvpModule();
	try {
		const request = input(multilineSource);
		const output = await createSelfhostMvpKernel(loaded.module).compile(request);
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /\|\|/);
		assert.match(emittedCode, /&&/);
		assert.match(emittedCode, /intAdd\(/);
		assert.match(emittedCode, /intMultiply\(/);
		assert.match(emittedCode, /"function " \+ "body"/);
		const runtime = await executeKernelOutputWithNode(request, output);
		assert.equal(runtime.returnValue, 18);
		assert.equal(runtime.panic, null);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => item.code + ':' + item.message), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-multiline-binary-'));
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
	const moduleUrl = pathToFileURL(join(root, 'main.js')).href + '?test=' + Date.now();
	return { root, module: await import(moduleUrl) as SelfhostMvpModule };
}
