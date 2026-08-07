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

const source = [
	'pub fn main(encoded: String) -> Result<String, List<JsonError>> {',
	'\tlet raw = Json.parse(encoded)?',
	'\tlet values = Json.decode<List<Int>>(raw)?',
	'\treturn Json.encode<List<Int>>(values)',
	'}',
	'',
].join('\n');

test('generic Json type arguments lower to executable generated code', async () => {
	const loaded = await loadMvpModule();
	try {
		const output = await createSelfhostMvpKernel(loaded.module).compile(input(source));
		assert.equal(output.accepted, true, JSON.stringify(output.diagnostics, null, 2));
		assert.deepEqual(output.diagnostics, []);
		assert.equal(output.emittedModules.length, 1);
		const emittedCode = output.emittedModules[0]?.code ?? '';
		assert.match(emittedCode, /JSON\.parse/);
		assert.match(emittedCode, /JSON\.stringify/);
		assert.doesNotMatch(emittedCode, /\bJson\.(?:parse|decode|encode)\b/u);

		const emittedPath = join(loaded.root, 'generic-json-generated.mjs');
		await writeFile(emittedPath, emittedCode);
		await execFileAsync(process.execPath, ['--check', emittedPath]);
		const generated = await import(`${pathToFileURL(emittedPath).href}?run=${Date.now()}`) as {
			readonly main: (encoded: string) => {
				readonly $tag: string;
				readonly $values: readonly unknown[];
			};
		};
		assert.deepEqual(generated.main('[1,2]'), {
			$tag: 'Ok',
			$values: ['[1,2]'],
		});
		const invalid = generated.main('{');
		assert.equal(invalid.$tag, 'Err');
		assert.equal(invalid.$values.length, 1);
		assert.ok(Array.isArray(invalid.$values[0]));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadMvpModule(): Promise<{ readonly root: string; readonly module: SelfhostMvpModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-generic-json-'));
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
