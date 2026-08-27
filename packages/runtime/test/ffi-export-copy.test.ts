import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFfiValue, makeRecord } from '../src/index.js';

// @virune-rule {"id":"ffi.export","runner":"unit","file":"packages/runtime/test/ffi-export-copy.test.ts","case":"JavaScript export encoding copies native aggregate values","kind":"positive","platform":"common"}
test('JavaScript export encoding copies native aggregate values', () => {
	const sourceItems = ['first'];
	const source = makeRecord({ items: sourceItems }, 'test:Payload') as { readonly items: readonly string[] };
	const descriptor = {
		kind: 'record' as const,
		name: 'Payload',
		fields: {
			items: { kind: 'list' as const, item: { kind: 'string' as const } },
		},
	};
	const encoded = encodeFfiValue(source, descriptor) as { items: string[] };
	assert.deepEqual(encoded, { items: ['first'] });
	assert.notEqual(encoded, source);
	assert.notEqual(encoded.items, source.items);
	encoded.items.push('second');
	assert.deepEqual(source.items, ['first']);
});
