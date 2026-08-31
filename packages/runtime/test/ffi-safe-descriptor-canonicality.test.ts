import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ForeignDecodeError,
	encodeFfiValue,
	makeRecord,
	validateFfiValue,
	type FfiTypeDescriptor,
} from '../src/index.js';

function safeRecordBoundary(field: Record<string, unknown>): FfiTypeDescriptor {
	return {
		version: 'virune-safe-ffi/v1',
		type: { kind: 'record', name: 'Payload', fields: { value: field } },
	} as unknown as FfiTypeDescriptor;
}

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-safe-descriptor-canonicality.test.ts","case":"partial Safe record field metadata fails closed","kind":"negative","platform":"common"}
test('partial Safe record field metadata fails closed', () => {
	const malformed = [
		safeRecordBoundary({ type: { kind: 'unknown' }, hasDefault: true }),
		safeRecordBoundary({ type: { kind: 'unknown' }, defaultValue: 'fallback' }),
		safeRecordBoundary({ type: { kind: 'unknown' }, hasDefault: false, defaultValue: 'fallback' }),
		safeRecordBoundary({ type: { kind: 'unknown' }, missingAsNone: true }),
		safeRecordBoundary({ type: { kind: 'unknown' }, omitWhenNone: true }),
		safeRecordBoundary({ type: { kind: 'unknown' }, missingAsNone: false, omitWhenNone: false }),
	];
	for (const descriptor of malformed) {
		assert.throws(() => validateFfiValue({ value: 'foreign' }, descriptor), ForeignDecodeError);
		assert.throws(() => encodeFfiValue(makeRecord({ value: 'native' }, 'Payload'), descriptor), ForeignDecodeError);
	}
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-safe-descriptor-canonicality.test.ts","case":"Safe record default metadata preserves an explicit undefined default","kind":"positive","platform":"common"}
test('Safe record default metadata preserves an explicit undefined default', () => {
	const descriptor = safeRecordBoundary({ type: { kind: 'unknown' }, hasDefault: true, defaultValue: undefined });
	assert.deepEqual(encodeFfiValue(makeRecord({ value: 'native' }, 'Payload'), descriptor), { value: 'native' });
});
