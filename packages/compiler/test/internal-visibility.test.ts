import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject } from '../src/project/project.js';

const config = JSON.stringify({
	languageVersion: '1.0',
	platform: 'node',
	sourceDir: 'src',
	outDir: 'dist',
	entry: 'src/main.virune',
	target: 'es2022',
	sourceMap: true,
	sourcesContent: true,
});

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
	await mkdir(resolve('.cache'), { recursive: true });
	const root = await mkdtemp(join(resolve('.cache'), 'internal-visibility-'));
	try {
		await mkdir(join(root, 'src'), { recursive: true });
		await writeFile(join(root, 'virune.json'), config, 'utf8');
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function errorCodes(result: Awaited<ReturnType<typeof buildProject>>): readonly string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('same-project modules can import and execute an internal runtime binding', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), 'internal fn add(value: Int) -> Int => value + 1\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), 'import { add } from "./helper.virune"\n\n@jsExport\npub fn run() -> Int {\n\treturn add(41)\n}\n', 'utf8');
		const result = await buildProject(root, { write: true });
		assert.deepEqual(errorCodes(result), []);
		const helper = result.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'));
		assert.match(helper?.output?.code ?? '', /export function add\(/u);
		const loaded = await import(pathToFileURL(join(root, 'dist/main.js')).href) as { run(): number };
		assert.equal(loaded.run(), 42);
	});
});

test('private declarations remain unavailable to sibling modules', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), 'fn secret() -> Int => 7\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), 'import { secret } from "./helper.virune"\n\npub fn run() -> Int {\n\treturn secret()\n}\n', 'utf8');
		const result = await buildProject(root, { write: false });
		assert.ok(errorCodes(result).includes('L4004'));
	});
});

test('pub import cannot promote an internal declaration', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), 'internal fn secret() -> Int => 7\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), 'pub import { secret } from "./helper.virune"\n', 'utf8');
		const result = await buildProject(root, { write: false });
		assert.ok(errorCodes(result).includes('L4018'));
	});
});

test('signature visibility rejects lower-visibility nominal types', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/main.virune'), [
			'record Private {}',
			'internal record Internal {}',
			'pub record Public {}',
			'',
			'pub fn publicLeak(value: Internal) -> Unit {',
			'\treturn Unit',
			'}',
			'',
			'internal fn internalLeak(value: Private) -> Unit {',
			'\treturn Unit',
			'}',
			'',
			'internal fn valid(first: Internal, second: Public) -> Unit {',
			'\treturn Unit',
			'}',
			'',
		].join('\n'), 'utf8');
		const result = await buildProject(root, { write: false });
		const visibilityErrors = result.diagnostics.filter(item => item.code === 'L4010');
		assert.deepEqual(visibilityErrors.map(item => item.message).sort(), [
			'Internal declaration internalLeak exposes private type Private',
			'Public declaration publicLeak exposes internal type Internal',
		]);
	});
});

test('dependency internal declarations stay hidden from the package consumer', async () => {
	await withProject(async root => {
		const packageRoot = join(root, 'node_modules/example-internal');
		await mkdir(join(packageRoot, 'src'), { recursive: true });
		await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'example-internal', virune: 'src/index.virune' }), 'utf8');
		await writeFile(join(packageRoot, 'src/index.virune'), 'internal fn secret() -> Int => 7\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), 'import { secret } from "example-internal"\n\npub fn run() -> Int {\n\treturn secret()\n}\n', 'utf8');
		const result = await buildProject(root, { write: false });
		assert.ok(errorCodes(result).includes('L4004'));
	});
});

test('installed package modules can use their own internal declarations', async () => {
	await withProject(async root => {
		const packageRoot = join(root, 'node_modules/example-internal');
		await mkdir(join(packageRoot, 'src'), { recursive: true });
		await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name: 'example-internal', virune: 'src/index.virune' }), 'utf8');
		await writeFile(join(packageRoot, 'src/helper.virune'), 'internal fn increment(value: Int) -> Int => value + 1\n', 'utf8');
		await writeFile(join(packageRoot, 'src/index.virune'), 'import { increment } from "./helper.virune"\n\npub fn answer() -> Int {\n\treturn increment(41)\n}\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), 'import { answer } from "example-internal"\n\npub fn run() -> Int {\n\treturn answer()\n}\n', 'utf8');
		const result = await buildProject(root, { write: false });
		assert.deepEqual(errorCodes(result), []);
	});
});

test('internal import syntax is rejected instead of becoming a normal import', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), 'pub fn value() -> Int => 1\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), 'internal import { value } from "./helper.virune"\n', 'utf8');
		const result = await buildProject(root, { write: false });
		assert.ok(errorCodes(result).includes('L4019'));
	});
});

test('@jsExport remains restricted to published public functions', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/main.virune'), '@jsExport\ninternal fn exposed() -> Int => 1\n', 'utf8');
		const result = await buildProject(root, { write: false });
		assert.ok(errorCodes(result).includes('L2053'));
	});
});
