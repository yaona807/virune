import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import { externalOperationFromUsage } from '../src/interop/operation.js';
import type { ForeignUsageIR, JsInteropProvider } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

function provider(): JsInteropProvider {
	const generation = 1;
	return {
		id: 'test-provider',
		version: '1',
		generation,
		resolveImport(request) {
			return {
				type: {
					ref: { providerId: 'test-provider', generation, id: 'value' },
					display: 'Value',
					category: 'object',
					origin: { moduleSpecifier: request.moduleSpecifier, exportName: request.importedName ?? 'value' },
				},
				runtime: { kind: 'named', importedName: request.importedName ?? 'value' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'test-provider-1',
				},
			};
		},
		getProperty(_type, name) {
			if (name !== 'promise') return undefined;
			return {
				ref: { providerId: 'test-provider', generation, id: 'promise' },
				display: 'Promise<string>',
				category: 'promise',
				canonicalIdentity: 'ecmascript:Promise',
				origin: { moduleSpecifier: './library.js', exportName: 'promise' },
			};
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

// @virune-rule {"id":"interop.ecmascript-canonical-identity","runner":"unit","file":"packages/compiler/test/interop-canonical-identity.test.ts","case":"canonical Promise identity survives checked usage and provider-independent External evidence","kind":"positive","platform":"common"}
test('canonical Promise identity survives checked usage and provider-independent External evidence', () => {
	const result = compileSource({
		id: 1,
		path: '/virtual/main.virune',
		text: [
			'import js { value } from "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard value.promise',
			'\treturn Unit',
			'}',
			'',
		].join('\n'),
	}, { emit: false, jsInteropProvider: provider() });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.semantic);

	const usage = result.semantic.interop.usageIR.find(item => item.kind === 'property');
	assert.equal(usage?.foreignType.canonicalIdentity, 'ecmascript:Promise');

	const operation = externalOperationSequence(result.semantic).find(item => item.kind === 'read-property');
	assert.equal(operation?.kind, 'read-property');
	if (operation?.kind === 'read-property') {
		assert.equal(operation.result.category, 'promise');
		assert.equal(operation.result.canonicalIdentity, 'ecmascript:Promise');
	}
});

// @virune-rule {"id":"interop.ecmascript-canonical-identity","runner":"unit","file":"packages/compiler/test/interop-canonical-identity.test.ts","case":"malformed canonical identity evidence fails closed","kind":"negative","platform":"common"}
test('malformed canonical identity evidence fails closed', () => {
	const base: ForeignUsageIR = {
		kind: 'property',
		nodeId: 1,
		span,
		foreignType: {
			display: 'Promise<string>',
			category: 'promise',
			canonicalIdentity: 'ecmascript:Promise',
		},
	};
	const valid = externalOperationFromUsage(base);
	assert.equal(valid?.kind, 'read-property');
	if (valid?.kind === 'read-property') assert.equal(valid.result.canonicalIdentity, 'ecmascript:Promise');

	assert.throws(
		() => externalOperationFromUsage({
			...base,
			foreignType: { ...base.foreignType, canonicalIdentity: 'future:Promise' } as unknown as ForeignUsageIR['foreignType'],
		}),
		/Unknown canonical foreign type identity/u,
	);
	assert.throws(
		() => externalOperationFromUsage({
			...base,
			foreignType: { ...base.foreignType, category: 'object' },
		}),
		/Canonical ECMAScript Promise identity requires the promise category/u,
	);
});
