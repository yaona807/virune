import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/interop/checked-api.js';
import { isResolvedDirectInteropDecision } from '../src/interop/decision.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';

function provider(): JsInteropProvider {
	return {
		id: 'optional-prototype-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			if (request.kind !== 'side-effect') throw new Error('test provider expects a side-effect import');
			return {
				runtime: { kind: 'side-effect' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'optional-prototype-provider-1',
				},
			};
		},
		getProperty() { return undefined; },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'unknown'; },
	};
}

function restoreProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor | undefined): void {
	if (descriptor === undefined) Reflect.deleteProperty(target, key);
	else Object.defineProperty(target, key, descriptor);
}

test('inherited optional runtime witness fields cannot promote unresolved ModuleLoad evidence', () => {
	const checked = compileSource({
		id: 1,
		path: '/virtual/optional-prototype.virune',
		text: [
			'import js "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {}',
			'',
		].join('\n'),
	}, { emit: false, platform: 'node', jsInteropProvider: provider() });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.ast);
	assert.ok(checked.semantic);

	const baseline = externalOperationSequence({ module: checked.ast, semantic: checked.semantic });
	assert.equal(baseline.length, 1);
	assert.equal(baseline[0]?.kind, 'module-load');
	if (baseline[0]?.kind !== 'module-load') throw new Error('expected ModuleLoad');
	assert.equal(baseline[0].decision.status, 'unresolved');
	assert.equal(isResolvedDirectInteropDecision(baseline[0].decision), false);
	assert.equal(baseline[0].runtimeWitness?.runtimeEntry, undefined);
	assert.equal(baseline[0].runtimeWitness?.runtimeFormat, undefined);

	const previousEntry = Object.getOwnPropertyDescriptor(Object.prototype, 'runtimeEntry');
	const previousFormat = Object.getOwnPropertyDescriptor(Object.prototype, 'runtimeFormat');
	Object.defineProperty(Object.prototype, 'runtimeEntry', {
		configurable: true,
		value: 'dist/forged.js',
	});
	Object.defineProperty(Object.prototype, 'runtimeFormat', {
		configurable: true,
		value: 'esm',
	});
	try {
		const operations = externalOperationSequence({ module: checked.ast, semantic: checked.semantic });
		assert.equal(operations.length, 1);
		assert.equal(operations[0]?.kind, 'module-load');
		if (operations[0]?.kind !== 'module-load') throw new Error('expected ModuleLoad');
		assert.equal(operations[0].decision.status, 'unresolved');
		assert.equal(isResolvedDirectInteropDecision(operations[0].decision), false);
		assert.equal(operations[0].runtimeWitness?.runtimeEntry, undefined);
		assert.equal(operations[0].runtimeWitness?.runtimeFormat, undefined);
	} finally {
		restoreProperty(Object.prototype, 'runtimeEntry', previousEntry);
		restoreProperty(Object.prototype, 'runtimeFormat', previousFormat);
	}
});
