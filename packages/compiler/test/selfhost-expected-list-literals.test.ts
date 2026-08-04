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

const expectedSource = [
	'fn emptyValues() -> List<Int> {',
	'\treturn []',
	'}',
	'',
	'pub fn main() -> Int {',
	'\tlet values: List<Int> = []',
	'\treturn 0',
	'}',
	'',
].join('\n');

const untypedSource = [
	'pub fn main() -> Int {',
	'\tlet values = []',
	'\treturn 0',
	'}',
	'',
].join('\n');

test('expected List types permit empty literals without weakening untyped diagnostics', async () => {
	const loaded = await loadMvpModule();
	try {
		const accepted = await createSelfhostMvpKernel(loaded.module).compile(input(expectedSource));
		assert.equal(accepted.accepted, true, JSON.stringify(accepted.diagnostics, null, 2));
		assert.deepEqual(accepted.diagnostics, []);

		const rejected = await createSelfhostMvpKernel(loaded.module).compile(input(untypedSource));
		assert.equal(rejected.accepted, false);
		assert.equal(rejected.diagnostics[0]?.code, 'L2020');
		assert.equal(rejected.diagnostics[0]?.message, 'Cannot infer the element type of an empty List');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-expected-list-'));
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
	return {
		root,
		module: await import(`${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`) as SelfhostMvpModule,
	};
}
