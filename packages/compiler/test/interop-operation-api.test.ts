import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

const provider: JsInteropProvider = {
	id: 'test-provider',
	version: '1',
	generation: 1,
	resolveImport(request) {
		return {
			type: {
				ref: { providerId: 'test-provider', generation: 1, id: 'value' },
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
				providerVersion: '1',
			},
		};
	},
	getProperty() {
		return {
			ref: { providerId: 'test-provider', generation: 1, id: 'field' },
			display: 'string',
			category: 'primitive',
			primitive: 'string',
			origin: { moduleSpecifier: './library.js', exportName: 'field' },
		};
	},
	resolveCall() { return undefined; },
	resolveConstruct() { return undefined; },
	getAwaitedType() { return undefined; },
	display() { return 'Value'; },
};

test('public operation derivation rejects a freshly reparsed unchecked AST paired with another check semantic model', () => {
	const source = {
		id: 1,
		path: '/virtual/main.virune',
		text: [
			'import js { value } from "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard value.field',
			'}',
			'',
		].join('\n'),
	};
	const checked = compileSource(source, { emit: false, jsInteropProvider: provider });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.ast);
	assert.ok(checked.semantic);
	assert.deepEqual(
		externalOperationSequence({ module: checked.ast, semantic: checked.semantic }).map(operation => operation.kind),
		['module-load', 'read-property'],
	);

	const reparsed = parseSource(source);
	assert.ok(reparsed.ast);
	assert.deepEqual(reparsed.diagnostics.filter(item => item.severity === 'error'), []);
	assert.throws(
		() => externalOperationSequence({ module: reparsed.ast!, semantic: checked.semantic! }),
		/not from the checked AST/u,
	);
});
