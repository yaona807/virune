import assert from 'node:assert/strict';
import test from 'node:test';
import { externalModuleLoadOperation, externalOperationFromUsage } from '../src/interop/operation.js';
import type { ForeignUsageIR, ModuleResolutionWitness } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

const stableString = {
	display: 'string',
	category: 'primitive' as const,
	primitive: 'string' as const,
	origin: { moduleSpecifier: './library.js', exportName: 'value' },
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

test('property, call, and await operations retain the checker JavaScript effect explicitly', () => {
	const property = externalOperationFromUsage(usage({ kind: 'property' }));
	const call = externalOperationFromUsage(usage({ kind: 'call', receiverMode: 'none', mayReject: false }));
	const awaited = externalOperationFromUsage(usage({ kind: 'await', mayReject: true }));

	assert.equal(property?.kind, 'read-property');
	assert.equal(call?.kind, 'call');
	assert.equal(awaited?.kind, 'await');
	if (property?.kind === 'read-property') assert.equal(property.effect, 'JavaScript');
	if (call?.kind === 'call') assert.equal(call.effect, 'JavaScript');
	if (awaited?.kind === 'await') assert.equal(awaited.effect, 'JavaScript');
});

test('ModuleLoad and primitive bridge do not acquire a function JavaScript-effect claim by implication', () => {
	const witness: ModuleResolutionWitness = {
		moduleSpecifier: './library.js',
		runtimeEntry: 'dist/library.js',
		runtimeFormat: 'esm',
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'test-provider-1',
	};
	const moduleLoad = externalModuleLoadOperation({
		nodeId: 1,
		span,
		moduleSpecifier: './library.js',
		witnesses: [witness],
	});
	const bridge = externalOperationFromUsage(usage({
		kind: 'bridge',
		bridge: { kind: 'primitive', bridge: 'string', targetType: 1 },
	}));

	assert.equal('effect' in moduleLoad, false);
	assert.equal(bridge?.kind, 'bridge-foreign-primitive');
	if (bridge?.kind === 'bridge-foreign-primitive') assert.equal('effect' in bridge, false);
});
