import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

const indexUsage = { index: { kind: 'native-primitive', primitive: 'Int' } } as const;

test('Array and ReadonlyArray provide stable indexed repetition evidence', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare const mutableValues: string[];',
		'export declare const readonlyValues: ReadonlyArray<string>;',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	for (const importedName of ['mutableValues', 'readonlyValues']) {
		const imported = provider.resolveImport({
			containingFile: join(root, 'src/main.virune'),
			moduleSpecifier: './library.js',
			kind: 'named',
			importedName,
			platform: 'node',
		});
		assert.equal(imported.type?.category, 'array', importedName);
		assert.ok(imported.type);
		const indexed = provider.resolveIndexUsage?.(imported.type.ref, indexUsage);
		assert.equal(indexed?.result.category, 'primitive', importedName);
		assert.equal(indexed?.result.primitive, 'string', importedName);
	}
});
