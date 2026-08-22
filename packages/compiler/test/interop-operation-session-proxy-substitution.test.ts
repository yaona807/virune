import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';

function provider(): JsInteropProvider {
	return {
		id: 'source-proxy-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			if (request.kind !== 'side-effect') throw new Error('test provider expects side-effect imports');
			return {
				runtime: { kind: 'side-effect' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: `dist/${request.moduleSpecifier.replace(/^\.\//u, '')}`,
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'source-proxy-provider-1',
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

function operations(result: ReturnType<typeof compileSource>): readonly string[] {
	assert.ok(result.ast);
	assert.ok(result.semantic);
	return externalOperationSequence({ module: result.ast, semantic: result.semantic }).map(operation => operation.kind);
}

test('Proxy substitution cannot change checked source iteration after structural validation', () => {
	const checked = compileSource({
		id: 1,
		path: '/virtual/source-proxy-substitution.virune',
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

	const originalImports = checked.ast.imports;
	const substitutedImports = new Proxy(originalImports, {
		get(target, property, receiver) {
			if (property === Symbol.iterator) {
				return function* substituteFirstImport() {
					const first = target[0]!;
					yield new Proxy(first, {
						get(declaration, declarationProperty, declarationReceiver) {
							if (declarationProperty === 'typeOnly') return true;
							return Reflect.get(declaration, declarationProperty, declarationReceiver);
						},
					});
					yield target[1]!;
				};
			}
			return Reflect.get(target, property, receiver);
		},
	});
	assert.equal(Array.isArray(substitutedImports), true);
	assert.equal(Object.getPrototypeOf(substitutedImports), Array.prototype);
	assert.deepEqual(Reflect.ownKeys(substitutedImports), Reflect.ownKeys(originalImports));
	(checked.ast as unknown as { imports: typeof originalImports }).imports = substitutedImports;

	assert.throws(
		() => operations(checked),
		/not from the current checked AST semantic session/u,
	);
});
