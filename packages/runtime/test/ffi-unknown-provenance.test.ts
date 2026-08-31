import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ForeignContractError,
	ForeignDecodeError,
	encodeFfiValue,
	makeRecord,
	panic,
	rootTaskContext,
	safeCall,
	safeCallAsync,
	validateFfiValue,
	type FfiTypeDescriptor,
	type JsError,
} from '../src/index.js';

const provenanceUnknown = { version: 'virune-safe-ffi/v1', type: { kind: 'unknown' } } as unknown as FfiTypeDescriptor;

type SafeCallAsyncWithDecoder = <T>(
	operation: () => PromiseLike<T>,
	decoder: (value: T) => T,
) => ReturnType<typeof safeCallAsync<T>>;

function errorFrom(result: ReturnType<typeof safeCall>): JsError {
	assert.equal(result.$tag, 'Err');
	return result.$values[0] as JsError;
}

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"foreign Unknown preserves identity while native identity values fail closed","kind":"positive","platform":"common"}
test('foreign Unknown preserves identity while native identity values fail closed', () => {
	const foreign = { token: 1 };
	const decoded = validateFfiValue(foreign, provenanceUnknown);
	assert.strictEqual(decoded, foreign);
	assert.strictEqual(encodeFfiValue(decoded, provenanceUnknown), foreign);

	for (const primitive of ['value', true, 1.5, 7n, undefined, null] as const) {
		assert.strictEqual(encodeFfiValue(primitive, provenanceUnknown), primitive);
	}

	const nativeRecord = makeRecord({ token: 1 }, 'test:NativeRecord');
	assert.throws(() => encodeFfiValue(nativeRecord, provenanceUnknown), ForeignContractError);
	assert.throws(() => encodeFfiValue(['native-list'], provenanceUnknown), ForeignContractError);
	assert.throws(() => encodeFfiValue(() => 'native-callable', provenanceUnknown), ForeignContractError);
	assert.throws(() => encodeFfiValue(rootTaskContext(), provenanceUnknown), ForeignContractError);
	assert.throws(() => encodeFfiValue({ token: 'fabricated' }, provenanceUnknown), ForeignContractError);
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"nested Safe Unknown leaves preserve foreign identity and reject native identity values","kind":"positive","platform":"common"}
test('nested Safe Unknown leaves preserve foreign identity and reject native identity values', () => {
	const listBoundary = {
		version: 'virune-safe-ffi/v1',
		type: { kind: 'list', item: { kind: 'unknown' } },
	} as unknown as FfiTypeDescriptor;
	const recordBoundary = {
		version: 'virune-safe-ffi/v1',
		type: { kind: 'record', name: 'Payload', fields: { value: { kind: 'unknown' } } },
	} as unknown as FfiTypeDescriptor;
	const foreignListValue = { token: 'list' };
	const decodedList = validateFfiValue([foreignListValue], listBoundary) as readonly unknown[];
	assert.strictEqual(decodedList[0], foreignListValue);
	const encodedList = encodeFfiValue(decodedList, listBoundary) as readonly unknown[];
	assert.strictEqual(encodedList[0], foreignListValue);

	const foreignRecordValue = { token: 'record' };
	const decodedRecord = validateFfiValue({ value: foreignRecordValue }, recordBoundary) as { readonly value: unknown };
	assert.strictEqual(decodedRecord.value, foreignRecordValue);
	const encodedRecord = encodeFfiValue(decodedRecord, recordBoundary) as { readonly value: unknown };
	assert.strictEqual(encodedRecord.value, foreignRecordValue);

	assert.throws(() => encodeFfiValue([makeRecord({ token: 1 }, 'test:NestedNative')], listBoundary), ForeignContractError);
	const nativeOuter = makeRecord({ value: ['native-nested-list'] }, 'Payload');
	assert.throws(() => encodeFfiValue(nativeOuter, recordBoundary), ForeignContractError);
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"legacy ABI v2 unknown remains pass through","kind":"positive","platform":"common"}
test('legacy ABI v2 unknown remains pass through', () => {
	const nativeRecord = makeRecord({ token: 1 }, 'test:NativeRecord');
	assert.strictEqual(validateFfiValue(nativeRecord, { kind: 'unknown' }), nativeRecord);
	assert.strictEqual(encodeFfiValue(nativeRecord, { kind: 'unknown' }), nativeRecord);
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"malformed, fabricated, or stale provenance descriptors fail closed","kind":"negative","platform":"common"}
test('malformed, fabricated, or stale provenance descriptors fail closed', () => {
	const partial = { version: 'virune-safe-ffi/v1' } as unknown as FfiTypeDescriptor;
	const stale = { version: 'virune-safe-ffi/v0', type: { kind: 'unknown' } } as unknown as FfiTypeDescriptor;
	const fabricated = { version: 'virune-safe-ffi/v1', type: { kind: 'unknown' }, trusted: true } as unknown as FfiTypeDescriptor;
	const fabricatedInner = { version: 'virune-safe-ffi/v1', type: { kind: 'unknown', trusted: true } } as unknown as FfiTypeDescriptor;
	const fabricatedNested = { version: 'virune-safe-ffi/v1', type: { kind: 'list', item: { kind: 'unknown', trusted: true } } } as unknown as FfiTypeDescriptor;
	const hybrid = { kind: 'unknown', version: 'virune-safe-ffi/v1', type: { kind: 'unknown' } } as unknown as FfiTypeDescriptor;
	const staleHybrid = { kind: 'unknown', version: 'virune-safe-ffi/v0', type: { kind: 'unknown' } } as unknown as FfiTypeDescriptor;
	const sparseItems = new Array<FfiTypeDescriptor>(1);
	const sparseTuple = { version: 'virune-safe-ffi/v1', type: { kind: 'tuple', items: sparseItems } } as unknown as FfiTypeDescriptor;
	const decoratedItems: FfiTypeDescriptor[] = [{ kind: 'unknown' }];
	Object.defineProperty(decoratedItems, 'trusted', { value: true, enumerable: true });
	const decoratedTuple = { version: 'virune-safe-ffi/v1', type: { kind: 'tuple', items: decoratedItems } } as unknown as FfiTypeDescriptor;
	const symbolFields: Record<string, FfiTypeDescriptor> = {};
	Object.defineProperty(symbolFields, Symbol('trusted'), { value: { kind: 'unknown' }, enumerable: true });
	const symbolRecord = { version: 'virune-safe-ffi/v1', type: { kind: 'record', name: 'Payload', fields: symbolFields } } as unknown as FfiTypeDescriptor;
	for (const descriptor of [partial, stale, fabricated, fabricatedInner, fabricatedNested, hybrid, staleHybrid, sparseTuple, decoratedTuple, symbolRecord]) {
		assert.throws(() => validateFfiValue({}, descriptor), ForeignDecodeError);
		assert.throws(() => encodeFfiValue({}, descriptor), ForeignDecodeError);
	}
});

// @virune-rule {"id":"ffi.safe","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"legacy public error helpers remain compatible while generated async decode path distinguishes failures","kind":"positive","platform":"common"}
test('legacy public error helpers remain compatible while generated async decode path distinguishes failures', async () => {
	const thrown = errorFrom(safeCall(() => { throw new Error('sync'); }));
	assert.equal(thrown.name, 'Error');
	assert.equal(thrown.message, 'sync');

	const legacyRejected = await safeCallAsync(() => Promise.reject(new Error('async')));
	assert.equal(legacyRejected.$tag, 'Err');
	assert.equal((legacyRejected.$values[0] as JsError).name, 'Error');
	assert.equal((legacyRejected.$values[0] as JsError).message, 'async');

	const legacyPanic = errorFrom(safeCall(() => panic('legacy-visible')));
	assert.equal(legacyPanic.name, 'VirunePanic');
	assert.equal(legacyPanic.message, 'legacy-visible');

	const withDecoder = safeCallAsync as unknown as SafeCallAsyncWithDecoder;
	const rejectionCause = { source: 'promise' };
	const rejected = await withDecoder(() => Promise.reject(new Error('async', { cause: rejectionCause })), value => value);
	assert.equal(rejected.$tag, 'Err');
	const rejection = rejected.$values[0] as JsError;
	assert.equal(rejection.name, 'PromiseRejectionError');
	assert.equal(rejection.message, 'async');
	assert.equal(typeof rejection.stack, 'string');
	assert.strictEqual(rejection.cause, rejectionCause);

	const syncBeforePromise = await withDecoder(() => { throw new Error('before-promise'); }, value => value);
	assert.equal(syncBeforePromise.$tag, 'Err');
	assert.equal((syncBeforePromise.$values[0] as JsError).name, 'Error');
	assert.equal((syncBeforePromise.$values[0] as JsError).message, 'before-promise');

	const contract = await withDecoder(() => Promise.resolve(1), value => validateFfiValue(value, { kind: 'string' }) as number);
	assert.equal(contract.$tag, 'Err');
	assert.equal((contract.$values[0] as JsError).name, 'ForeignContractError');

	const decode = await withDecoder(
		() => Promise.resolve({}),
		value => validateFfiValue(value, { kind: 'record', name: 'Payload', fields: { value: { kind: 'string' } } }) as Record<string, unknown>,
	);
	assert.equal(decode.$tag, 'Err');
	assert.equal((decode.$values[0] as JsError).name, 'ForeignDecodeError');
});