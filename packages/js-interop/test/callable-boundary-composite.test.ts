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
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: provider });
}

test('native List callback parameter does not gain a raw JavaScript array projection', async () => {
	const result = await compileCase(
		'export declare function consume(callback: (values: string[]) => string): void;\n',
		`import js { consume } from "./library.js"\n\nfn callback(values: List<String>) -> String {\n\treturn "ok"\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204' || item.code === 'L4206'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('native List callback result does not gain a raw JavaScript array projection', async () => {
	const result = await compileCase(
		'export declare function consume(callback: (value: string) => string[]): void;\n',
		`import js { consume } from "./library.js"\n\nfn callback(value: String) -> List<String> {\n\treturn [value]\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204' || item.code === 'L4206'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('native FileHandle resource cannot be smuggled through a callback typed with TypeScript unknown', async () => {
	const result = await compileCase(
		'export declare function consume(callback: (value: unknown) => unknown): void;\n',
		`import js { consume } from "./library.js"\n\nfn callback(value: FileHandle) -> FileHandle {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4206'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});
