import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSource } from '../src/project/project.js';
import { externalOperationSequence } from '../src/interop/operation.js';
import type { InteropSemanticModel, ModuleResolutionWitness } from '../src/interop/types.js';

function witness(moduleSpecifier: string): ModuleResolutionWitness {
	return {
		moduleSpecifier,
		runtimeEntry: `dist/${moduleSpecifier.replace(/^\.\//u, '')}`,
		runtimeFormat: 'esm',
		conditions: ['types', 'import', 'node'],
		platform: 'node',
		providerVersion: 'test-provider-1',
		packageJsonHash: 'a'.repeat(64),
	};
}

test('named, default, namespace, and side-effect imports become one ModuleLoad each while type-only imports do not', () => {
	const source = {
		id: 1,
		path: '/virtual/import-forms.virune',
		text: [
			'import js { named } from "./named.js"',
			'import js defaultValue from "./default.js"',
			'import js * as namespace from "./namespace.js"',
			'import js "./side-effect.js"',
			'import js type { Shape } from "./types.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'}',
			'',
		].join('\n'),
	};
	const parsed = parseSource(source);
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const interop: InteropSemanticModel = {
		usages: [],
		usageIR: [],
		moduleWitnesses: [
			witness('./named.js'),
			witness('./default.js'),
			witness('./namespace.js'),
			witness('./side-effect.js'),
			witness('./types.js'),
		],
		requiresJavaScriptInitialization: true,
	};

	const operations = externalOperationSequence({ module: parsed.ast, interop, diagnostics: [] });
	assert.deepEqual(operations.map(operation => operation.kind), [
		'module-load',
		'module-load',
		'module-load',
		'module-load',
	]);
	assert.deepEqual(
		operations.map(operation => operation.kind === 'module-load' ? operation.moduleSpecifier : undefined),
		['./named.js', './default.js', './namespace.js', './side-effect.js'],
	);
	for (const operation of operations) {
		assert.equal(operation.decision.status, 'resolved');
		assert.equal(operation.decision.mechanism, 'direct');
	}
});

test('multiple named bindings still produce one ModuleLoad and require mutually consistent runtime witnesses', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/multi-binding.virune',
		text: 'import js { first, second } from "./library.js"\n',
	});
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const consistent: InteropSemanticModel = {
		usages: [],
		usageIR: [],
		moduleWitnesses: [witness('./library.js'), witness('./library.js')],
		requiresJavaScriptInitialization: true,
	};
	const operation = externalOperationSequence({ module: parsed.ast, interop: consistent, diagnostics: [] })[0];
	assert.equal(operation?.kind, 'module-load');
	assert.equal(operation?.decision.status, 'resolved');

	const inconsistent: InteropSemanticModel = {
		...consistent,
		moduleWitnesses: [
			witness('./library.js'),
			{ ...witness('./library.js'), runtimeEntry: 'dist/different.js' },
		],
	};
	const unresolved = externalOperationSequence({ module: parsed.ast, interop: inconsistent, diagnostics: [] })[0];
	assert.equal(unresolved?.kind, 'module-load');
	assert.equal(unresolved?.decision.status, 'unresolved');
});
