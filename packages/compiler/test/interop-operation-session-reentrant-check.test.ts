import assert from 'node:assert/strict';
import test from 'node:test';
import { checkModule as checkModuleBase } from '../src/checker/checker.js';
import { checkModule, TypeChecker } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

function sideEffectResolution(request: Parameters<JsInteropProvider['resolveImport']>[0]) {
	return {
		runtime: { kind: 'side-effect' as const },
		witness: {
			moduleSpecifier: request.moduleSpecifier,
			runtimeEntry: 'dist/library.js',
			runtimeFormat: 'esm' as const,
			conditions: ['import', 'node'],
			platform: request.platform,
			providerVersion: 'reentrant-check-provider-1',
		},
	};
}

function providerWithResolveImport(resolveImport: JsInteropProvider['resolveImport']): JsInteropProvider {
	return {
		id: 'reentrant-check-provider',
		version: '1',
		generation: 1,
		resolveImport,
		getProperty() { return undefined; },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return '<external>'; },
	};
}

function parsedSideEffectModule() {
	const source = {
		id: 1,
		path: '/virtual/reentrant-check.virune',
		text: [
			'import js "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {}',
			'',
		].join('\n'),
	};
	const parsed = parseSource(source);
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	return { source, ast: parsed.ast };
}

test('nested same-AST base check during provider resolution cannot register the outer semantic under the nested witness', () => {
	const { source, ast } = parsedSideEffectModule();
	let nestedCheckRan = false;
	const provider = providerWithResolveImport(request => {
		if (!nestedCheckRan) {
			nestedCheckRan = true;
			const nested = checkModuleBase(ast, {
				containingFile: source.path,
				platform: 'node',
			});
			assert.ok(nested.diagnostics.items.some(item => item.code === 'L4200'));
		}
		return sideEffectResolution(request);
	});

	assert.throws(
		() => checkModule(ast, {
			containingFile: source.path,
			platform: 'node',
			jsInteropProvider: provider,
		}),
		/Cannot re-register checked semantic after its checker witness has changed/u,
	);
	assert.equal(nestedCheckRan, true);
});

test('same-AST experimental checkModule reentrancy is rejected before it can replace the outer session', () => {
	const { source, ast } = parsedSideEffectModule();
	let reentrantAttempted = false;
	const nestedProvider = providerWithResolveImport(sideEffectResolution);
	const provider = providerWithResolveImport(request => {
		if (!reentrantAttempted) {
			reentrantAttempted = true;
			assert.throws(
				() => checkModule(ast, {
					containingFile: source.path,
					platform: 'node',
					jsInteropProvider: nestedProvider,
				}),
				/Reentrant experimental checkModule calls for the same AST are not supported/u,
			);
		}
		return sideEffectResolution(request);
	});

	const semantic = checkModule(ast, {
		containingFile: source.path,
		platform: 'node',
		jsInteropProvider: provider,
	});
	assert.equal(reentrantAttempted, true);
	assert.deepEqual(semantic.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.deepEqual(
		externalOperationSequence({ module: ast, semantic }).map(operation => operation.kind),
		['module-load'],
	);
});

test('one experimental TypeChecker instance rejects provider-driven reentrant checks without invalidating the outer result', () => {
	const { source, ast } = parsedSideEffectModule();
	let reentrantAttempted = false;
	let checker!: TypeChecker;
	const provider = providerWithResolveImport(request => {
		if (!reentrantAttempted) {
			reentrantAttempted = true;
			assert.throws(
				() => checker.check(ast),
				/Reentrant experimental TypeChecker checks are not supported/u,
			);
		}
		return sideEffectResolution(request);
	});
	checker = new TypeChecker({
		containingFile: source.path,
		platform: 'node',
		jsInteropProvider: provider,
	});

	const semantic = checker.check(ast);
	assert.equal(reentrantAttempted, true);
	assert.deepEqual(semantic.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.deepEqual(
		externalOperationSequence({ module: ast, semantic }).map(operation => operation.kind),
		['module-load'],
	);
});
