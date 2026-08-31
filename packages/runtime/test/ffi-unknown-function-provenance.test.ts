import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFfiValue, validateFfiValue, type FfiTypeDescriptor } from '../src/index.js';

const provenanceUnknown = { version: 'virune-safe-ffi/v1', type: { kind: 'unknown' } } as unknown as FfiTypeDescriptor;

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/runtime/test/ffi-unknown-function-provenance.test.ts","case":"foreign function Unknown preserves identity across a Safe round trip","kind":"positive","platform":"common"}
test('foreign function Unknown preserves identity across a Safe round trip', () => {
	const foreign = function foreignCallback(value: string) { return value; };
	const decoded = validateFfiValue(foreign, provenanceUnknown);
	assert.strictEqual(decoded, foreign);
	assert.strictEqual(encodeFfiValue(decoded, provenanceUnknown), foreign);
});
