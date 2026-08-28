import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject, IncrementalProjectBuilder } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function projectRoot(): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	return mkdtemp(join(temporaryRoot, 'virune-interop-callable-'));
}

test('preserves one native callable identity through Virune import and re-export chains', async () => {
	const root = await projectRoot();
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: false,
		sourcesContent: false,
	}), 'utf8');
	await writeFile(join(root, 'src/callback.virune'), `pub fn callback(value: Float) -> Float {\n\treturn value\n}\n`, 'utf8');
	await writeFile(join(root, 'src/reexport.virune'), 'pub import { callback } from "./callback.virune"\n', 'utf8');
	await writeFile(join(root, 'src/remember.virune'), `import { callback } from "./reexport.virune"\nimport js { remember } from "./library.js"\n\npub fn rememberCallback() -> Unit uses JavaScript {\n\tdiscard remember(callback)\n\treturn Unit\n}\n`, 'utf8');
	await writeFile(join(root, 'src/compare.virune'), `import { callback } from "./reexport.virune"\nimport js { isSame } from "./library.js"\n\npub fn sameCallback() -> Bool uses JavaScript {\n\treturn isSame(callback)\n}\n`, 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import { rememberCallback } from "./remember.virune"\nimport { sameCallback } from "./compare.virune"\n\n@jsExport\npub fn checkIdentity() -> Bool uses JavaScript {\n\trememberCallback()\n\treturn sameCallback()\n}\n`, 'utf8');
	const librarySource = 'let saved;\nexport function remember(callback) { saved = callback; }\nexport function isSame(callback) { return saved === callback; }\n';
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function remember(callback: (value: number) => number): void;\nexport declare function isSame(callback: (value: number) => number): boolean;\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: true, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const rememberOutput = await readFile(join(root, 'dist/remember.js'), 'utf8');
	const compareOutput = await readFile(join(root, 'dist/compare.js'), 'utf8');
	assert.match(rememberOutput, /\$virune\.callable-shim\.cache\/v1/u);
	assert.match(compareOutput, /\$virune\.callable-shim\.cache\/v1/u);
	await mkdir(join(root, 'dist'), { recursive: true });
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?identity=callable-boundary`) as { checkIdentity(): boolean };
	assert.equal(module.checkIdentity(), true);
});

test('imported generic callable specialization remains fail closed without retroactive dependency emission', async () => {
	const root = await projectRoot();
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: false,
		sourcesContent: false,
	}), 'utf8');
	await writeFile(join(root, 'src/generic.virune'), `pub fn identity<T>(value: T) -> T {\n\treturn value\n}\n`, 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import { identity } from "./generic.virune"\nimport js { consume } from "./library.js"\n\npub fn main() -> Unit uses JavaScript {\n\tdiscard consume(identity)\n\treturn Unit\n}\n`, 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function consume(callback) { callback(1); }\n', 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function consume(callback: (value: number) => number): void;\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: false, jsInteropProvider: provider });
	assert.ok(result.diagnostics.some(item => item.code === 'L4204' || item.code === 'L4206'));
	const mainModule = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.equal(mainModule?.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('imported jsExport wrappers remain fail closed and invalidate incremental consumers', async () => {
	const root = await projectRoot();
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: false,
		sourcesContent: false,
	}), 'utf8');
	const callbackPath = join(root, 'src/callback.virune');
	await writeFile(callbackPath, `pub fn callback(value: Float) -> Float {\n\treturn value\n}\n`, 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import { callback } from "./callback.virune"\nimport js { consume } from "./library.js"\n\npub fn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`, 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function consume(callback) { callback(1); }\n', 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function consume(callback: (value: number) => number): void;\n', 'utf8');

	const builder = new IncrementalProjectBuilder();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const initial = await builder.build(root, { write: false, jsInteropProvider: provider });
	assert.deepEqual(initial.diagnostics.filter(item => item.severity === 'error'), []);
	const initialMain = initial.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.equal(initialMain?.semantic?.interop.callableProjections?.length, 1);

	await writeFile(callbackPath, `@jsExport\npub fn callback(value: Float) -> Float {\n\treturn value\n}\n`, 'utf8');
	const changed = await builder.build(root, { write: false, jsInteropProvider: provider });
	assert.ok(changed.diagnostics.some(item => item.code === 'L4204'));
	const changedMain = changed.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.equal(changedMain?.semantic?.interop.callableProjections?.length ?? 0, 0);
});
