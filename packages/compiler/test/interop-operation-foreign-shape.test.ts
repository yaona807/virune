import assert from 'node:assert/strict';
import test from 'node:test';
import { externalOperationFromUsage } from '../src/interop/operation.js';
import type { ForeignUsageIR, PrimitiveBridgeKind } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

function property(foreignType: ForeignUsageIR['foreignType']): ForeignUsageIR {
	return { kind: 'property', nodeId: 1, span, foreignType };
}

function bridge(foreignType: ForeignUsageIR['foreignType'], bridgeKind: PrimitiveBridgeKind): ForeignUsageIR {
	return {
		kind: 'bridge',
		nodeId: 1,
		span,
		foreignType,
		bridge: { kind: 'primitive', bridge: bridgeKind, targetType: 1 },
	};
}

test('preserves independently recorded foreign category and primitive facts from existing provider contracts', () => {
	for (const foreignType of [
		{ display: 'provider-object', category: 'object', primitive: 'string' },
		{ display: 'provider-primitive', category: 'primitive' },
		{ display: 'provider-literal', category: 'literal' },
	] as const) {
		const operation = externalOperationFromUsage(property(foreignType));
		assert.equal(operation?.kind, 'read-property');
		if (operation?.kind === 'read-property') {
			assert.equal(operation.result.category, foreignType.category);
			assert.equal(operation.result.primitive, 'primitive' in foreignType ? foreignType.primitive : undefined);
		}
	}
});

test('known primitive and non-primitive foreign shapes remain accepted', () => {
	const primitive = externalOperationFromUsage(property({ display: 'string', category: 'primitive', primitive: 'string' }));
	assert.equal(primitive?.kind, 'read-property');
	if (primitive?.kind === 'read-property') assert.equal(primitive.result.primitive, 'string');

	const literal = externalOperationFromUsage(property({ display: '"x"', category: 'literal', primitive: 'string' }));
	assert.equal(literal?.kind, 'read-property');

	const object = externalOperationFromUsage(property({ display: 'Object', category: 'object' }));
	assert.equal(object?.kind, 'read-property');
	if (object?.kind === 'read-property') assert.equal(object.result.primitive, undefined);
});

test('TypeScript any cannot become resolved Direct operation evidence', () => {
	const anyShape = { display: 'any', category: 'any' as const };
	for (const usage of [
		property(anyShape),
		{ kind: 'call', nodeId: 1, span, foreignType: anyShape, receiverMode: 'none', mayReject: false },
		{ kind: 'await', nodeId: 1, span, foreignType: anyShape, mayReject: true },
	] satisfies ForeignUsageIR[]) {
		assert.throws(
			() => externalOperationFromUsage(usage),
			/TypeScript any/u,
		);
	}
});

test('only runtime-validated primitive bridges acquire a primitive validation claim', () => {
	for (const [bridgeKind, foreignType] of [
		['string', { display: 'string', category: 'primitive', primitive: 'string' }],
		['bool', { display: 'boolean', category: 'primitive', primitive: 'boolean' }],
		['float', { display: 'number', category: 'primitive', primitive: 'number' }],
		['bigint', { display: 'bigint', category: 'primitive', primitive: 'bigint' }],
		['unit', { display: 'void', category: 'primitive', primitive: 'void' }],
	] as const) {
		const operation = externalOperationFromUsage(bridge(foreignType, bridgeKind));
		assert.equal(operation?.kind, 'bridge-foreign-primitive');
		if (operation?.kind === 'bridge-foreign-primitive') {
			assert.deepEqual(operation.decision.claims, ['primitive-bridge-validated']);
		}
	}

	const providerSpecificCategory = externalOperationFromUsage(bridge(
		{ display: 'provider-object', category: 'object', primitive: 'string' },
		'string',
	));
	assert.equal(providerSpecificCategory?.kind, 'bridge-foreign-primitive');
	if (providerSpecificCategory?.kind === 'bridge-foreign-primitive') {
		assert.deepEqual(providerSpecificCategory.decision.claims, ['primitive-bridge-validated']);
	}
});

test('opaque foreign Unknown preserves existing Direct compatibility without claiming runtime primitive validation', () => {
	const operation = externalOperationFromUsage(bridge({ display: 'unknown', category: 'unknown' }, 'unknown'));
	assert.equal(operation?.kind, 'bridge-foreign-primitive');
	if (operation?.kind !== 'bridge-foreign-primitive') return;
	assert.equal(operation.decision.status, 'resolved');
	assert.equal(operation.decision.mechanism, 'direct');
	assert.deepEqual(operation.decision.claims, []);
});

test('aggregate, mismatched primitive, or non-Unknown source facts cannot gain a validated primitive bridge claim', () => {
	for (const usage of [
		bridge({ display: 'Object', category: 'object' }, 'string'),
		bridge({ display: 'number', category: 'primitive', primitive: 'number' }, 'string'),
		bridge({ display: 'string', category: 'primitive', primitive: 'string' }, 'unknown'),
		bridge({ display: 'Object', category: 'object' }, 'unknown'),
	]) {
		assert.throws(
			() => externalOperationFromUsage(usage),
			/primitive bridge evidence disagrees with foreign source facts/u,
		);
	}
});

test('unknown runtime category or primitive enum values still fail closed', () => {
	assert.throws(
		() => externalOperationFromUsage(property({ display: 'bad', category: 'future-kind' as ForeignUsageIR['foreignType']['category'] })),
		/Unknown foreign type category/u,
	);
	assert.throws(
		() => externalOperationFromUsage(property({ display: 'bad', category: 'object', primitive: 'symbol' as NonNullable<ForeignUsageIR['foreignType']['primitive']> })),
		/Unknown foreign primitive/u,
	);
});
