import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	compileSource,
	type ForeignTypeSnapshot,
	type InteropArgumentType,
	type JsInteropProvider,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function resolveNamed(provider: TypeScriptInteropProvider, root: string, importedName: string): ForeignTypeSnapshot {
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: './library.js',
		kind: 'named',
		importedName,
		platform: 'node',
	});
	assert.ok(imported.type);
	return imported.type;
}

function literal(value: string): InteropArgumentType {
	return { kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value } };
}

function errors(result: ReturnType<typeof compileSource>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('resolves ordinary calls on dual callable/constructable values without construct fallback', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface Item { readonly value: string }',
		'export interface HybridFactory {',
		'  (value: "ok"): Item;',
		'  new (value: number): Item;',
		'}',
		'export declare const Hybrid: HybridFactory;',
		'export declare class ConstructOnly {',
		'  constructor(value: string);',
		'  readonly value: string;',
		'}',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export function Hybrid(value) { return { value: String(value) }; }',
		'export class ConstructOnly { constructor(value) { this.value = value; } }',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	assert.ok(interopProvider.resolveCallUsage);
	assert.ok(interopProvider.resolveConstructUsage);

	const hybrid = resolveNamed(provider, root, 'Hybrid');
	const acceptedCall = interopProvider.resolveCallUsage(hybrid.ref, {
		target: { kind: 'value' },
		arguments: [literal('ok')],
	});
	assert.ok(acceptedCall, 'the TypeScript call expression is valid even when the value is also constructable');
	assert.equal(acceptedCall.result.category, 'object');
	assert.equal(interopProvider.resolveCallUsage(hybrid.ref, {
		target: { kind: 'value' },
		arguments: [literal('bad')],
	}), undefined, 'invalid call arguments must remain rejected by the whole-usage probe');
	assert.equal(interopProvider.resolveConstructUsage(hybrid.ref, {
		target: { kind: 'value' },
		arguments: [{ kind: 'native-primitive', primitive: 'Int', literal: { kind: 'Int', value: 1 } }],
	}), undefined, 'a dual callable/constructable target must not be guessed into construction');

	const constructOnly = resolveNamed(provider, root, 'ConstructOnly');
	assert.equal(interopProvider.resolveCallUsage(constructOnly.ref, {
		target: { kind: 'value' },
		arguments: [literal('ok')],
	}), undefined);
	assert.ok(interopProvider.resolveConstructUsage(constructOnly.ref, {
		target: { kind: 'value' },
		arguments: [literal('ok')],
	}), 'construct-only resolution must remain available');

	const compiled = compileSource({
		id: 1,
		path: join(root, 'src/accepted.virune'),
		text: `import js { Hybrid } from "./library.js"\n\nfn useHybrid() -> Unit uses JavaScript {\n\tdiscard Hybrid("ok")\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) });
	assert.deepEqual(errors(compiled), []);

	const rejected = compileSource({
		id: 2,
		path: join(root, 'src/rejected.virune'),
		text: `import js { Hybrid } from "./library.js"\n\nfn useHybrid() -> Unit uses JavaScript {\n\tdiscard Hybrid("bad")\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) });
	assert.deepEqual(errors(rejected), ['L4204']);
});
