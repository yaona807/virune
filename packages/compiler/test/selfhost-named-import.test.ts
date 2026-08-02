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

const namedImportSource = `import {
	value,
	help as localHelp,
} from "./helper.virune"

pub fn main() -> Int {
	return 1
}
`;

const duplicateLocalNameSource = `import {
	first as value,
	second as value,
} from "./helper.virune"

pub fn main() -> Int {
	return 1
}
`;

test('named imports lower through the Pure Core parser without a syntax-boundary diagnostic', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(namedImportSource));
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		assert.equal(output.emittedModules.length, 1);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('named import aliases reject duplicate local bindings deterministically', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(duplicateLocalNameSource));
		assert.equal(output.accepted, false);
		assert.equal(output.diagnostics[0]?.code, 'L1001');
		assert.equal(output.diagnostics[0]?.message, 'Duplicate imported name value');
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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-named-import-'));
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
