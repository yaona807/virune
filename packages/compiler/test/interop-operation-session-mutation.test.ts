import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';

function provider(): JsInteropProvider {
	return {
		id: 'session-mutation-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			const runtime = request.kind === 'side-effect'
				? { kind: 'side-effect' as const }
				: { kind: 'named' as const, importedName: request.importedName ?? 'value' };
			return {
				...(request.kind === 'side-effect' ? {} : {
					type: {
						ref: { providerId: 'session-mutation-provider', generation: 1, id: request.moduleSpecifier },
						display: 'Value',
						category: 'object' as const,
						origin: { moduleSpecifier: request.moduleSpecifier, exportName: request.importedName ?? 'value' },
					},
				}),
				runtime,
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: `dist/${request.moduleSpecifier.replace(/^\.\//u, '')}`,
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'session-mutation-provider-1',
				},
			};
		},
		getProperty(reference, name) {
			return {
				ref: { providerId: reference.providerId, generation: reference.generation, id: `${reference.id}.${name}` },
				display: 'string',
				category: 'primitive',
				primitive: 'string',
				origin: { moduleSpecifier: './library.js', exportName: name },
			};
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

function checkedPropertyRead() {
	return compileSource({
		id: 1,
		path: '/virtual/semantic-mutation.virune',
		text: [
			'import js { value } from "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard value.field',
			'}',
			'',
		].join('\n'),
	}, { emit: false, jsInteropProvider: provider() });
}

function operations(result: ReturnType<typeof compileSource>): readonly string[] {
	assert.ok(result.ast);
	assert.ok(result.semantic);
	return externalOperationSequence({ module: result.ast, semantic: result.semantic }).map(operation => operation.kind);
}

test('post-check AST mutation cannot remove one of multiple runtime ModuleLoad operations', () => {
	const checked = compileSource({
		id: 1,
		path: '/virtual/import-mutation.virune',
		text: [
			'import js "./first.js"',
			'import js "./second.js"',
			'',
			'fn main() -> Unit uses JavaScript {}',
			'',
		].join('\n'),
	}, { emit: false, jsInteropProvider: provider() });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operations(checked), ['module-load', 'module-load']);
	assert.ok(checked.ast);

	(checked.ast.imports[0] as { typeOnly: boolean }).typeOnly = true;
	assert.throws(
		() => operations(checked),
		/not from the current checked AST semantic session/u,
	);
});

test('post-check semantic mutation cannot remove current non-import operation evidence', () => {
	const checked = checkedPropertyRead();
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operations(checked), ['module-load', 'read-property']);
	assert.ok(checked.semantic);

	(checked.semantic.interop.usages as unknown as { length: number }).length = 1;
	(checked.semantic.interop.usageIR as unknown as { length: number }).length = 1;
	assert.throws(
		() => operations(checked),
		/not from the current checked AST semantic session/u,
	);
});

test('custom usage-array iteration cannot hide post-check evidence', () => {
	const checked = checkedPropertyRead();
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operations(checked), ['module-load', 'read-property']);
	assert.ok(checked.semantic);

	Object.defineProperty(checked.semantic.interop.usageIR, Symbol.iterator, {
		configurable: true,
		value: function* emptyIterator() {},
	});
	assert.throws(
		() => operations(checked),
		/not from the current checked AST semantic session/u,
	);
});

test('custom usage-array methods cannot substitute fingerprint evidence', () => {
	const checked = checkedPropertyRead();
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operations(checked), ['module-load', 'read-property']);
	assert.ok(checked.semantic);

	Object.defineProperty(checked.semantic.interop.usages, 'filter', {
		configurable: true,
		value: () => [],
	});
	assert.throws(
		() => operations(checked),
		/not from the current checked AST semantic session/u,
	);
});

test('accessor-backed operation-relevant evidence cannot change after session registration', () => {
	const checked = checkedPropertyRead();
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operations(checked), ['module-load', 'read-property']);
	assert.ok(checked.semantic);
	const usage = checked.semantic.interop.usageIR.find(item => item.kind === 'property');
	assert.ok(usage);
	const foreignType = usage.foreignType;

	Object.defineProperty(usage, 'foreignType', {
		configurable: true,
		enumerable: true,
		get: () => foreignType,
	});
	assert.throws(
		() => operations(checked),
		/not from the current checked AST semantic session/u,
	);
});

test('post-check diagnostic mutation cannot upgrade a failed module into operation evidence', () => {
	const checked = compileSource({
		id: 1,
		path: '/virtual/diagnostic-mutation.virune',
		text: [
			'import js "./side-effect.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard missingValue',
			'}',
			'',
		].join('\n'),
	}, { emit: false, jsInteropProvider: provider() });
	assert.ok(checked.diagnostics.some(item => item.severity === 'error'));
	assert.deepEqual(operations(checked), []);
	assert.ok(checked.semantic);

	(checked.semantic.diagnostics.items as unknown as { length: number }).length = 0;
	assert.throws(
		() => operations(checked),
		/not from the current checked AST semantic session/u,
	);
});
