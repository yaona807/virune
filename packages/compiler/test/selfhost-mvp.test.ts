import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { runDifferentialCase } from '../src/selfhost/differential-harness.js';
import {
	createSelfhostMvpKernel,
	legacyMvpKernel,
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

const arithmeticSource = 'pub fn add(left: Int, right: Int) -> Int {\n\treturn left + right\n}\n\npub fn main() -> Int {\n\tlet value = add(20, 22)\n\treturn value * 2\n}\n';
const diagnosticSource = 'pub fn main() -> Int {\n\treturn missing\n}\n';
const qualifiedAccessSource = 'pub fn main() -> Int {\n\treturn List.length\n}\n';

test('Stage 0 builds the Virune MVP and Legacy/Self-host accepted output is identical', async () => {
	const loaded = await loadMvpModule();
	try {
		const selfhost = createSelfhostMvpKernel(loaded.module);
		const report = await runDifferentialCase({
			fixtureId: 'mvp-arithmetic-call',
			input: input(arithmeticSource),
			left: { ...legacyMvpKernel, execute: executeKernelOutputWithNode },
			right: { ...selfhost, execute: executeKernelOutputWithNode },
		});
		assert.equal(report.status, 'match');
		assert.equal(report.passed, true);
		assert.deepEqual(report.differences, []);
		assert.equal(report.left.runtime?.returnValue, 84);
		assert.equal(report.right.runtime?.returnValue, 84);

		const first = await selfhost.compile(input(arithmeticSource));
		const second = await selfhost.compile(input(arithmeticSource));
		assert.deepEqual(first, second);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('Legacy/Self-host rejected output has identical diagnostic code, message, and span', async () => {
	const loaded = await loadMvpModule();
	try {
		const report = await runDifferentialCase({
			fixtureId: 'mvp-unknown-name',
			input: input(diagnosticSource),
			left: legacyMvpKernel,
			right: createSelfhostMvpKernel(loaded.module),
		});
		assert.equal(report.status, 'match', JSON.stringify(report.differences, null, 2));
		assert.equal(report.passed, true);
		assert.deepEqual(report.differences, []);
		assert.equal(report.right.compiler.output?.diagnostics[0]?.code, 'L1010');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('qualified access reaches semantic resolution instead of lexer or parser rejection', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(qualifiedAccessSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L1010');
		assert.equal(output.diagnostics[0]?.message, 'Unknown name List.length');
		assert.ok(output.diagnostics.every(item => item.code !== 'L0001' && item.code !== 'L0002'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-mvp-'));
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
		try {
			await execFileAsync(process.execPath, ['--check', outputPath]);
		} catch (error) {
			const details = error instanceof Error && 'stderr' in error ? String(error.stderr) : String(error);
			throw new Error(`Generated MVP module ${relative(root, outputPath)} failed syntax validation:\n${details}`);
		}
	}
	const moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as SelfhostMvpModule };
}
