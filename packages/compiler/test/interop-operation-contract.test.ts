import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildExternalOperationSequence,
	externalModuleLoadOperation,
	externalOperationFromUsage,
} from '../src/interop/operation.js';
import type { ForeignOrigin, ForeignUsageIR, InteropSemanticModel, ModuleResolutionWitness } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

function witness(moduleSpecifier: string): ModuleResolutionWitness {
	return {
		moduleSpecifier,
		runtimeEntry: 'dist/index.js',
		runtimeFormat: 'esm',
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'test-provider',
	};
}

test('named, default, and namespace imports each produce one deterministic ModuleLoad', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: [
			'import js { value } from "./named.js"',
			'import js client from "./default.js"',
			'import js * as tools from "./namespace.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\treturn Unit',
			'}',
			'',
		].join('\n'),
	});
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const interop: InteropSemanticModel = {
		usages: [],
		usageIR: [],
		moduleWitnesses: [witness('./named.js'), witness('./default.js'), witness('./namespace.js')],
		requiresJavaScriptInitialization: true,
	};
	const operations = buildExternalOperationSequence({ module: parsed.ast, interop, diagnostics: [] });
	assert.deepEqual(
		operations.map(operation => operation.kind === 'module-load' ? operation.moduleSpecifier : undefined),
		['./named.js', './default.js', './namespace.js'],
	);
});

test('ModuleLoad stable evidence rejects absolute checkout module specifiers', () => {
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: '/checkout/private/library.js',
			witnesses: [witness('/checkout/private/library.js')],
		}),
		/module specifier must not contain an absolute or provider-private path/u,
	);
});

test('ModuleLoad validates platform and builtin runtime-witness coherence', () => {
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: './library.js',
			witnesses: [{ ...witness('./library.js'), runtimeFormat: 'commonjs', platform: 'browser' }],
		}),
		/CommonJS runtime format requires the node platform/u,
	);
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: 'fs',
			witnesses: [{ ...witness('fs'), runtimeEntry: 'node:path', runtimeFormat: 'builtin', platform: 'node' }],
		}),
		/builtin runtime entry must match the imported module specifier/u,
	);

	const bareBuiltin = externalModuleLoadOperation({
		nodeId: 1,
		span,
		moduleSpecifier: 'fs',
		witnesses: [{ ...witness('fs'), runtimeEntry: 'node:fs', runtimeFormat: 'builtin', platform: 'node' }],
	});
	assert.equal(bareBuiltin.decision.status, 'resolved');
});

test('ordinary and receiver-preserving calls retain distinct receiver semantics without stronger claims', () => {
	const base: ForeignUsageIR = {
		kind: 'call',
		nodeId: 1,
		span,
		foreignType: { display: 'string', category: 'primitive', primitive: 'string' },
		receiverMode: 'none',
		mayReject: false,
	};
	const ordinary = externalOperationFromUsage(base);
	const member = externalOperationFromUsage({ ...base, nodeId: 2, receiverMode: 'preserve-this' });
	assert.equal(ordinary?.kind, 'call');
	assert.equal(member?.kind, 'call');
	if (ordinary?.kind === 'call') {
		assert.equal(ordinary.receiverMode, 'none');
		assert.deepEqual(ordinary.decision.claims, []);
	}
	if (member?.kind === 'call') {
		assert.equal(member.receiverMode, 'preserve-this');
		assert.deepEqual(member.decision.claims, ['receiver-preserved']);
	}
});

test('enumerable and non-enumerable declaration navigation metadata never enters stable value evidence', () => {
	const origin: ForeignOrigin = {
		moduleSpecifier: './library.js',
		declarationPath: '/checkout/a/library.d.ts',
	};
	Object.defineProperty(origin, 'providerNavigation', {
		enumerable: false,
		value: '/checkout/a/provider-private.d.ts',
	});
	const operation = externalOperationFromUsage({
		kind: 'property',
		nodeId: 1,
		span,
		foreignType: {
			display: 'Value',
			category: 'object',
			origin,
		},
	});
	const serialized = JSON.stringify(operation);
	assert.equal(serialized.includes('declarationPath'), false);
	assert.equal(serialized.includes('providerNavigation'), false);
	assert.equal(serialized.includes('/checkout/a/'), false);
});
