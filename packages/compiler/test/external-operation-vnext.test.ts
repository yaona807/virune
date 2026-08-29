import assert from 'node:assert/strict';
import test from 'node:test';
import { externalOperationFromUsage } from '../src/interop/operation.js';
import type { ForeignUsageIR, StableForeignTypeSnapshot } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 10, line: 2, column: 3 },
	end: { offset: 20, line: 2, column: 13 },
};

const objectType: StableForeignTypeSnapshot = {
	display: 'ExternalObject',
	category: 'object',
	origin: { moduleSpecifier: './library.js', exportName: 'value' },
};

const resultType: StableForeignTypeSnapshot = {
	display: 'string',
	category: 'primitive',
	primitive: 'string',
};

function usage(input: Omit<ForeignUsageIR, 'nodeId' | 'span'>): ForeignUsageIR {
	return { nodeId: 7, span, ...input };
}

test('projects proven External index and write usages into JavaScript-effectful operations', () => {
	assert.deepEqual(externalOperationFromUsage(usage({ kind: 'index', foreignType: resultType })), {
		kind: 'read-index',
		nodeId: 7,
		span: { start: span.start, end: span.end },
		effect: 'JavaScript',
		result: { category: 'primitive', primitive: 'string' },
		decision: { status: 'resolved', mechanism: 'direct', authoring: 'none', claims: [], obligations: [] },
	});
	assert.deepEqual(externalOperationFromUsage(usage({ kind: 'write-property', foreignType: objectType, property: 'name' })), {
		kind: 'write-property',
		nodeId: 7,
		span: { start: span.start, end: span.end },
		effect: 'JavaScript',
		target: { category: 'object', origin: { moduleSpecifier: './library.js', exportName: 'value' } },
		property: 'name',
		decision: { status: 'resolved', mechanism: 'direct', authoring: 'none', claims: [], obligations: [] },
	});
	assert.deepEqual(externalOperationFromUsage(usage({ kind: 'write-index', foreignType: objectType })), {
		kind: 'write-index',
		nodeId: 7,
		span: { start: span.start, end: span.end },
		effect: 'JavaScript',
		target: { category: 'object', origin: { moduleSpecifier: './library.js', exportName: 'value' } },
		decision: { status: 'resolved', mechanism: 'direct', authoring: 'none', claims: [], obligations: [] },
	});
});

test('projects construct usage only with explicit receiver-none semantics', () => {
	assert.deepEqual(externalOperationFromUsage(usage({ kind: 'construct', foreignType: objectType, receiverMode: 'none', mayReject: false })), {
		kind: 'construct',
		nodeId: 7,
		span: { start: span.start, end: span.end },
		effect: 'JavaScript',
		result: { category: 'object', origin: { moduleSpecifier: './library.js', exportName: 'value' } },
		decision: { status: 'resolved', mechanism: 'direct', authoring: 'none', claims: [], obligations: [] },
	});
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'construct', foreignType: objectType, receiverMode: 'preserve-this', mayReject: false })),
		/receiver mode none/u,
	);
});

test('new External operation evidence rejects any and malformed property names', () => {
	const anyType: StableForeignTypeSnapshot = { display: 'any', category: 'any' };
	for (const kind of ['index', 'write-index', 'construct'] as const) {
		assert.throws(
			() => externalOperationFromUsage(usage({
				kind,
				foreignType: anyType,
				...(kind === 'construct' ? { receiverMode: 'none' as const, mayReject: false } : {}),
			})),
			/any cannot become successful External operation evidence/u,
		);
	}
	for (const property of ['', 'bad\nname', '/absolute']) {
		assert.throws(
			() => externalOperationFromUsage(usage({ kind: 'write-property', foreignType: objectType, property })),
			/property name/u,
		);
	}
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'write-property', foreignType: objectType })),
		/requires a property name/u,
	);
});
