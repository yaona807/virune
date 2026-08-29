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

test('TypeScript void cannot discard an async native callback result', async () => {
	const result = await compileCase(
		'export declare function consume(callback: () => void): void;\n',
		`import js { consume } from "./library.js"\n\nasync fn value() -> String {\n\treturn "not detached"\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(value)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('TypeScript Promise<void> accepts an async native Unit callback without changing async semantics', async () => {
	const result = await compileCase(
		'export declare function consume(callback: () => Promise<void>): void;\n',
		`import js { consume } from "./library.js"\n\nasync fn done() -> Unit {\n\treturn Unit\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(done)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.equal(projection.descriptor.async, true);
	assert.equal(projection.descriptor.result, 'Unit');
	assert.match(result.output?.code ?? '', /async \(\) => \{ return encodeFfiValue\(await \$fn\(rootTaskContext\(\)\), \{ kind: 'undefined' \}\); \}/u);
});
