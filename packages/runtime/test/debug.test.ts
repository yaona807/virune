import assert from 'node:assert/strict';
import test from 'node:test';
import { debugValue, makeRecord } from '../src/index.js';

// @virune-rule {"id":"runtime.debug","runner":"unit","file":"packages/runtime/test/debug.test.ts","case":"Debug formatting is stable for supported record values","kind":"positive","platform":"common"}
test('Debug formatting is stable for supported record values', () => {
	const value = makeRecord({ name: 'Alice', count: 2 }, 'test:User');
	assert.equal(debugValue(value), '{"name":"Alice","count":2}');
	assert.equal(debugValue(value), '{"name":"Alice","count":2}');
});
