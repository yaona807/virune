import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ForeignDecodeError,
	encodeFfiValue,
	makeRecord,
	makeVariant,
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
		safeRecordBoundary({ type: { kind: 'unknown' }, jsName: undefined }),
		safeRecordBoundary({ type: { kind: 'unknown' }, jsonName: undefined }),
	];
	for (const descriptor of malformed) {
		assert.throws(() => validateFfiValue({ value: 'foreign' }, descriptor), ForeignDecodeError);
		assert.throws(() => encodeFfiValue(makeRecord({ value: 'native' }, 'Payload'), descriptor), ForeignDecodeError);
	}
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-safe-descriptor-canonicality.test.ts","case":"undefined Safe optional descriptor metadata fails closed","kind":"negative","platform":"common"}
test('undefined Safe optional descriptor metadata fails closed', () => {
	const malformed = [
		{ version: 'virune-safe-ffi/v1', type: { kind: 'option', value: { kind: 'unknown' }, noneAs: undefined } },
		{ version: 'virune-safe-ffi/v1', type: { kind: 'record', name: 'Payload', fields: {}, typeId: undefined } },
		{ version: 'virune-safe-ffi/v1', type: { kind: 'record', name: 'Payload', fields: {}, strict: undefined } },
		{ version: 'virune-safe-ffi/v1', type: { kind: 'record', name: 'Payload', fields: {}, allowClassInstance: undefined } },
		{ version: 'virune-safe-ffi/v1', type: { kind: 'enum', name: 'Payload', variants: {}, typeId: undefined } },
	] as unknown as readonly FfiTypeDescriptor[];
	for (const descriptor of malformed) {
		assert.throws(() => validateFfiValue({}, descriptor), ForeignDecodeError);
		assert.throws(() => encodeFfiValue({}, descriptor), ForeignDecodeError);
	}
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-safe-descriptor-canonicality.test.ts","case":"inherited Safe descriptor metadata cannot override an own field descriptor","kind":"negative","platform":"common"}
test('inherited Safe descriptor metadata cannot override an own field descriptor', () => {
	const inheritedType = Object.create({ type: { kind: 'unknown' } }) as Record<string, unknown>;
	Object.defineProperty(inheritedType, 'kind', { value: 'string', enumerable: true, configurable: true, writable: true });
	const descriptor = safeRecordBoundary(inheritedType);
	const identity = { token: 'foreign' };
	assert.throws(() => validateFfiValue({ value: identity }, descriptor), ForeignDecodeError);
	assert.throws(() => encodeFfiValue(makeRecord({ value: identity }, 'Payload'), descriptor), ForeignDecodeError);
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-safe-descriptor-canonicality.test.ts","case":"non-enumerable Safe descriptor map entries cannot bypass validation","kind":"negative","platform":"common"}
test('non-enumerable Safe descriptor map entries cannot bypass validation', () => {
	const variants: Record<string, unknown> = {};
	Object.defineProperty(variants, 'Hidden', {
		value: [{ kind: 'unknown', trusted: true }],
		enumerable: false,
		configurable: true,
		writable: true,
	});
	const descriptor = {
		version: 'virune-safe-ffi/v1',
		type: { kind: 'enum', name: 'Payload', variants },
	} as unknown as FfiTypeDescriptor;
	const value = makeVariant('Hidden', [{ token: 'foreign' }], 'Payload');
	assert.throws(() => validateFfiValue(value, descriptor), ForeignDecodeError);
	assert.throws(() => encodeFfiValue(value, descriptor), ForeignDecodeError);
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-safe-descriptor-canonicality.test.ts","case":"custom Safe descriptor array prototypes cannot replace traversal methods","kind":"negative","platform":"common"}
test('custom Safe descriptor array prototypes cannot replace traversal methods', () => {
	const items = [{ kind: 'unknown' }];
	Object.setPrototypeOf(items, {
		map: () => [],
		forEach: () => undefined,
	});
	const descriptor = {
		version: 'virune-safe-ffi/v1',
		type: { kind: 'tuple', items },
	} as unknown as FfiTypeDescriptor;
	const value = [{ token: 'foreign' }];
	assert.throws(() => validateFfiValue(value, descriptor), ForeignDecodeError);
	assert.throws(() => encodeFfiValue(value, descriptor), ForeignDecodeError);
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-safe-descriptor-canonicality.test.ts","case":"Safe record default metadata preserves an explicit undefined default","kind":"positive","platform":"common"}
test('Safe record default metadata preserves an explicit undefined default', () => {
	const descriptor = safeRecordBoundary({ type: { kind: 'unknown' }, hasDefault: true, defaultValue: undefined });
	assert.deepEqual(encodeFfiValue(makeRecord({ value: 'native' }, 'Payload'), descriptor), { value: 'native' });
});
