import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';

function provider(): JsInteropProvider {
	return {
		id: 'structural-serialization-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			return {
				runtime: { kind: 'side-effect' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/side-effect.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'structural-serialization-provider-1',
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

test('mutable JSON serialization cannot hide a diagnostic severity mutation from checked-session currentness', () => {
	const originalStringify = JSON.stringify;
	Object.defineProperty(JSON, 'stringify', {
		configurable: true,
		value(value: unknown) {
			if (typeof value === 'string') return '"masked-string"';
			return originalStringify(value);
		},
	});
	try {
		const checked = compileSource({
			id: 1,
			path: '/virtual/structural-serialization.virune',
			text: [
				'import js "./side-effect.js"',
				'',
				'fn main() -> Unit uses JavaScript {',
				'\tdiscard missingValue',
				'}',
				'',
			].join('\n'),
		}, { emit: false, jsInteropProvider: provider() });
		assert.ok(checked.ast);
		assert.ok(checked.semantic);
		const semanticError = checked.semantic.diagnostics.items.find(item => item.severity === 'error');
		assert.ok(semanticError);
		assert.deepEqual(externalOperationSequence({ module: checked.ast, semantic: checked.semantic }), []);

		(semanticError as { severity: string }).severity = 'warning';
		assert.throws(
			() => externalOperationSequence({ module: checked.ast!, semantic: checked.semantic! }),
			/not from the current checked AST semantic session/u,
			'checked-session structural state must not rely on a mutable JSON serializer',
		);
	} finally {
		Object.defineProperty(JSON, 'stringify', {
			configurable: true,
			value: originalStringify,
			writable: true,
		});
	}
});
