import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function projectRoot(): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	return mkdtemp(join(temporaryRoot, 'virune-interop-contextual-'));
}

async function writeProject(root: string, source: string, librarySource: string, declarations: string): Promise<void> {
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
	await writeFile(join(root, 'src/main.virune'), source, 'utf8');
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
}

test('contextual External object/index/write/construct operations execute with JavaScript semantics', async () => {
	const root = await projectRoot();
	const librarySource = `
export function acceptConfig(config) {
	return config.mode === 'strict'
		&& config.nested.count === 3
		&& Object.getPrototypeOf(config) === Object.prototype
		&& Object.hasOwn(config, '__proto__')
		&& config.__proto__ === 'safe';
}
export function acceptCallback(config) { return config.transform(2) === 4; }
export const buckets = {
	key: {
		prefix: 'P',
		join(value) { return this.prefix + value; },
	},
};
export const writable = { name: 'old' };
export function readWrites() { return writable.name + ':' + writable.extra; }
export class Box { constructor(value) { this.value = value; } }
`;
	const declarations = `
export declare function acceptConfig(config: { mode: 'strict'; nested: { count: 3 }; __proto__: string }): boolean;
export declare function acceptCallback(config: { transform: (value: number) => number }): boolean;
export declare const buckets: Record<string, { prefix: string; join(value: string): string }>;
export declare const writable: { name: string; [key: string]: string };
export declare function readWrites(): string;
export declare class Box<T> { constructor(value: T); readonly value: T; }
`;
	const source = `import js { acceptConfig, acceptCallback, buckets, writable, readWrites, Box } from "./library.js"

fn double(value: Float) -> Float {
	return value * 2.0
}

@jsExport
pub fn objectOk() -> Bool uses JavaScript {
	return acceptConfig({ mode: "strict", nested: { count: 3 }, __proto__: "safe" })
}

@jsExport
pub fn callbackOk() -> Bool uses JavaScript {
	return acceptCallback({ transform: double })
}

@jsExport
pub fn indexedReceiver() -> String uses JavaScript {
	return buckets["key"].join("x")
}

@jsExport
pub fn writeAndRead() -> String uses JavaScript {
	writable.name = "changed"
	writable["extra"] = "ok"
	return readWrites()
}

@jsExport
pub fn constructValue() -> Float uses JavaScript {
	return Box(3.5).value
}
`;
	await writeProject(root, source, librarySource, declarations);

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: true, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const mainModule = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(mainModule?.semantic);
	const usageKinds = mainModule.semantic.interop.usageIR.map(item => item.kind);
	assert.ok(usageKinds.includes('object'));
	assert.ok(usageKinds.includes('index'));
	assert.ok(usageKinds.includes('write-property'));
	assert.ok(usageKinds.includes('write-index'));
	assert.ok(usageKinds.includes('construct'));
	assert.equal(mainModule.semantic.interop.objectCallableProjections?.length, 1);

	await mkdir(join(root, 'dist'), { recursive: true });
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?contextual-operations`) as {
		objectOk(): boolean;
		callbackOk(): boolean;
		indexedReceiver(): string;
		writeAndRead(): string;
		constructValue(): number;
	};
	assert.equal(module.objectOk(), true);
	assert.equal(module.callbackOk(), true);
	assert.equal(module.indexedReceiver(), 'Px');
	assert.equal(module.writeAndRead(), 'changed:ok');
	assert.equal(module.constructValue(), 3.5);
});
