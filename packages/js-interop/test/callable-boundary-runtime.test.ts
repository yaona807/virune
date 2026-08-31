import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function projectRoot(): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	return mkdtemp(join(temporaryRoot, 'virune-interop-callable-runtime-'));
}

async function buildRuntimeFixture(source: string, declarations: string, librarySource: string) {
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
	await writeFile(join(root, 'src/main.virune'), source, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: true, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	return { root, result };
}

test('JavaScript can invoke a stored callback later through a fresh external-root boundary', async () => {
	const { root } = await buildRuntimeFixture(
		`import js { remember, invoke } from "./library.js"\n\nfn callback(value: String) -> String {\n\treturn value\n}\n\n@jsExport\npub fn rememberCallback() -> Unit uses JavaScript {\n\tdiscard remember(callback)\n\treturn Unit\n}\n\n@jsExport\npub fn invokeSaved(value: String) -> String uses JavaScript {\n\treturn invoke(value)\n}\n`,
		'export declare function remember(callback: (value: string) => string): void;\nexport declare function invoke(value: string): string;\n',
		'let saved;\nexport function remember(callback) { saved = callback; }\nexport function invoke(value) { return saved(value); }\n',
	);
	const output = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(output, /\$fn\(validateFfiValue\([\s\S]*?rootTaskContext\(\)\)/u);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=deferred-root`) as {
		rememberCallback(): void;
		invokeSaved(value: string): string;
	};
	module.rememberCallback();
	assert.equal(module.invokeSaved('later'), 'later');
});

test('on/off-style APIs receive the same generated shim for repeated projection', async () => {
	const { root } = await buildRuntimeFixture(
		`import js { on, off } from "./library.js"\n\nfn callback(value: String) -> String {\n\treturn value\n}\n\n@jsExport\npub fn registerThenRemove() -> Bool uses JavaScript {\n\tdiscard on(callback)\n\treturn off(callback)\n}\n`,
		'export declare function on(callback: (value: string) => string): void;\nexport declare function off(callback: (value: string) => string): boolean;\n',
		'let saved;\nexport function on(callback) { saved = callback; }\nexport function off(callback) { const same = saved === callback; if (same) saved = undefined; return same; }\n',
	);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=on-off-identity`) as { registerThenRemove(): boolean };
	assert.equal(module.registerThenRemove(), true);
});

test('callable helper is unaffected by user-shadowable JavaScript intrinsic names', async () => {
	const { root } = await buildRuntimeFixture(
		`import js { invoke } from "./library.js"\n\nfn Symbol() -> Unit {\n\treturn Unit\n}\n\nfn Object() -> Unit {\n\treturn Unit\n}\n\nfn TypeError() -> Unit {\n\treturn Unit\n}\n\nfn callback(value: String) -> String {\n\treturn value\n}\n\n@jsExport\npub fn run() -> String uses JavaScript {\n\treturn invoke(callback)\n}\n`,
		'export declare function invoke(callback: (value: string) => string): string;\n',
		'export function invoke(callback) { return callback("ok"); }\n',
	);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=intrinsic-shadowing`) as { run(): string };
	assert.equal(module.run(), 'ok');
});

test('invalid JavaScript callback arguments are rejected by the generated shim before native invocation', async () => {
	const { root } = await buildRuntimeFixture(
		`import js { invokeWrong } from "./library.js"\n\nfn callback(value: String) -> String {\n\treturn value\n}\n\n@jsExport\npub fn run() -> String uses JavaScript {\n\treturn invokeWrong(callback)\n}\n`,
		'export declare function invokeWrong(callback: (value: string) => string): string;\n',
		'export function invokeWrong(callback) { return callback(42); }\n',
	);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=inbound-validation`) as { run(): string };
	assert.throws(() => module.run(), (error: unknown) => {
		if (!(error instanceof TypeError)) return false;
		const contract = error as TypeError & { readonly path?: unknown };
		return error.name === 'ForeignContractError' && contract.path === '$[0]';
	});
});

test('sync panic crosses the callable boundary only as a sanitized JavaScript error', async () => {
	const { root } = await buildRuntimeFixture(
		`import js { invoke } from "./library.js"\n\nfn callback(value: String) -> String {\n\treturn panic("callback panic")\n}\n\n@jsExport\npub fn run() -> String uses JavaScript {\n\treturn invoke(callback)\n}\n`,
		'export declare function invoke(callback: (value: string) => string): string;\n',
		'export function invoke(callback) { return callback("value"); }\n',
	);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=sync-panic`) as { run(): string };
	assert.throws(() => module.run(), (error: unknown) => error instanceof Error && error.name === 'Error' && error.message === 'Virune callback failed: callback panic' && !('code' in error));
});

test('async callback panic remains a sanitized rejected promise across the JavaScript boundary', async () => {
	const { root } = await buildRuntimeFixture(
		`import js { invokeAsync } from "./library.js"\n\nasync fn callback(value: String) -> String {\n\treturn panic("async callback panic")\n}\n\n@jsExport\npub async fn runAsync() -> String uses JavaScript {\n\treturn await invokeAsync(callback)\n}\n`,
		'export declare function invokeAsync(callback: (value: string) => Promise<string>): Promise<string>;\n',
		'export async function invokeAsync(callback) { return await callback("value"); }\n',
	);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=async-panic`) as { runAsync(): Promise<string> };
	await assert.rejects(module.runAsync(), (error: unknown) => error instanceof Error && error.name === 'Error' && error.message === 'Virune callback failed: async callback panic' && !('code' in error));
});