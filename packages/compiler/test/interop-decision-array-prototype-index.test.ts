import assert from 'node:assert/strict';
import test from 'node:test';
import { isResolvedDirectInteropDecision } from '../src/interop/decision.js';

function isPendingObligation(value: unknown): boolean {
	if (value === null || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return record.kind === 'runtime-resolution' && record.status === 'pending';
}

test('inherited numeric Array setter cannot erase a pending obligation during canonicalization', () => {
	const previous = Object.getOwnPropertyDescriptor(Array.prototype, '0');
	Object.defineProperty(Array.prototype, '0', {
		configurable: true,
		get() { return undefined; },
		set(this: unknown[], value: unknown) {
			if (isPendingObligation(value)) return;
			Object.defineProperty(this, '0', {
				configurable: true,
				enumerable: true,
				writable: true,
				value,
			});
		},
	});
	try {
		assert.equal(isResolvedDirectInteropDecision({
			status: 'resolved',
			mechanism: 'direct',
			authoring: 'none',
			claims: [],
			obligations: [{ kind: 'runtime-resolution', stage: 'build', status: 'pending' }],
		}), false);
	} finally {
		if (previous === undefined) Reflect.deleteProperty(Array.prototype, '0');
		else Object.defineProperty(Array.prototype, '0', previous);
	}
});
