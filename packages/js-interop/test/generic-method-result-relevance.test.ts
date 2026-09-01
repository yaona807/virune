import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function errorCodes(result: ReturnType<typeof compileSource>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('accepts an input-only generic method returning a concrete reference', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare class Emitter {',
		'  constructor();',
		'  select<T extends "active" | "idle">(event: T): Emitter;',
		'}',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export class Emitter {',
		'  select() { return this; }',
		'}',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { Emitter } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tlet emitter = Emitter()\n\tdiscard emitter.select("active")\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });

	assert.deepEqual(errorCodes(result), []);
	assert.equal(result.semantic?.interop.usages.filter(item => item.kind === 'call').length, 1);
});

test('still rejects an unresolved generic in an anonymous structural result', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function unresolved<T>(): { readonly value: T };\n', 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function unresolved() { return { value: undefined }; }\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 2,
		path: join(root, 'src/main.virune'),
		text: `import js { unresolved } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard unresolved()\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });

	assert.deepEqual(errorCodes(result), ['L4204']);
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'call'), false);
});

test('still rejects an unresolved generic inside a concrete reference type argument', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare class Box<T> { readonly value: T; }',
		'export declare function unresolvedBox<T>(): Box<T>;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function unresolvedBox() { return { value: undefined }; }\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 3,
		path: join(root, 'src/main.virune'),
		text: `import js { unresolvedBox } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard unresolvedBox()\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });

	assert.deepEqual(errorCodes(result), ['L4204']);
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'call'), false);
});
