import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	compileSource,
	type ForeignTypeSnapshot,
	type InteropArgumentType,
	type InteropCallUsage,
	type JsInteropProvider,
} from '@virune/compiler/experimental';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function resolveNamed(provider: TypeScriptInteropProvider, root: string, importedName: string, platform: 'node' | 'browser' | 'neutral' = 'node'): ForeignTypeSnapshot {
	const imported = provider.resolveImport({ containingFile: join(root, 'src/main.virune'), moduleSpecifier: './library.js', kind: 'named', importedName, platform });
	assert.ok(imported.type);
	return imported.type;
}

function resolveUsage(provider: JsInteropProvider, callee: ForeignTypeSnapshot, usage: InteropCallUsage) {
	assert.ok(provider.resolveCallUsage, 'provider must expose the experimental whole-usage resolver at runtime');
	return provider.resolveCallUsage(callee.ref, usage);
}

function call(provider: JsInteropProvider, callee: ForeignTypeSnapshot, argumentsList: readonly InteropArgumentType[]) {
	return resolveUsage(provider, callee, { target: { kind: 'value' }, arguments: argumentsList });
}

function native(primitive: 'Bool' | 'Int' | 'Float' | 'BigInt' | 'String' | 'Unit'): InteropArgumentType {
	return { kind: 'native-primitive', primitive };
}

function errorCodes(result: ReturnType<typeof compileSource>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('resolves complete TypeScript call usages with literal, generic, rest, and fixed-session evidence', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface Item { value: string }',
		'export declare const item: Item;',
		'export declare const anyValue: any;',
		'export declare function literalOnly(value: "foo"): "literal";',
		'export declare function boolOnly(value: true): "bool";',
		'export declare function intOnly(value: 1): "int";',
		'export declare function floatOnly(value: 1.5): "float";',
		'export declare function bigintOnly(value: 1n): "bigint";',
		'export declare function choose(value: "foo"): "literal";',
		'export declare function choose(value: string): "broad";',
		'export declare function identity<T extends string>(value: T): T;',
		'export declare function constrained<T extends string>(): T;',
		'export declare function unresolved<T>(): T;',
		'export declare function maybeUnknown(value: string): unknown;',
		'export declare function maybeUnknown<T>(): T;',
		'export declare function collect(...values: string[]): number;',
		'export declare function acceptItem(value: Item): void;',
		'export declare function makeItem(): Item;',
		'export declare function makeItemAsync(): Promise<Item>;',
		'export declare function acceptString(value: string): void;',
		'export declare function acceptUnknown(value: unknown): void;',
		'export interface Api { method(this: Api, value: "foo"): "member" }',
		'export declare const api: Api;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export const item = { value: "value" };',
		'export const anyValue = "value";',
		'export function literalOnly() { return "literal"; }',
		'export function boolOnly() { return "bool"; }',
		'export function intOnly() { return "int"; }',
		'export function floatOnly() { return "float"; }',
		'export function bigintOnly() { return "bigint"; }',
		'export function choose(value) { return value === "foo" ? "literal" : "broad"; }',
		'export function identity(value) { return value; }',
		'export function constrained() { return "value"; }',
		'export function unresolved() { return undefined; }',
		'export function maybeUnknown(value) { return value; }',
		'export function collect(...values) { return values.length; }',
		'export function acceptItem() {}',
		'export function makeItem() { return item; }',
		'export async function makeItemAsync() { return item; }',
		'export function acceptString() {}',
		'export function acceptUnknown() {}',
		'export const api = { method() { return "member"; } };',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });

	const literalOnly = resolveNamed(provider, root, 'literalOnly');
	assert.equal(call(provider, literalOnly, [native('String')]), undefined);
	assert.equal(call(provider, literalOnly, [{ kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'foo' } }])?.result.display, '"literal"');
	assert.equal(call(provider, resolveNamed(provider, root, 'boolOnly'), [{ kind: 'native-primitive', primitive: 'Bool', literal: { kind: 'Bool', value: true } }])?.result.display, '"bool"');
	assert.equal(call(provider, resolveNamed(provider, root, 'intOnly'), [{ kind: 'native-primitive', primitive: 'Int', literal: { kind: 'Int', value: 1 } }])?.result.display, '"int"');
	assert.equal(call(provider, resolveNamed(provider, root, 'floatOnly'), [{ kind: 'native-primitive', primitive: 'Float', literal: { kind: 'Float', value: 1.5 } }])?.result.display, '"float"');
	assert.equal(call(provider, resolveNamed(provider, root, 'bigintOnly'), [{ kind: 'native-primitive', primitive: 'BigInt', literal: { kind: 'BigInt', value: '1' } }])?.result.display, '"bigint"');

	const choose = resolveNamed(provider, root, 'choose');
	assert.equal(call(provider, choose, [{ kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'foo' } }])?.result.display, '"literal"');
	assert.equal(call(provider, choose, [native('String')])?.result.display, '"broad"');

	const identity = resolveNamed(provider, root, 'identity');
	assert.equal(call(provider, identity, [{ kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'x' } }])?.result.display, '"x"');
	assert.equal(call(provider, identity, [native('String')])?.result.display, 'string');
	assert.equal(call(provider, resolveNamed(provider, root, 'constrained'), [])?.result.display, 'string');
	assert.equal(call(provider, resolveNamed(provider, root, 'unresolved'), []), undefined);
	assert.equal(call(provider, resolveNamed(provider, root, 'maybeUnknown'), [native('String')])?.result.category, 'unknown');

	const collect = resolveNamed(provider, root, 'collect');
	const emptyRest = call(provider, collect, []);
	assert.ok(emptyRest);
	assert.equal(emptyRest.minimumArgumentCount, 0);
	assert.equal(emptyRest.rest, true);
	const twoRest = call(provider, collect, [native('String'), native('String')]);
	assert.ok(twoRest);
	assert.equal(twoRest.minimumArgumentCount, 0);
	assert.equal(twoRest.rest, true);

	const nodeItem = resolveNamed(provider, root, 'item', 'node');
	const acceptItem = resolveNamed(provider, root, 'acceptItem', 'node');
	assert.ok(call(provider, acceptItem, [{ kind: 'foreign', type: nodeItem.ref }]));
	const browserItem = resolveNamed(provider, root, 'item', 'browser');
	assert.equal(call(provider, acceptItem, [{ kind: 'foreign', type: browserItem.ref }]), undefined);
	assert.equal(resolveUsage(provider, acceptItem, { target: { kind: 'value' }, arguments: [{ kind: 'foreign', type: { ...nodeItem.ref, generation: nodeItem.ref.generation + 1 } }] }), undefined);

	const makeItem = resolveNamed(provider, root, 'makeItem');
	const madeItem = call(provider, makeItem, []);
	assert.ok(madeItem);
	assert.ok(call(provider, acceptItem, [{ kind: 'foreign', type: madeItem.result.ref }]), 'whole-usage call results must rematerialize in a later fixed Program');
	const madeItemValue = provider.getProperty(madeItem.result.ref, 'value');
	assert.ok(madeItemValue);
	const acceptString = resolveNamed(provider, root, 'acceptString');
	assert.ok(call(provider, acceptString, [{ kind: 'foreign', type: madeItemValue.ref }]), 'properties of whole-usage call results must preserve their projection');

	const makeItemAsync = resolveNamed(provider, root, 'makeItemAsync');
	const pendingItem = call(provider, makeItemAsync, []);
	assert.ok(pendingItem);
	const awaitedItem = provider.getAwaitedType(pendingItem.result.ref);
	assert.ok(awaitedItem);
	assert.ok(call(provider, acceptItem, [{ kind: 'foreign', type: awaitedItem.ref }]), 'awaited whole-usage results must rematerialize in a later fixed Program');

	const anyValue = resolveNamed(provider, root, 'anyValue');
	const acceptUnknown = resolveNamed(provider, root, 'acceptUnknown');
	assert.equal(call(provider, acceptString, [{ kind: 'foreign', type: anyValue.ref }]), undefined);
	assert.ok(call(provider, acceptUnknown, [{ kind: 'foreign', type: anyValue.ref }]));

	const api = resolveNamed(provider, root, 'api');
	const method = provider.getProperty(api.ref, 'method');
	assert.ok(method);
	const literalArgument: InteropArgumentType = { kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'foo' } };
	assert.equal(resolveUsage(provider, method, { target: { kind: 'value' }, arguments: [literalArgument] }), undefined);
	assert.equal(resolveUsage(provider, method, { target: { kind: 'member', receiver: api.ref, property: 'method' }, arguments: [literalArgument] })?.result.display, '"member"');
});

test('uses TypeScript positional arity when a checked-JavaScript default precedes a required parameter', async () => {
	const root = await fixtureRoot();
	await rm(join(root, 'src/library.d.ts'), { force: true });
	await writeFile(join(root, 'src/library.js'), [
		'/**',
		' * @param {string} first',
		' * @param {string} second',
		' */',
		'export function withLeadingDefault(first = "default", second) { return first + second; }',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const fn = resolveNamed(provider, root, 'withLeadingDefault');
	assert.equal(call(provider, fn, [native('String')]), undefined);
	const accepted = call(provider, fn, [native('String'), native('String')]);
	assert.ok(accepted);
	assert.equal(accepted.minimumArgumentCount, 2);
});

test('cached provider forwards the whole-usage resolver instead of falling back to the approximate call path', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function literalOnly(value: "foo"): string;\n', 'utf8');
	const provider = new CachedTypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({ containingFile: join(root, 'src/main.virune'), moduleSpecifier: './library.js', kind: 'named', importedName: 'literalOnly', platform: 'node' });
	assert.ok(imported.type);
	const interopProvider: JsInteropProvider = provider;
	assert.ok(interopProvider.resolveCallUsage, 'cached provider must forward the experimental whole-usage hook at runtime');
	assert.equal(interopProvider.resolveCallUsage(imported.type.ref, { target: { kind: 'value' }, arguments: [native('String')] }), undefined);
	assert.ok(interopProvider.resolveCallUsage(imported.type.ref, { target: { kind: 'value' }, arguments: [{ kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'foo' } }] }));
});

test('compiler routes JavaScript calls through whole-usage TypeScript resolution without expected-type backflow', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare function literalOnly(value: "foo"): "literal";',
		'export declare function identity<T extends string>(value: T): T;',
		'export declare function collect(...values: string[]): number;',
		'export declare function echoUnknown(value: unknown): unknown;',
		'export declare function contextual<T>(): T;',
		'export interface Api { method(this: Api, value: "foo"): "member" }',
		'export declare const api: Api;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export function literalOnly() { return "literal"; }',
		'export function identity(value) { return value; }',
		'export function collect(...values) { return values.length; }',
		'export function echoUnknown(value) { return value; }',
		'export function contextual() { return undefined; }',
		'export const api = { method() { return "member"; } };',
		'',
	].join('\n'), 'utf8');

	const acceptedProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const accepted = compileSource({
		id: 1,
		path: join(root, 'src/accepted.virune'),
		text: `import js { literalOnly, identity, collect, api } from "./library.js"\n\nfn literal() -> String uses JavaScript {\n\treturn literalOnly("foo")\n}\n\nfn generic() -> String uses JavaScript {\n\treturn identity("x")\n}\n\nfn rest() -> Float uses JavaScript {\n\treturn collect("a", "b")\n}\n\nfn member() -> String uses JavaScript {\n\treturn api.method("foo")\n}\n`,
	}, { platform: 'node', jsInteropProvider: acceptedProvider });
	assert.deepEqual(errorCodes(accepted), []);

	const broadProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const broadRejected = compileSource({
		id: 2,
		path: join(root, 'src/broad-rejected.virune'),
		text: `import js { literalOnly } from "./library.js"\n\nfn use(value: String) -> String uses JavaScript {\n\treturn literalOnly(value)\n}\n`,
	}, { platform: 'node', jsInteropProvider: broadProvider });
	assert.deepEqual(errorCodes(broadRejected), ['L4204']);

	const unknownProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const unknownRejected = compileSource({
		id: 3,
		path: join(root, 'src/unknown-rejected.virune'),
		text: `import js { echoUnknown } from "./library.js"\n\nfn use(value: Unknown) -> Unknown uses JavaScript {\n\treturn echoUnknown(value)\n}\n`,
	}, { platform: 'node', jsInteropProvider: unknownProvider });
	assert.deepEqual(errorCodes(unknownRejected), ['L4204']);

	const contextualProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const contextualRejected = compileSource({
		id: 4,
		path: join(root, 'src/contextual-rejected.virune'),
		text: `import js { contextual } from "./library.js"\n\nfn use() -> String uses JavaScript {\n\treturn contextual()\n}\n`,
	}, { platform: 'node', jsInteropProvider: contextualProvider });
	assert.deepEqual(errorCodes(contextualRejected), ['L4204']);

	const extractedProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const extractedRejected = compileSource({
		id: 5,
		path: join(root, 'src/extracted-rejected.virune'),
		text: `import js { api } from "./library.js"\n\nfn use() -> String uses JavaScript {\n\tlet method = api.method\n\treturn method("foo")\n}\n`,
	}, { platform: 'node', jsInteropProvider: extractedProvider });
	assert.deepEqual(errorCodes(extractedRejected), ['L4204']);
});
