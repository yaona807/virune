import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';

function provider(): JsInteropProvider {
	return {
		id: 'any-compat-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			return {
				type: {
					ref: { providerId: 'any-compat-provider', generation: 1, id: 'api' },
					display: 'Api',
					category: 'object',
					origin: { moduleSpecifier: request.moduleSpecifier, exportName: request.importedName ?? 'api' },
				},
				runtime: { kind: 'named', importedName: request.importedName ?? 'api' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'any-compat-provider-1',
				},
			};
		},
		getProperty(reference, name) {
			return {
				ref: { providerId: reference.providerId, generation: reference.generation, id: `${reference.id}.${name}` },
				display: 'any',
				category: 'any',
				origin: { moduleSpecifier: './library.js', exportName: name },
			};
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Api'; },
	};
}

test('an already-accepted foreign any property remains representable without stronger safety claims', () => {
	const result = compileSource({
		id: 1,
		path: '/virtual/any-property.virune',
		text: [
			'import js { api } from "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard api.anyValue',
			'}',
			'',
		].join('\n'),
	}, { emit: false, platform: 'node', jsInteropProvider: provider() });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.ast);
	assert.ok(result.semantic);

	const operations = externalOperationSequence({ module: result.ast, semantic: result.semantic });
	assert.deepEqual(operations.map(operation => operation.kind), ['module-load', 'read-property']);
	const property = operations[1];
	assert.equal(property?.kind, 'read-property');
	if (property?.kind !== 'read-property') return;
	assert.equal(property.result.category, 'any');
	assert.equal(property.decision.status, 'resolved');
	assert.equal(property.decision.mechanism, 'direct');
	assert.deepEqual(property.decision.claims, []);
});
