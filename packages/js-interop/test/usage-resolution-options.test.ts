import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { JsInteropProvider } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('whole-usage member calls remain valid with noUnusedLocals enabled', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface Api { method(this: Api, value: "foo"): "member" }',
		'export declare const api: Api;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export const api = { method() { return "member"; } };\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { noUnusedLocals: true, noUnusedParameters: true } });
	const imported = provider.resolveImport({ containingFile: join(root, 'src/main.virune'), moduleSpecifier: './library.js', kind: 'named', importedName: 'api', platform: 'node' });
	assert.ok(imported.type);
	const method = provider.getProperty(imported.type.ref, 'method');
	assert.ok(method);
	const interopProvider: JsInteropProvider = provider;
	assert.ok(interopProvider.resolveCallUsage);
	const resolved = interopProvider.resolveCallUsage(method.ref, {
		target: { kind: 'member', receiver: imported.type.ref, property: 'method' },
		arguments: [{ kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'foo' } }],
	});
	assert.equal(resolved?.result.display, '"member"');
});
