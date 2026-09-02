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

function call(provider: JsInteropProvider, callee: ForeignTypeSnapshot, argumentsList: readonly InteropArgumentType[]) {
	assert.ok(provider.resolveCallUsage);
	return provider.resolveCallUsage(callee.ref, { target: { kind: 'value' }, arguments: argumentsList });
}

function errors(result: ReturnType<typeof compileSource>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('preserves exact External argument types without trusting permissive members', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface ExternalItem {',
		'  readonly id: string;',
		'  readonly permissive: any;',
		'}',
		'export interface OtherItem { readonly id: number }',
		'export declare const anyValue: any;',
		'export declare function makeItem(): ExternalItem;',
		'export declare function makeOther(): OtherItem;',
		'export declare function takeItem(value: ExternalItem): void;',
		'export declare function wrap<T extends Record<string, ExternalItem>>(value: T): T;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export const anyValue = { id: "unsafe" };',
		'export function makeItem() { return { id: "ok", permissive: undefined }; }',
		'export function makeOther() { return { id: 1 }; }',
		'export function takeItem() {}',
		'export function wrap(value) { return value; }',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	const makeItem = resolveNamed(provider, root, 'makeItem');
	const takeItem = resolveNamed(provider, root, 'takeItem');
	const wrap = resolveNamed(provider, root, 'wrap');
	const item = call(interopProvider, makeItem, []);
	assert.ok(item);

	assert.ok(call(interopProvider, takeItem, [{ kind: 'foreign', type: item.result.ref }]), 'a concrete External value must retain its exact TypeScript type when passed through');
	assert.ok(call(interopProvider, wrap, [{
		kind: 'contextual-object',
		object: { entries: [{ property: 'item', value: { kind: 'foreign', type: item.result.ref } }] },
	}]), 'the same External value must retain its exact type inside a contextual object');

	const permissive = provider.getProperty(item.result.ref, 'permissive');
	assert.ok(permissive);
	assert.equal(call(interopProvider, takeItem, [{ kind: 'foreign', type: permissive.ref }]), undefined, 'an actually accessed any member must not become a specific safe External value');

	const anyValue = resolveNamed(provider, root, 'anyValue');
	assert.equal(call(interopProvider, takeItem, [{ kind: 'foreign', type: anyValue.ref }]), undefined, 'top-level any must remain fail-closed for a specific parameter');

	const makeOther = resolveNamed(provider, root, 'makeOther');
	const other = call(interopProvider, makeOther, []);
	assert.ok(other);
	assert.equal(call(interopProvider, takeItem, [{ kind: 'foreign', type: other.result.ref }]), undefined, 'TypeScript must still reject an incompatible concrete External type');

	const otherProvider = new TypeScriptInteropProvider({ projectRoot: root, providerId: 'other-typescript' });
	const otherItem = call(otherProvider, resolveNamed(otherProvider, root, 'makeItem'), []);
	assert.ok(otherItem);
	assert.equal(call(interopProvider, takeItem, [{ kind: 'foreign', type: otherItem.result.ref }]), undefined, 'provider-mismatched evidence must remain fail-closed');

	const compiled = compileSource({
		id: 1,
		path: join(root, 'src/accepted.virune'),
		text: `import js { makeItem, takeItem, wrap } from "./library.js"\n\nfn useItem() -> Unit uses JavaScript {\n\tlet item = makeItem()\n\tdiscard takeItem(item)\n\tdiscard wrap({ item: item })\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) });
	assert.deepEqual(errors(compiled), []);
});
