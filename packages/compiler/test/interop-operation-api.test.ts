import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource as compileSourceBase } from '../src/compiler.js';
import { compileSource, checkModule } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

const source = {
	id: 1,
	path: '/virtual/main.virune',
	text: [
		'import js { value } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard value.field',
		'\treturn Unit',
		'}',
		'',
	].join('\n'),
};

function providerForGeneration(generation: number, malformedProperty = false): JsInteropProvider {
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
					providerVersion: `provider-${generation}`,
				},
			};
		},
		getProperty() {
			return {
				ref: { providerId: 'test-provider', generation, id: 'field' },
				display: 'string',
				category: malformedProperty ? 'future-category' : 'primitive',
				primitive: 'string',
				origin: { moduleSpecifier: './library.js', exportName: 'field' },
			} as ReturnType<JsInteropProvider['getProperty']>;
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

test('experimental compiler entry points register operation evidence for the exact checked SemanticModel only', () => {
	const base = compileSourceBase(source, { emit: false, jsInteropProvider: providerForGeneration(1) });
	assert.deepEqual(base.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(base.semantic);
	assert.throws(
		() => externalOperationSequence(base.semantic!),
		/requires a registered checked SemanticModel/u,
	);

	const checked = compileSource(source, { emit: false, jsInteropProvider: providerForGeneration(1) });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.semantic);
	const operations = externalOperationSequence(checked.semantic);
	assert.deepEqual(operations.map(operation => operation.kind), ['module-load', 'read-property']);
	assert.equal(Object.isFrozen(operations), true);
	assert.equal(Object.isFrozen(operations[0]), true);

	const fabricated = { ...checked.semantic };
	assert.throws(
		() => externalOperationSequence(fabricated),
		/requires a registered checked SemanticModel/u,
	);
});

test('direct experimental checkModule registration uses the completed checker result', () => {
	const parsed = parseSource(source);
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const semantic = checkModule(parsed.ast, {
		containingFile: source.path,
		platform: 'node',
		jsInteropProvider: providerForGeneration(1),
	});
	assert.deepEqual(semantic.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.deepEqual(externalOperationSequence(semantic).map(operation => operation.kind), ['module-load', 'read-property']);
});

test('later checks and later provider generations do not retroactively invalidate a completed snapshot', () => {
	const first = compileSource(source, { emit: false, jsInteropProvider: providerForGeneration(1) });
	const second = compileSource(source, { emit: false, jsInteropProvider: providerForGeneration(2) });
	assert.ok(first.semantic);
	assert.ok(second.semantic);
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);

	assert.deepEqual(externalOperationSequence(first.semantic).map(operation => operation.kind), ['module-load', 'read-property']);
	assert.deepEqual(externalOperationSequence(second.semantic).map(operation => operation.kind), ['module-load', 'read-property']);
});

test('invalid sidecar projection fails closed without changing checker acceptance or diagnostics', () => {
	const checked = compileSource(source, { emit: false, jsInteropProvider: providerForGeneration(1, true) });
	assert.deepEqual(
		checked.diagnostics.filter(item => item.severity === 'error'),
		[],
		'External Operation projection must not create new checker diagnostics',
	);
	assert.ok(checked.semantic);
	assert.throws(
		() => externalOperationSequence(checked.semantic),
		/evidence is unavailable for this checked SemanticModel/u,
	);
});
