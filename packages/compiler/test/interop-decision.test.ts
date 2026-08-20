import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canonicalizeInteropDecision,
	isResolvedDirectInteropDecision,
	type InteropDecisionIR,
} from '../src/interop/decision.js';

test('canonicalizes set-like claims and obligations deterministically', () => {
	const first: InteropDecisionIR = {
		status: 'resolved',
		mechanism: 'direct',
		authoring: 'none',
		claims: ['type-boundary-safe', 'receiver-preserved', 'type-boundary-safe'],
		obligations: [
			{ kind: 'runtime-resolution', stage: 'runtime', status: 'discharged' },
			{ kind: 'runtime-resolution', stage: 'build', status: 'discharged' },
		],
	};
	const second: InteropDecisionIR = {
		...first,
		claims: ['receiver-preserved', 'type-boundary-safe'],
		obligations: [...first.obligations].reverse(),
	};

	const canonical = canonicalizeInteropDecision(first);
	assert.deepEqual(canonical, canonicalizeInteropDecision(second));
	assert.deepEqual(canonical.claims, ['receiver-preserved', 'type-boundary-safe']);
	assert.deepEqual(canonical.obligations, [
		{ kind: 'runtime-resolution', stage: 'build', status: 'discharged' },
		{ kind: 'runtime-resolution', stage: 'runtime', status: 'discharged' },
	]);
	assert.equal(isResolvedDirectInteropDecision(canonical), true);
});

test('rejects contradictory or incomplete obligation state fail closed', () => {
	assert.throws(
		() => canonicalizeInteropDecision({
			status: 'resolved', mechanism: 'direct', authoring: 'none', claims: [],
			obligations: [{ kind: 'runtime-resolution', stage: 'build', status: 'pending' }],
		}),
		/Resolved Interop decision cannot retain pending obligations/u,
	);
	assert.throws(
		() => canonicalizeInteropDecision({
			status: 'obligation-pending', mechanism: 'direct', authoring: 'none', claims: [], obligations: [],
		}),
		/obligation-pending Interop decision requires at least one pending obligation/u,
	);
	assert.throws(
		() => canonicalizeInteropDecision({
			status: 'obligation-pending', mechanism: 'direct', authoring: 'none', claims: [],
			obligations: [
				{ kind: 'runtime-resolution', stage: 'build', status: 'pending' },
				{ kind: 'runtime-resolution', stage: 'build', status: 'discharged' },
			],
		}),
		/Conflicting Interop obligation state/u,
	);
});

test('unresolved, pending, non-Direct, and unknown decisions are never Direct success evidence', () => {
	const pending: InteropDecisionIR = {
		status: 'obligation-pending', mechanism: 'direct', authoring: 'none', claims: [],
		obligations: [{ kind: 'runtime-resolution', stage: 'build', status: 'pending' }],
	};
	assert.equal(isResolvedDirectInteropDecision(pending), false);
	assert.equal(isResolvedDirectInteropDecision({ ...pending, status: 'unresolved', obligations: [] }), false);
	assert.equal(isResolvedDirectInteropDecision({ ...pending, status: 'resolved', mechanism: 'user-adapter', obligations: [] }), false);

	const unknown = {
		status: 'future-status', mechanism: 'direct', authoring: 'none', claims: [], obligations: [],
	} as unknown as InteropDecisionIR;
	assert.equal(isResolvedDirectInteropDecision(unknown), false);
	assert.throws(() => canonicalizeInteropDecision(unknown), /Unknown decision status/u);

	const unknownClaim = {
		status: 'resolved', mechanism: 'direct', authoring: 'none', claims: ['runtime-resolution-witnessed'], obligations: [],
	} as unknown as InteropDecisionIR;
	assert.equal(isResolvedDirectInteropDecision(unknownClaim), false);
	assert.throws(() => canonicalizeInteropDecision(unknownClaim), /Unknown Interop safety claim/u);
});

test('canonical evidence strips unrecognized obligation metadata', () => {
	const decision = {
		status: 'resolved',
		mechanism: 'direct',
		authoring: 'none',
		claims: ['foreign-identity-preserved'],
		obligations: [{
			kind: 'runtime-resolution',
			stage: 'check',
			status: 'discharged',
			providerPrivatePath: '/temporary/provider/declaration.d.ts',
		}],
	} as unknown as InteropDecisionIR;

	const canonical = canonicalizeInteropDecision(decision);
	const serialized = JSON.stringify(canonical);
	assert.equal(serialized.includes('providerPrivatePath'), false);
	assert.equal(serialized.includes('/temporary/provider'), false);
});
