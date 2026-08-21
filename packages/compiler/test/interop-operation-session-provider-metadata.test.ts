import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { ForeignTypeSnapshot, JsInteropProvider, ModuleResolutionWitness } from '../src/interop/types.js';

function withThrowingPrivateGetter<T extends object>(value: T, onRead: () => void): T {
	Object.defineProperty(value, 'providerPrivateMetadata', {
		enumerable: true,
		configurable: false,
		get() {
			onRead();
			throw new Error('provider-private getter must not be read');
		},
	});
	return value;
}

function provider(onPrivateRead: () => void): JsInteropProvider {
	const snapshot = (id: string, primitive?: 'string'): ForeignTypeSnapshot => withThrowingPrivateGetter({
		ref: { providerId: 'private-metadata-provider', generation: 1, id },
		display: primitive === undefined ? 'Value' : 'string',
		category: primitive === undefined ? 'object' : 'primitive',
		...(primitive === undefined ? {} : { primitive }),
		origin: { moduleSpecifier: './library.js', exportName: id },
	}, onPrivateRead);
	const witness = (): ModuleResolutionWitness => withThrowingPrivateGetter({
		moduleSpecifier: './library.js',
		runtimeEntry: 'dist/library.js',
		runtimeFormat: 'esm',
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'private-metadata-provider-1',
	}, onPrivateRead);
	return {
		id: 'private-metadata-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			return {
				type: snapshot(request.importedName ?? 'value'),
				runtime: { kind: 'named', importedName: request.importedName ?? 'value' },
				witness: witness(),
			};
		},
		getProperty(_reference, name) { return snapshot(name, 'string'); },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

function checkedProject(onPrivateRead: () => void) {
	return compileSource({
		id: 1,
		path: '/virtual/private-metadata.virune',
		text: [
			'import js { value } from "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard value.field',
			'}',
			'',
		].join('\n'),
	}, { emit: false, jsInteropProvider: provider(onPrivateRead) });
}

test('unknown enumerable provider metadata is not a checked-session truth source', () => {
	let privateReads = 0;
	const checked = checkedProject(() => { privateReads++; });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.ast);
	assert.ok(checked.semantic);
	assert.deepEqual(
		externalOperationSequence({ module: checked.ast, semantic: checked.semantic }).map(operation => operation.kind),
		['module-load', 'read-property'],
	);
	assert.equal(privateReads, 0);
	assert.equal(JSON.stringify(externalOperationSequence({ module: checked.ast, semantic: checked.semantic })).includes('providerPrivateMetadata'), false);
});

test('mutating an operation-relevant module witness still invalidates the checked session', () => {
	const checked = checkedProject(() => undefined);
	assert.ok(checked.ast);
	assert.ok(checked.semantic);
	assert.deepEqual(
		externalOperationSequence({ module: checked.ast, semantic: checked.semantic }).map(operation => operation.kind),
		['module-load', 'read-property'],
	);
	const witness = checked.semantic.interop.moduleWitnesses[0];
	assert.ok(witness);
	(witness as { runtimeEntry?: string }).runtimeEntry = 'dist/changed.js';
	assert.throws(
		() => externalOperationSequence({ module: checked.ast!, semantic: checked.semantic! }),
		/not from the current checked AST semantic session/u,
	);
});
