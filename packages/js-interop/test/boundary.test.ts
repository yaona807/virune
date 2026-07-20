import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('rejects JavaScript re-exports and foreign types in public Virune APIs', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'export interface Handle { readonly value: string }\nexport declare function greet(name: string): string;\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `pub import js { greet } from "./library.js"\nimport js type { Handle } from "./library.js"\n\npub fn expose(value: Handle) -> Unit {\n\treturn Unit\n}\n`,
	}, { emit: false, platform: 'node', jsInteropProvider: provider });
	const codes = result.diagnostics.map(item => item.code);
	assert.ok(codes.includes('L4207'), `Expected L4207, received: ${codes.join(', ')}`);
	assert.ok(codes.includes('L4209'), `Expected L4209, received: ${codes.join(', ')}`);
});

test('rejects direct TypeScript runtime imports outside interop adapters', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/direct.ts'), 'export function value(): string { return "x" }\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({ id: 1, path: join(root, 'src/main.virune'), text: `import js { value } from "./direct.ts"\n` }, { emit: false, platform: 'node', jsInteropProvider: provider });
	assert.ok(result.diagnostics.some(item => item.code === 'L4210'));
});
