import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { ForeignTypeSnapshot, JsInteropProvider } from '@virune/compiler/experimental';
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

function call(provider: JsInteropProvider, callee: ForeignTypeSnapshot, argument: ForeignTypeSnapshot) {
	assert.ok(provider.resolveCallUsage);
	return provider.resolveCallUsage(callee.ref, {
		target: { kind: 'value' },
		arguments: [{ kind: 'foreign', type: argument.ref }],
	});
}

test('nested TypeScript any cannot become proof of a specific foreign argument type', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface LooseItem { value: any }',
		'export interface DeepLooseItem { nested: { value: any } }',
		'export declare const looseItem: LooseItem;',
		'export declare const deepLooseItem: DeepLooseItem;',
		'export declare const looseArray: any[];',
		'export declare function acceptStrict(value: { value: string }): void;',
		'export declare function acceptDeepStrict(value: { nested: { value: string } }): void;',
		'export declare function acceptStringArray(value: string[]): void;',
		'export declare function acceptUnknown(value: unknown): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export const looseItem = { value: "value" };',
		'export const deepLooseItem = { nested: { value: "value" } };',
		'export const looseArray = ["value"];',
		'export function acceptStrict() {}',
		'export function acceptDeepStrict() {}',
		'export function acceptStringArray() {}',
		'export function acceptUnknown() {}',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	const looseItem = resolveNamed(provider, root, 'looseItem');
	const deepLooseItem = resolveNamed(provider, root, 'deepLooseItem');
	const looseArray = resolveNamed(provider, root, 'looseArray');

	assert.equal(call(interopProvider, resolveNamed(provider, root, 'acceptStrict'), looseItem), undefined);
	assert.equal(call(interopProvider, resolveNamed(provider, root, 'acceptDeepStrict'), deepLooseItem), undefined);
	assert.equal(call(interopProvider, resolveNamed(provider, root, 'acceptStringArray'), looseArray), undefined);
	assert.ok(call(interopProvider, resolveNamed(provider, root, 'acceptUnknown'), looseItem), 'nested-any evidence may only flow through an unknown boundary');
});

test('concrete external callables and methods remain usable while callable any stays fail closed', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface ConcreteApi { method(value: string): string }',
		'export interface LooseApi { method(value: any): string }',
		'export declare const concreteCallback: (value: string) => string;',
		'export declare const looseCallback: (value: any) => string;',
		'export declare const concreteApi: ConcreteApi;',
		'export declare const looseApi: LooseApi;',
		'export declare function acceptConcreteCallback(value: (value: string) => string): void;',
		'export declare function acceptConcreteApi(value: ConcreteApi): void;',
		'export declare function acceptStrictCallback(value: (value: string) => string): void;',
		'export declare function acceptStrictApi(value: { method(value: string): string }): void;',
		'export declare function acceptUnknown(value: unknown): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export const concreteCallback = value => value;',
		'export const looseCallback = value => value;',
		'export const concreteApi = { method(value) { return value; } };',
		'export const looseApi = { method(value) { return value; } };',
		'export function acceptConcreteCallback() {}',
		'export function acceptConcreteApi() {}',
		'export function acceptStrictCallback() {}',
		'export function acceptStrictApi() {}',
		'export function acceptUnknown() {}',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	const concreteCallback = resolveNamed(provider, root, 'concreteCallback');
	const looseCallback = resolveNamed(provider, root, 'looseCallback');
	const concreteApi = resolveNamed(provider, root, 'concreteApi');
	const looseApi = resolveNamed(provider, root, 'looseApi');

	assert.ok(call(interopProvider, resolveNamed(provider, root, 'acceptConcreteCallback'), concreteCallback), 'provider-owned concrete callable must remain External-to-External evidence');
	assert.ok(call(interopProvider, resolveNamed(provider, root, 'acceptConcreteApi'), concreteApi), 'provider-owned object methods must not erase an otherwise concrete External value');
	assert.equal(call(interopProvider, resolveNamed(provider, root, 'acceptStrictCallback'), looseCallback), undefined, 'any inside a callable parameter cannot prove a stricter callback type');
	assert.equal(call(interopProvider, resolveNamed(provider, root, 'acceptStrictApi'), looseApi), undefined, 'any inside an object method cannot prove a stricter object type');
	assert.ok(call(interopProvider, resolveNamed(provider, root, 'acceptUnknown'), looseCallback), 'callable any evidence may flow only through an unknown boundary');
});

test('recursive concrete foreign evidence terminates without being erased to unknown', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface RecursiveBox<T> { value: T; next?: RecursiveBox<T> }',
		'export declare const recursiveStringBox: RecursiveBox<string>;',
		'export declare function acceptRecursiveStringBox(value: RecursiveBox<string>): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export const recursiveStringBox = { value: "value" };',
		'export function acceptRecursiveStringBox() {}',
		'',
	].join('\n'), 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	assert.ok(call(
		interopProvider,
		resolveNamed(provider, root, 'acceptRecursiveStringBox'),
		resolveNamed(provider, root, 'recursiveStringBox'),
	), 'recursive concrete evidence must remain usable when the graph is finite by identity');
});
