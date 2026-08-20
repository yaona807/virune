import assert from 'node:assert/strict';
import test from 'node:test';
import { externalOperationFromUsage } from '../src/interop/operation.js';
import type { ForeignUsageIR } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

function property(foreignType: ForeignUsageIR['foreignType']): ForeignUsageIR {
	return { kind: 'property', nodeId: 1, span, foreignType };
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
