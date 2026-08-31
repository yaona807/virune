import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ForeignContractError,
	ForeignDecodeError,
	VirunePanic,
	encodeFfiValue,
	encodeSafeFfiValue,
	makeRecord,
	panic,
	rootTaskContext,
	safeCall,
	safeCallAsync,
	validateFfiValue,
	validateSafeFfiValue,
	type JsError,
	type SafeFfiBoundaryDescriptor,
} from '../src/index.js';

const provenanceUnknown = { version: 'virune-safe-ffi/v1', type: { kind: 'unknown' } } as const;

function errorFrom(result: ReturnType<typeof safeCall>): JsError {
	assert.equal(result.$tag, 'Err');
	return result.$values[0] as JsError;
}

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"foreign Unknown preserves identity while native identity values fail closed","kind":"positive","platform":"common"}
test('foreign Unknown preserves identity while native identity values fail closed', () => {
	const foreign = { token: 1 };
	const decoded = validateSafeFfiValue(foreign, provenanceUnknown);
	assert.strictEqual(decoded, foreign);
	assert.strictEqual(encodeSafeFfiValue(decoded, provenanceUnknown), foreign);

	for (const primitive of ['value', true, 1.5, 7n, undefined, null] as const) {
		assert.strictEqual(encodeSafeFfiValue(primitive, provenanceUnknown), primitive);
	}

	const nativeRecord = makeRecord({ token: 1 }, 'test:NativeRecord');
	assert.throws(() => encodeSafeFfiValue(nativeRecord, provenanceUnknown), ForeignContractError);
	assert.throws(() => encodeSafeFfiValue(['native-list'], provenanceUnknown), ForeignContractError);
	assert.throws(() => encodeSafeFfiValue(() => 'native-callable', provenanceUnknown), ForeignContractError);
	assert.throws(() => encodeSafeFfiValue(rootTaskContext(), provenanceUnknown), ForeignContractError);
	assert.throws(() => encodeSafeFfiValue({ token: 'fabricated' }, provenanceUnknown), ForeignContractError);
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"legacy ABI v2 unknown remains pass through","kind":"positive","platform":"common"}
test('legacy ABI v2 unknown remains pass through', () => {
	const nativeRecord = makeRecord({ token: 1 }, 'test:NativeRecord');
	assert.strictEqual(validateFfiValue(nativeRecord, { kind: 'unknown' }), nativeRecord);
	assert.strictEqual(encodeFfiValue(nativeRecord, { kind: 'unknown' }), nativeRecord);
});

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"malformed fabricated or stale provenance descriptors fail closed","kind":"negative","platform":"common"}
test('malformed, fabricated, or stale provenance descriptors fail closed', () => {
	const partial = { version: 'virune-safe-ffi/v1' } as unknown as SafeFfiBoundaryDescriptor;
	const stale = { version: 'virune-safe-ffi/v0', type: { kind: 'unknown' } } as unknown as SafeFfiBoundaryDescriptor;
	const fabricated = { version: 'virune-safe-ffi/v1', type: { kind: 'unknown' }, trusted: true } as unknown as SafeFfiBoundaryDescriptor;
	for (const descriptor of [partial, stale, fabricated]) {
		assert.throws(() => validateSafeFfiValue({}, descriptor), ForeignDecodeError);
		assert.throws(() => encodeSafeFfiValue({}, descriptor), ForeignDecodeError);
	}
});

// @virune-rule {"id":"ffi.safe","runner":"unit","file":"packages/runtime/test/ffi-unknown-provenance.test.ts","case":"foreign execution contract decode and internal errors stay distinguishable","kind":"positive","platform":"common"}
test('foreign execution, contract, decode, and internal errors stay distinguishable', async () => {
	const thrown = errorFrom(safeCall(() => { throw new Error('sync'); }));
	assert.equal(thrown.origin, 'throw');
	assert.equal(thrown.message, 'sync');

	const rejected = await safeCallAsync(() => Promise.reject(new Error('async')));
	assert.equal(rejected.$tag, 'Err');
	assert.equal((rejected.$values[0] as JsError).origin, 'rejection');

	const syncBeforePromise = await safeCallAsync(() => { throw new Error('before-promise'); });
	assert.equal(syncBeforePromise.$tag, 'Err');
	assert.equal((syncBeforePromise.$values[0] as JsError).origin, 'throw');

	const contract = errorFrom(safeCall(() => validateFfiValue(1, { kind: 'string' })));
	assert.equal(contract.origin, 'contract');

	const decode = errorFrom(safeCall(() => validateFfiValue({}, { kind: 'record', name: 'Payload', fields: { value: { kind: 'string' } } })));
	assert.equal(decode.origin, 'decode');

	const internal = errorFrom(safeCall(() => panic('do-not-leak')));
	assert.equal(internal.origin, 'internal');
	assert.equal(internal.message, 'Virune internal failure');
	assert.equal(internal.cause, undefined);
	assert.notEqual(internal.name, VirunePanic.name);
});
