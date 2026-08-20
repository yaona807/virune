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

test('contradictory foreign category and primitive facts fail closed', () => {
	assert.throws(
		() => externalOperationFromUsage(property({ display: 'bad', category: 'object', primitive: 'string' })),
		/category and primitive facts are inconsistent/u,
	);
	assert.throws(
		() => externalOperationFromUsage(property({ display: 'bad', category: 'primitive' })),
		/category and primitive facts are inconsistent/u,
	);
	assert.throws(
		() => externalOperationFromUsage(property({ display: 'bad', category: 'literal' })),
		/category and primitive facts are inconsistent/u,
	);
});

test('coherent primitive and non-primitive foreign shapes remain accepted', () => {
	const primitive = externalOperationFromUsage(property({ display: 'string', category: 'primitive', primitive: 'string' }));
	assert.equal(primitive?.kind, 'read-property');
	if (primitive?.kind === 'read-property') assert.equal(primitive.result.primitive, 'string');

	const literal = externalOperationFromUsage(property({ display: '"x"', category: 'literal', primitive: 'string' }));
	assert.equal(literal?.kind, 'read-property');

	const object = externalOperationFromUsage(property({ display: 'Object', category: 'object' }));
	assert.equal(object?.kind, 'read-property');
	if (object?.kind === 'read-property') assert.equal(object.result.primitive, undefined);
});
