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
		'  readonly parentNode: Container | null;',
		'  readonly firstChild: Container | null;',
		'  readonly childNodes: ArrayLike<Container>;',
		'  contains(other: Container | null): boolean;',
		'  insertBefore(node: Container, child: Container | null): Container;',
		'  appendChild(node: Container): Container;',
		'  removeChild(child: Container): Container;',
		'}',
		'export interface ConcreteContainer {',
		'  readonly nodeType: number;',
		'  readonly parentNode: ConcreteContainer | null;',
		'  readonly firstChild: ConcreteContainer | null;',
		'  readonly childNodes: ConcreteContainer[];',
		'  contains(other: Container | null): boolean;',
		'  insertBefore<T extends Container>(node: T, child: Container | null): T;',
		'  appendChild<T extends Container>(node: T): T;',
		'  removeChild<T extends Container>(child: T): T;',
		'  readonly unrelated: any;',
		'  generic<T>(value: T): T;',
		'}',
		'export interface StrictLeaf { value: string }',
		'export interface StrictBranchA { nested: StrictLeaf; optional?: number }',
		'export interface StrictBranchB { nested: StrictLeaf }',
		'export declare function makeChild(): ChildObject;',
		'export declare function makeContainer(): ConcreteContainer;',
		'export declare function render(value: Child, parent: Container): void;',
		'export declare function render(value: Child, parent: Container, replace?: object): void;',
		'export declare const unsafeTop: any;',
		'export declare const unsafeArray: Array<any>;',
		'export declare function takeStrings(value: string[]): void;',
		'export declare function makeUnsafeField(): { value: any; unrelated: string };',
		'export declare function takeSafeField(value: { value: string }): void;',
		'export declare function makeUnsafeNested(): { nested: { value: any } };',
		'export declare function takeStrictUnion(value: StrictBranchA | StrictBranchB): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export function makeChild() { return { id: "child", unrelated: undefined }; }',
		'export function makeContainer() {',
		'  return {',
		'    nodeType: 1, parentNode: null, firstChild: null, childNodes: [], unrelated: undefined,',
		'    contains() { return false; },',
		'    insertBefore(node) { return node; }, appendChild(node) { return node; }, removeChild(node) { return node; },',
		'    generic(value) { return value; },',
		'  };',
		'}',
		'export function render() {}',
		'export const unsafeTop = ["not-proven"];',
		'export const unsafeArray = [1];',
		'export function takeStrings() {}',
		'export function makeUnsafeField() { return { value: 1, unrelated: "x" }; }',
		'export function takeSafeField() {}',
		'export function makeUnsafeNested() { return { nested: { value: 1 } }; }',
		'export function takeStrictUnion() {}',
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
	]), 'recursive structural members and unrelated permissive/generic source members must not block a TypeScript-proven call');

	const takeStrings = resolveNamed(provider, root, 'takeStrings');
	const unsafeTop = resolveNamed(provider, root, 'unsafeTop');
	const unsafeArray = resolveNamed(provider, root, 'unsafeArray');
	assert.equal(call(interopProvider, takeStrings, [{ kind: 'foreign', type: unsafeTop.ref }]), undefined, 'top-level any must not prove a specific parameter');
	assert.equal(call(interopProvider, takeStrings, [{ kind: 'foreign', type: unsafeArray.ref }]), undefined, 'any in an assignment-relevant generic argument must remain fail-closed');

	const unsafeField = call(interopProvider, resolveNamed(provider, root, 'makeUnsafeField'), []);
	assert.ok(unsafeField);
	const takeSafeField = resolveNamed(provider, root, 'takeSafeField');
	assert.equal(call(interopProvider, takeSafeField, [{ kind: 'foreign', type: unsafeField.result.ref }]), undefined, 'any in an assignment-relevant structural property must remain fail-closed');

	const unsafeNested = call(interopProvider, resolveNamed(provider, root, 'makeUnsafeNested'), []);
	assert.ok(unsafeNested);
	const takeStrictUnion = resolveNamed(provider, root, 'takeStrictUnion');
	assert.equal(call(interopProvider, takeStrictUnion, [{ kind: 'foreign', type: unsafeNested.result.ref }]), undefined, 'a failed union candidate must not leak recursive any-safety evidence into the next candidate');
});

test('allows a DOM element to satisfy a smaller recursive structural container contract', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface RenderContainer {',
		'  readonly nodeType: number;',
		'  readonly parentNode: RenderContainer | null;',
		'  readonly firstChild: RenderContainer | null;',
		'  readonly childNodes: ArrayLike<RenderContainer>;',
		'  contains(other: RenderContainer | null): boolean;',
		'  insertBefore(node: RenderContainer, child: RenderContainer | null): RenderContainer;',
		'  appendChild(node: RenderContainer): RenderContainer;',
		'  removeChild(child: RenderContainer): RenderContainer;',
		'}',
		'export declare function makeValue(): { readonly id: string };',
		'export declare function makeDomContainer(): HTMLDivElement;',
		'export declare function render(value: object | string | null | undefined, parent: RenderContainer): void;',
		'export declare function render(value: object | string | null | undefined, parent: RenderContainer, replace?: Element | Text): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export function makeValue() { return { id: "value" }; }',
		'export function makeDomContainer() { return {}; }',
		'export function render() {}',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	const value = call(interopProvider, resolveNamed(provider, root, 'makeValue'), []);
	const container = call(interopProvider, resolveNamed(provider, root, 'makeDomContainer'), []);
	assert.ok(value);
	assert.ok(container);

	const render = resolveNamed(provider, root, 'render');
	assert.ok(call(interopProvider, render, [
		{ kind: 'foreign', type: value.result.ref },
		{ kind: 'foreign', type: container.result.ref },
	]), 'a TypeScript-proven HTML element to recursive structural container assignment must remain valid despite unrelated DOM members');
});
