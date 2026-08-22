import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canonicalizeInteropDecision,
	isResolvedDirectInteropDecision,
	type InteropDecisionIR,
} from '../src/interop/decision.js';

function unknownDecision(overrides: Record<string, unknown>): InteropDecisionIR {
	return {
		status: 'resolved',
		mechanism: 'direct',
		authoring: 'none',
		claims: [],
		obligations: [],
		...overrides,
	} as unknown as InteropDecisionIR;
}

test('unknown mechanism and authoring dimensions fail closed', () => {
	for (const [decision, pattern] of [
		[unknownDecision({ mechanism: 'future-mechanism' }), /Unknown Interop mechanism/u],
		[unknownDecision({ authoring: 'future-authoring' }), /Unknown Interop authoring mode/u],
	] as const) {
		assert.equal(isResolvedDirectInteropDecision(decision), false);
		assert.throws(() => canonicalizeInteropDecision(decision), pattern);
	}
});

test('unknown obligation kind, stage, and status fail closed', () => {
	for (const [obligation, pattern] of [
		[{ kind: 'future-obligation', stage: 'check', status: 'discharged' }, /Unknown Interop obligation kind/u],
		[{ kind: 'runtime-resolution', stage: 'future-stage', status: 'discharged' }, /Unknown Interop obligation stage/u],
		[{ kind: 'runtime-resolution', stage: 'check', status: 'future-status' }, /Unknown Interop obligation status/u],
	] as const) {
		const decision = unknownDecision({ obligations: [obligation] });
		assert.equal(isResolvedDirectInteropDecision(decision), false);
		assert.throws(() => canonicalizeInteropDecision(decision), pattern);
	}
});

test('unknown decision and obligation fields fail closed instead of being ignored', () => {
	const futureDecision = unknownDecision({ futureSafetyState: 'unsafe' });
	assert.equal(isResolvedDirectInteropDecision(futureDecision), false);
	assert.throws(
		() => canonicalizeInteropDecision(futureDecision),
		/Unknown Interop decision field: futureSafetyState/u,
	);

	const futureObligation = unknownDecision({
		obligations: [{
			kind: 'runtime-resolution',
			stage: 'check',
			status: 'discharged',
			futureDischargeProof: 'provider-private',
		}],
	});
	assert.equal(isResolvedDirectInteropDecision(futureObligation), false);
	assert.throws(
		() => canonicalizeInteropDecision(futureObligation),
		/Unknown Interop obligation field: futureDischargeProof/u,
	);
});
