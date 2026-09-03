import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
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

test('allows structural External widening only when permissive source members are assignment-irrelevant', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface ChildObject {',
		'  readonly id: string;',
		'  readonly unrelated: any;',
		'}',
		'export type Child = object | string | null | undefined;',
		'export interface Container {',
		'  readonly nodeType: number;',
		'  appendChild(node: Container): Container;',
		'}',
		'export interface ConcreteContainer extends Container {',
		'  readonly unrelated: any;',
		'  generic<T>(value: T): T;',
		'}',
		'export declare function makeChild(): ChildObject;',
		'export declare function makeContainer(): ConcreteContainer;',
		'export declare function render(value: Child, parent: Container): void;',
		'export declare function render(value: Child, parent: Container, replace?: object): void;',
		'export declare const unsafeTop: any;',
		'export declare const unsafeArray: Array<any>;',
		'export declare function takeStrings(value: string[]): void;',
		'export declare function makeUnsafeField(): { value: any; unrelated: string };',
		'export declare function takeSafeField(value: { value: string }): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export function makeChild() { return { id: "child", unrelated: undefined }; }',
		'export function makeContainer() {',
		'  return { nodeType: 1, unrelated: undefined, appendChild(node) { return node; }, generic(value) { return value; } };',
		'}',
		'export function render() {}',
		'export const unsafeTop = ["not-proven"];',
		'export const unsafeArray = [1];',
		'export function takeStrings() {}',
		'export function makeUnsafeField() { return { value: 1, unrelated: "x" }; }',
		'export function takeSafeField() {}',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	const child = call(interopProvider, resolveNamed(provider, root, 'makeChild'), []);
	const container = call(interopProvider, resolveNamed(provider, root, 'makeContainer'), []);
	assert.ok(child);
	assert.ok(container);

	const render = resolveNamed(provider, root, 'render');
	assert.ok(call(interopProvider, render, [
		{ kind: 'foreign', type: child.result.ref },
		{ kind: 'foreign', type: container.result.ref },
	]), 'unrelated permissive and generic source members must not block a TypeScript-proven structural call');

	const takeStrings = resolveNamed(provider, root, 'takeStrings');
	const unsafeTop = resolveNamed(provider, root, 'unsafeTop');
	const unsafeArray = resolveNamed(provider, root, 'unsafeArray');
	assert.equal(call(interopProvider, takeStrings, [{ kind: 'foreign', type: unsafeTop.ref }]), undefined, 'top-level any must not prove a specific parameter');
	assert.equal(call(interopProvider, takeStrings, [{ kind: 'foreign', type: unsafeArray.ref }]), undefined, 'any in an assignment-relevant generic argument must remain fail-closed');

	const unsafeField = call(interopProvider, resolveNamed(provider, root, 'makeUnsafeField'), []);
	assert.ok(unsafeField);
	const takeSafeField = resolveNamed(provider, root, 'takeSafeField');
	assert.equal(call(interopProvider, takeSafeField, [{ kind: 'foreign', type: unsafeField.result.ref }]), undefined, 'any in an assignment-relevant structural property must remain fail-closed');
});
