import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canonicalizeInteropDecision,
	isResolvedDirectInteropDecision,
	type InteropDecisionIR,
} from '../src/interop/decision.js';

test('inherited record setter cannot rewrite unsafe mechanism into resolved Direct evidence', () => {
	const decision: InteropDecisionIR = {
		status: 'resolved',
		mechanism: 'unsafe',
		authoring: 'none',
		claims: [],
		obligations: [],
	};
	const previous = Object.getOwnPropertyDescriptor(Object.prototype, 'mechanism');
	Object.defineProperty(Object.prototype, 'mechanism', {
		configurable: true,
		get: () => 'direct',
		set: () => {},
	});
	try {
		const canonical = canonicalizeInteropDecision(decision);
		assert.equal(canonical.mechanism, 'unsafe');
		assert.equal(isResolvedDirectInteropDecision(decision), false);
	} finally {
		if (previous === undefined) Reflect.deleteProperty(Object.prototype, 'mechanism');
		else Object.defineProperty(Object.prototype, 'mechanism', previous);
	}
});
