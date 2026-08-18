import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function resolveNamed(provider: TypeScriptInteropProvider, root: string, importedName: string, platform: 'node' | 'browser' | 'neutral' = 'node') {
	const imported = provider.resolveImport({ containingFile: join(root, 'src/main.virune'), moduleSpecifier: './library.js', kind: 'named', importedName, platform });
	assert.ok(imported.type);
	return imported.type;
}

function errorCodes(result: ReturnType<typeof compileSource>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('resolves Node standard module declarations in node projects', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({ containingFile: join(root, 'src/main.virune'), moduleSpecifier: 'node:path', kind: 'named', importedName: 'join', platform: 'node' });
	assert.equal(imported.type?.category, 'function');
});

test('rejects native Unknown outbound while preserving known primitive arguments to TypeScript unknown and any', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare function parseUnknown(value: unknown): unknown;',
		'export declare function parseAny(value: any): unknown;',
		'export declare const unsafeValue: any;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function parseUnknown(value) { return value; }\nexport function parseAny(value) { return value; }\nexport const unsafeValue = 1;\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });

	const parseUnknown = resolveNamed(provider, root, 'parseUnknown');
	assert.equal(provider.resolveCall(parseUnknown.ref, [{ kind: 'unknown' }]), undefined);
	assert.ok(provider.resolveCall(parseUnknown.ref, [{ kind: 'native-primitive', primitive: 'String' }]));

	const parseAny = resolveNamed(provider, root, 'parseAny');
	assert.equal(provider.resolveCall(parseAny.ref, [{ kind: 'unknown' }]), undefined);
	assert.ok(provider.resolveCall(parseAny.ref, [{ kind: 'native-primitive', primitive: 'String' }]));

	const rejectedUnknown = compileSource({
		id: 1,
		path: join(root, 'src/rejected-unknown.virune'),
		text: `import js { parseUnknown } from "./library.js"\n\nfn roundTrip(value: Unknown) -> Unknown uses JavaScript {\n\treturn parseUnknown(value)\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(errorCodes(rejectedUnknown), ['L4204']);

	const rejectedAny = compileSource({
		id: 2,
		path: join(root, 'src/rejected-any.virune'),
		text: `import js { parseAny } from "./library.js"\n\nfn roundTrip(value: Unknown) -> Unknown uses JavaScript {\n\treturn parseAny(value)\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(errorCodes(rejectedAny), ['L4204']);

	const acceptedKnown = compileSource({
		id: 3,
		path: join(root, 'src/accepted-known.virune'),
		text: `import js { parseUnknown } from "./library.js"\n\nfn parse(value: String) -> Unknown uses JavaScript {\n\treturn parseUnknown(value)\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(errorCodes(acceptedKnown), []);

	const unsafe = compileSource({
		id: 4,
		path: join(root, 'src/unsafe.virune'),
		text: `import js { unsafeValue } from "./library.js"\n`,
	}, { emit: false, platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(errorCodes(unsafe), ['L4212']);
});

test('fails closed on foreign any evidence and unsupported rest arguments', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface Api {',
		'  anyValue: any;',
		'  strings: string[];',
		'  acceptString(value: string): void;',
		'  acceptUnknown(value: unknown): void;',
		'  acceptAny(value: any): void;',
		'  acceptRest(...values: string[]): void;',
		'}',
		'export declare const api: Api;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export const api = { anyValue: "value", strings: ["value"], acceptString() {}, acceptUnknown() {}, acceptAny() {}, acceptRest() {} };\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const api = resolveNamed(provider, root, 'api');
	const anyValue = provider.getProperty(api.ref, 'anyValue');
	const strings = provider.getProperty(api.ref, 'strings');
	const acceptString = provider.getProperty(api.ref, 'acceptString');
	const acceptUnknown = provider.getProperty(api.ref, 'acceptUnknown');
	const acceptAny = provider.getProperty(api.ref, 'acceptAny');
	const acceptRest = provider.getProperty(api.ref, 'acceptRest');
	assert.ok(anyValue && strings && acceptString && acceptUnknown && acceptAny && acceptRest);
	assert.equal(anyValue.category, 'any');
	assert.equal(provider.resolveCall(acceptString.ref, [{ kind: 'foreign', type: anyValue.ref }]), undefined);
	assert.ok(provider.resolveCall(acceptUnknown.ref, [{ kind: 'foreign', type: anyValue.ref }]));
	assert.ok(provider.resolveCall(acceptAny.ref, [{ kind: 'foreign', type: anyValue.ref }]));
	assert.ok(provider.resolveCall(acceptRest.ref, []));
	assert.equal(provider.resolveCall(acceptRest.ref, [{ kind: 'foreign', type: strings.ref }]), undefined);
	assert.equal(provider.resolveCall(acceptRest.ref, [{ kind: 'foreign', type: strings.ref }, { kind: 'unknown' }]), undefined);

	const rejectedSpecific = compileSource({
		id: 5,
		path: join(root, 'src/rejected-foreign-any.virune'),
		text: `import js { api } from "./library.js"\n\nfn use() -> Unit uses JavaScript {\n\tapi.acceptString(api.anyValue)\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(errorCodes(rejectedSpecific), ['L4204']);

	const rejectedRest = compileSource({
		id: 6,
		path: join(root, 'src/rejected-rest.virune'),
		text: `import js { api } from "./library.js"\n\nfn use(value: Unknown) -> Unit uses JavaScript {\n\tapi.acceptRest(api.strings, value)\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(errorCodes(rejectedRest), ['L4204']);
});

test('does not treat broad native primitives as TypeScript literal values', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare function acceptStringLiteral(value: "foo"): void;',
		'export declare function acceptStringLiteralUnion(value: "foo" | "bar"): void;',
		'export declare function acceptBoolLiteral(value: true): void;',
		'export declare function acceptNumberLiteral(value: 1): void;',
		'export declare function acceptBigIntLiteral(value: 1n): void;',
		'export declare function acceptString(value: string): void;',
		'export declare function acceptBool(value: boolean): void;',
		'export declare function acceptNumber(value: number): void;',
		'export declare function acceptBigInt(value: bigint): void;',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const rejects = (name: string, primitive: 'Bool' | 'Int' | 'Float' | 'BigInt' | 'String' | 'Unit') => {
		const fn = resolveNamed(provider, root, name);
		assert.equal(provider.resolveCall(fn.ref, [{ kind: 'native-primitive', primitive }]), undefined, name);
	};
	const accepts = (name: string, primitive: 'Bool' | 'Int' | 'Float' | 'BigInt' | 'String' | 'Unit') => {
		const fn = resolveNamed(provider, root, name);
		assert.ok(provider.resolveCall(fn.ref, [{ kind: 'native-primitive', primitive }]), name);
	};

	rejects('acceptStringLiteral', 'String');
	rejects('acceptStringLiteralUnion', 'String');
	rejects('acceptBoolLiteral', 'Bool');
	rejects('acceptNumberLiteral', 'Int');
	rejects('acceptNumberLiteral', 'Float');
	rejects('acceptBigIntLiteral', 'BigInt');

	accepts('acceptString', 'String');
	accepts('acceptBool', 'Bool');
	accepts('acceptNumber', 'Int');
	accepts('acceptNumber', 'Float');
	accepts('acceptBigInt', 'BigInt');
});

test('fails closed on cross-Program facts that are not representation-safe', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface Item { value: string }',
		'export declare const item: Item;',
		'export declare const maybeItem: Item | string;',
		'export declare const text: string;',
		'export declare function acceptObject(value: object): void;',
		'export declare function acceptItem(value: Item): void;',
		'export declare function acceptUnknown(value: unknown): void;',
		'export declare function acceptAny(value: any): void;',
		'export declare function acceptString(value: string): void;',
		'export declare function acceptLiteral(value: "foo"): void;',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });

	// Separate platform workspaces use distinct TypeScript Program/checker identities.
	const item = resolveNamed(provider, root, 'item', 'browser');
	const maybeItem = resolveNamed(provider, root, 'maybeItem', 'browser');
	const text = resolveNamed(provider, root, 'text', 'browser');
	const acceptObject = resolveNamed(provider, root, 'acceptObject', 'node');
	const acceptItem = resolveNamed(provider, root, 'acceptItem', 'node');
	const acceptUnknown = resolveNamed(provider, root, 'acceptUnknown', 'node');
	const acceptAny = resolveNamed(provider, root, 'acceptAny', 'node');
	const acceptString = resolveNamed(provider, root, 'acceptString', 'node');
	const acceptLiteral = resolveNamed(provider, root, 'acceptLiteral', 'node');

	assert.ok(provider.resolveCall(acceptObject.ref, [{ kind: 'foreign', type: item.ref }]));
	assert.equal(provider.resolveCall(acceptItem.ref, [{ kind: 'foreign', type: item.ref }]), undefined);
	assert.equal(provider.resolveCall(acceptObject.ref, [{ kind: 'foreign', type: maybeItem.ref }]), undefined);
	assert.ok(provider.resolveCall(acceptUnknown.ref, [{ kind: 'foreign', type: item.ref }]));
	assert.ok(provider.resolveCall(acceptAny.ref, [{ kind: 'foreign', type: item.ref }]));
	assert.ok(provider.resolveCall(acceptString.ref, [{ kind: 'foreign', type: text.ref }]));
	assert.equal(provider.resolveCall(acceptLiteral.ref, [{ kind: 'foreign', type: text.ref }]), undefined);
});
