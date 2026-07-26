import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler';
import { makeCliProject, repositoryRoot, runCli } from './cli-test-helpers.js';

test('CLI init, check, build and run form a complete workflow', async () => {
	const root = await makeCliProject();
	assert.match((await runCli(['init', root])).stdout, /Initialized Virune project/u);
	const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
		dependencies: Record<string, string>;
		devDependencies: Record<string, string>;
	};
	const repositoryManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as { version: string };
	const version = repositoryManifest.version;
	const releaseBase = `https://github.com/yaona807/virune/releases/download/v${version}`;
	assert.equal(manifest.dependencies['@virune/runtime'], `${releaseBase}/virune-runtime-${version}.tgz`);
	assert.equal(manifest.dependencies['@virune/stdlib'], `${releaseBase}/virune-stdlib-${version}.tgz`);
	assert.equal(manifest.devDependencies.virune, `${releaseBase}/virune-${version}.tgz`);
	assert.match((await runCli(['check', root])).stdout, /Checked 1 module/u);
	assert.match((await runCli(['build', root])).stdout, /Built 1 module/u);
	assert.match(await readFile(join(root, 'dist/main.js'), 'utf8'), /export function main/u);
	assert.match((await runCli(['run', root])).stdout, /Hello from Virune/u);
});


test('official sample compiles, runs, and strips the argument separator', async () => {
	const root = join(repositoryRoot, 'examples/user-directory');
	assert.match((await runCli(['check', root])).stdout, /Checked 1 module/u);
	const result = await runCli(['run', root, '--', 'Alice', 'Bob']);
	assert.match(result.stdout, /Alice <alice@example.com>/u);
	assert.match(result.stdout, /Bob <未登録>/u);
	assert.match(result.stdout, /選択されたユーザー: Bob/u);
	assert.match(result.stdout, /引数の数: 2/u);
});

test('CLI discovers unimported test modules from test.include', async () => {
	const root = await makeCliProject();
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0', platform: 'node', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022', sourceMap: true, sourcesContent: true,
		test: { include: ['**/*.spec.virune'] },
	}));
	await writeFile(join(root, 'src/main.virune'), 'pub fn main() -> Unit {\n\treturn Unit\n}\n');
	await writeFile(join(root, 'src/math.spec.virune'), 'test "addition" {\n\texpect(1 + 1 == 2)\n}\n');
	const result = await runCli(['test', root]);
	const output = `${result.stdout}\n${result.stderr}`;
	assert.match(output, /addition/u);
	assert.match(output, /pass 1/u);
});

test('CLI formatter check detects and then fixes formatting', async () => {
	const root = await makeCliProject();
	await mkdir(join(root, 'src'), { recursive: true });
	const file = join(root, 'src/main.virune');
	await writeFile(file, 'pub fn main()->Unit {\nreturn Unit\n}\n');
	await assert.rejects(runCli(['fmt', '--check', root]));
	assert.match((await runCli(['fmt', root])).stdout, /Formatted/u);
	assert.match((await runCli(['fmt', '--check', root])).stdout, /Checked 1 file/u);
});

test('CLI bind generates type-checkable Virune FFI declarations from TypeScript declarations', async () => {
	const root = await makeCliProject();
	await mkdir(join(root, 'src/ffi'), { recursive: true });
	const declaration = join(root, 'example.d.ts');
	await writeFile(declaration, 'export interface User { readonly name: string; readonly nickname?: string }\nexport function parse(value: string): User;\nexport function load(id: number): Promise<User>;\n');
	const output = join(root, 'src/ffi/example.virune');
	assert.match((await runCli(['bind', declaration, '--out', output, '--module', 'example-lib'], root)).stdout, /Generated 2 function binding/u);
	const text = await readFile(output, 'utf8');
	assert.match(text, /pub record User/u);
	assert.match(text, /pub async fn load/u);
	const compiled = compileSource({ id: 1, path: output, text }, { emit: false });
	assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error'), []);
	assert.match((await runCli(['fmt', '--check', output], root)).stdout, /Checked 1 file/u);
});


test('CLI bind preserves generic data types and reports unsupported TypeScript constructs', async () => {
	const root = await makeCliProject();
	await mkdir(join(root, 'src/ffi'), { recursive: true });
	const declaration = join(root, 'generic.d.ts');
	await writeFile(declaration, 'export interface Box<T> { readonly value: T }\nexport function wrap<T>(value: T): Box<T>;\nexport type Recursive = { next?: Recursive };\n');
	const output = join(root, 'src/ffi/generic.virune');
	const result = await runCli(['bind', declaration, '--out', output, '--module', 'generic-lib'], root);
	assert.match(result.stdout, /Generated 1 function binding/u);
	const text = await readFile(output, 'utf8');
	assert.match(text, /pub record Box<T>/u);
	assert.match(text, /pub fn wrap<T>/u);
	assert.match(result.stdout, /Unknown fallback/u);
});
