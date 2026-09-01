import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileCase(declarations: string, source: string) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function run(...args) { return args.at(-1)?.() ?? undefined; }\nexport const on = run;\nexport const add = run;\nexport const consume = run;\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: provider });
}

function errors(result: Awaited<ReturnType<typeof compileCase>>) {
	return result.diagnostics.filter(item => item.severity === 'error');
}

test('zero-argument async native callback may ignore an external-only structural argument', async () => {
	const result = await compileCase(
		'export declare function run(task: (options: { readonly signal: unknown }) => Promise<string>): Promise<string>;\n',
		`import js { run } from "./library.js"\n\nasync fn worker() -> String {\n\treturn "ok"\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard run(worker)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(errors(result), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.deepEqual(projection.descriptor.parameters, []);
	assert.equal(projection.descriptor.result, 'String');
	assert.equal(projection.descriptor.async, true);
	assert.match(result.output?.code ?? '', /async \(\) => \{/u);
});

test('zero-argument Unit callback may ignore variadic any event arguments', async () => {
	const result = await compileCase(
		'export declare function on(event: "active", fn: (...args: any[]) => void): void;\n',
		`import js { on } from "./library.js"\n\nfn handler() -> Unit {\n\treturn Unit\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard on("active", handler)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(errors(result), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.deepEqual(projection.descriptor.parameters, []);
	assert.equal(projection.descriptor.result, 'Unit');
	assert.equal(projection.descriptor.async, false);
});

test('callback-result-only generic inference remains delegated to TypeScript', async () => {
	const result = await compileCase(
		[
			'export type Task<T> =',
			'  | ((options: { readonly signal: unknown }) => PromiseLike<T>)',
			'  | ((options: { readonly signal: unknown }) => T);',
			'export declare function add<T>(task: Task<T>): Promise<T>;',
			'',
		].join('\n'),
		`import js { add } from "./library.js"\n\nasync fn worker() -> String {\n\treturn "ok"\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard add(worker)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(errors(result), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.deepEqual(projection.descriptor.parameters, []);
	assert.equal(projection.descriptor.result, 'String');
	assert.equal(projection.descriptor.async, true);
});

test('consumed any parameter remains fail-closed even when TypeScript accepts it', async () => {
	const result = await compileCase(
		'export declare function consume(fn: (value: any) => void): void;\n',
		`import js { consume } from "./library.js"\n\nfn handler(value: String) -> Unit {\n\tdiscard value\n\treturn Unit\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(handler)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('TypeScript void still cannot discard an async native callback result when target arguments are ignored', async () => {
	const result = await compileCase(
		'export declare function consume(fn: (value: { readonly opaque: unknown }) => void): void;\n',
		`import js { consume } from "./library.js"\n\nasync fn handler() -> String {\n\treturn "not detached"\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(handler)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});
