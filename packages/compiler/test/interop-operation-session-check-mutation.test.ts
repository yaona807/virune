import assert from 'node:assert/strict';
import test from 'node:test';
import { checkModule, TypeChecker } from '../src/interop/checked-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

function parsedModule(path: string) {
	const parsed = parseSource({
		id: 1,
		path,
		text: [
			'import js "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {}',
			'',
		].join('\n'),
	});
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	assert.equal(parsed.ast.imports[0]?.typeOnly, false);
	return parsed.ast;
}

function mutatingProvider(module: ReturnType<typeof parsedModule>, onMutation: () => void): JsInteropProvider {
	return {
		id: 'direct-check-source-mutation-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			const declaration = module.imports[0];
			assert.ok(declaration);
			(declaration as { typeOnly: boolean }).typeOnly = true;
			onMutation();
			return {
				runtime: { kind: 'side-effect' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'direct-check-source-mutation-provider-1',
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

test('experimental checkModule rejects provider mutation of source-authored AST during the check', () => {
	const module = parsedModule('/virtual/direct-check-source-mutation.virune');
	let mutated = false;
	const provider = mutatingProvider(module, () => { mutated = true; });
	assert.throws(
		() => checkModule(module, {
			containingFile: '/virtual/direct-check-source-mutation.virune',
			platform: 'node',
			jsInteropProvider: provider,
		}),
		/Cannot register checked semantic after its source-authored AST changed during check/u,
	);
	assert.equal(mutated, true, 'test must exercise source mutation from inside provider resolution');
	assert.equal(module.imports[0]?.typeOnly, true);
});

test('experimental TypeChecker rejects provider mutation of source-authored AST during the check', () => {
	const path = '/virtual/type-checker-source-mutation.virune';
	const module = parsedModule(path);
	let mutated = false;
	const checker = new TypeChecker({
		containingFile: path,
		platform: 'node',
		jsInteropProvider: mutatingProvider(module, () => { mutated = true; }),
	});
	assert.throws(
		() => checker.check(module),
		/Cannot register checked semantic after its source-authored AST changed during check/u,
	);
	assert.equal(mutated, true, 'test must exercise source mutation from inside provider resolution');
	assert.equal(module.imports[0]?.typeOnly, true);
});
