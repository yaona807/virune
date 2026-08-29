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

test('TypeScript number cannot be projected into a Virune Int callback parameter', async () => {
	const result = await compileCase(
		'export declare function consume(callback: (value: number) => number): void;\n',
		`import js { consume } from "./library.js"\n\nfn callback(value: Int) -> Int {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204' || item.code === 'L4206'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('Virune Int callback result can be safely projected to TypeScript number', async () => {
	const result = await compileCase(
		'export declare function consume(callback: () => number): void;\n',
		`import js { consume } from "./library.js"\n\nfn callback() -> Int {\n\treturn 1\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.equal(projection.descriptor.result, 'Int');
	assert.match(result.output?.code ?? '', /encodeFfiValue\([\s\S]*?\{ kind: 'int' \}\)/u);
});
