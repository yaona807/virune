import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('resolves Node standard module declarations in node projects', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({ containingFile: join(root, 'src/main.virune'), moduleSpecifier: 'node:path', kind: 'named', importedName: 'join', platform: 'node' });
	assert.equal(imported.type?.category, 'function');
});

test('bridges TypeScript unknown to Virune Unknown without trusting any', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function parse(value: unknown): unknown;\nexport declare const unsafeValue: any;\n', 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function parse(value) { return value; }\nexport const unsafeValue = 1;\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const safe = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { parse } from "./library.js"\n\nfn roundTrip(value: Unknown) -> Unknown uses JavaScript {\n\treturn parse(value)\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(safe.diagnostics.filter(item => item.severity === 'error'), []);
	const unsafe = compileSource({
		id: 2,
		path: join(root, 'src/unsafe.virune'),
		text: `import js { unsafeValue } from "./library.js"\n`,
	}, { emit: false, platform: 'node', jsInteropProvider: provider });
	assert.ok(unsafe.diagnostics.some(item => item.code === 'L4212'));
});
