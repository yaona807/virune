import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDeclarationText } from './probe-typescript-7.mjs';

test('normalizes declaration string literal quote style', () => {
	const typescript6 = 'export declare const values: readonly ["one", "two"];\n';
	const typescript7 = "export declare const values: readonly ['one', 'two'];\n";
	assert.equal(normalizeDeclarationText(typescript6), normalizeDeclarationText(typescript7));
});

test('normalizes redundant undefined in optional unknown declarations', () => {
	const typescript6 = 'export declare class Failure { readonly cause?: unknown | undefined; constructor(cause?: unknown | undefined); }\n';
	const typescript7 = 'export declare class Failure { readonly cause?: unknown; constructor(cause?: unknown); }\n';
	assert.equal(normalizeDeclarationText(typescript6), normalizeDeclarationText(typescript7));
});

test('resolves local type queries used for inferred alias declarations', () => {
	const typescript6 = 'export declare const convert: (value: number) => number;\nexport declare const alias: (value: number) => number;\n';
	const typescript7 = 'export declare const convert: (value: number) => number;\nexport declare const alias: typeof convert;\n';
	assert.equal(normalizeDeclarationText(typescript6), normalizeDeclarationText(typescript7));
});

test('retains semantic declaration changes', () => {
	const before = 'export declare const convert: (value: number) => number;\n';
	const after = 'export declare const convert: (value: string) => number;\n';
	assert.notEqual(normalizeDeclarationText(before), normalizeDeclarationText(after));
});
