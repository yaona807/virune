import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForeignUsageIR, ModuleResolutionWitness } from '../src/interop/types.js';
import {
	externalModuleLoadOperation,
	externalOperationFromUsage,
} from '../src/interop/operation.js';
import { isResolvedDirectInteropDecision } from '../src/interop/decision.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

const stableString = {
	display: 'string',
	category: 'primitive' as const,
	primitive: 'string' as const,
	origin: {
		moduleSpecifier: './library.js',
		exportName: 'value',
	},
};

function usage(overrides: Partial<ForeignUsageIR>): ForeignUsageIR {
	return {
		kind: 'property',
		nodeId: 1,
		span,
		foreignType: stableString,
		...overrides,
	};
}

test('import usages never infer ModuleLoad semantics from bound-value observations', () => {
	const operation = externalOperationFromUsage(usage({
		kind: 'import',
		runtimeImport: { kind: 'type-only' },
		moduleWitness: witness(),
	}));
	assert.equal(operation, undefined);
});

test('ModuleLoad is declaration-level evidence and strips provider-private witness metadata', () => {
	const providerPrivate = '/temporary/provider/private.d.ts';
	const operation = externalModuleLoadOperation({
		nodeId: 3,
		span,
		moduleSpecifier: './library.js',
		witness: {
			...witness(),
			conditions: ['types', 'import', 'node'],
			providerPrivate,
		} as unknown as ModuleResolutionWitness,
	});

	assert.equal(operation.kind, 'module-load');
	assert.deepEqual(operation.witness.conditions, ['types', 'import', 'node'], 'condition precedence is semantic order, not a set');
	assert.equal(isResolvedDirectInteropDecision(operation.decision), true);
	const serialized = JSON.stringify(operation);
	assert.equal(serialized.includes('providerPrivate'), false);
	assert.equal(serialized.includes(providerPrivate), false);
});

test('current property/call/await observations map to explicit Direct operations without stronger library claims', () => {
	const property = externalOperationFromUsage(usage({ kind: 'property' }));
	assert.equal(property?.kind, 'read-property');
	assert.deepEqual(property?.decision.claims, []);

	const call = externalOperationFromUsage(usage({ kind: 'call', receiverMode: 'preserve-this', mayReject: false }));
	assert.equal(call?.kind, 'call');
	assert.deepEqual(call?.decision.claims, ['receiver-preserved']);
	if (call?.kind === 'call') {
		assert.equal(call.receiverMode, 'preserve-this');
		assert.equal(call.mayReject, false);
	}

	const awaited = externalOperationFromUsage(usage({ kind: 'await', mayReject: true }));
	assert.equal(awaited?.kind, 'await');
	if (awaited?.kind === 'await') assert.equal(awaited.mayReject, true);
});

test('call and await observations fail closed when required execution semantics are partial', () => {
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'call', mayReject: false })),
		/requires a known receiver mode/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'call', receiverMode: 'none' })),
		/requires explicit rejection semantics/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'await' })),
		/requires explicit rejection semantics/u,
	);
});

test('primitive bridge evidence drops ephemeral TypeId and unknown provider metadata', () => {
	const privatePath = '/checkout/private/provider.ts';
	const operation = externalOperationFromUsage(usage({
		kind: 'bridge',
		foreignType: {
			...stableString,
			origin: {
				...stableString.origin,
				providerPrivatePath: privatePath,
			} as unknown as typeof stableString.origin,
			providerPrivatePath: privatePath,
		} as unknown as ForeignUsageIR['foreignType'],
		bridge: {
			kind: 'primitive',
			bridge: 'string',
			targetType: 987654,
		},
	}));

	assert.equal(operation?.kind, 'bridge-foreign-primitive');
	if (operation?.kind === 'bridge-foreign-primitive') {
		assert.equal(operation.bridge, 'string');
		assert.deepEqual(operation.decision.claims, ['primitive-bridge-validated']);
	}
	const serialized = JSON.stringify(operation);
	assert.equal(serialized.includes('987654'), false, 'compiler TypeId must not enter stable operation evidence');
	assert.equal(serialized.includes('providerPrivatePath'), false);
	assert.equal(serialized.includes(privatePath), false);
});

test('ModuleLoad refuses an empty module specifier', () => {
	assert.throws(
		() => externalModuleLoadOperation({ nodeId: 1, span, moduleSpecifier: '', witness: witness() }),
		/requires a module specifier/u,
	);
});

function witness(): ModuleResolutionWitness {
	return {
		moduleSpecifier: './library.js',
		declarationEntry: 'types/library.d.ts',
		runtimeEntry: 'dist/library.js',
		runtimeFormat: 'esm',
		conditions: ['types', 'import', 'node'],
		platform: 'node',
		providerVersion: 'test-provider-1',
		declarationGraphHash: 'a'.repeat(64),
		packageJsonHash: 'b'.repeat(64),
	};
}
