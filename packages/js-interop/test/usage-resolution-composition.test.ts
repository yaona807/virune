import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('compiler rematerializes a foreign call result for a later whole-usage call', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface Item { value: string }',
		'export declare function makeItem(): Item;',
		'export declare function acceptItem(value: Item): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export function makeItem() { return { value: "value" }; }',
		'export function acceptItem() {}',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/composition.virune'),
		text: `import js { makeItem, acceptItem } from "./library.js"\n\nfn use() -> Unit uses JavaScript {\n\tdiscard acceptItem(makeItem())\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error').map(item => item.code), []);
});
