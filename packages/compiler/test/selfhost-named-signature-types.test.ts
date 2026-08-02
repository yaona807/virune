import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { createSelfhostMvpKernel, type SelfhostMvpModule } from '../src/selfhost/mvp-adapter.js';
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

const namedTypesSource = `fn keepPosition(value: FrontendPosition) -> FrontendPosition {
	return value
}

fn keepDiagnostics(values: List<FrontendDiagnostic>) -> List<FrontendDiagnostic> {
	return values
}

fn keepSpan(value: ParserSpan?) -> ParserSpan? {
	return value
}

fn keepResult(value: Result<String, List<JsonError>>) -> Result<String, List<JsonError>> {
	return value
}

pub fn main() -> Int {
	return 1
}
`;

test('named, generic, List, and optional signature types lower through AST, HIR, and emission', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(namedTypesSource));
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		const emittedCode = output.emittedModules.map(module => module.code).join('\n');
		assert.match(emittedCode, /function keepPosition/u);
		assert.match(emittedCode, /function keepDiagnostics/u);
		assert.match(emittedCode, /function keepSpan/u);
		assert.match(emittedCode, /function keepResult/u);
		assert.match(emittedCode, /export function main/u);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('malformed generic signatures remain fail-closed', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(
			'pub fn broken(value: Result<>) -> Int {\n\treturn 1\n}\n',
		));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L0002');
		assert.equal(output.diagnostics[0]?.message, 'Expected generic type argument');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-named-signature-types-'));
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
	const moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as SelfhostMvpModule };
}
