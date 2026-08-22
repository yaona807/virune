import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canonicalizeInteropDecision,
	isResolvedDirectInteropDecision,
	type InteropDecisionIR,
} from '../src/interop/decision.js';

test('canonicalizes set-like decision facts deterministically', () => {
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
	assert.equal(Object.isFrozen(canonical), true);
	assert.equal(Object.isFrozen(canonical.claims), true);
	assert.equal(Object.isFrozen(canonical.obligations), true);
});

test('contradictory or incomplete obligation state fails closed', () => {
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

test('unknown, unresolved, pending, authored, and non-Direct decisions are not Direct success evidence', () => {
	const pending: InteropDecisionIR = {
		status: 'obligation-pending', mechanism: 'direct', authoring: 'none', claims: [],
		obligations: [{ kind: 'runtime-resolution', stage: 'build', status: 'pending' }],
	};
	assert.equal(isResolvedDirectInteropDecision(pending), false);
	assert.equal(isResolvedDirectInteropDecision({ ...pending, status: 'unresolved', obligations: [] }), false);
	assert.equal(isResolvedDirectInteropDecision({ ...pending, status: 'resolved', mechanism: 'managed', obligations: [] }), false);
	assert.equal(isResolvedDirectInteropDecision({ ...pending, status: 'resolved', authoring: 'generated', obligations: [] }), false);

	const unknownStatus = { status: 'future-status', mechanism: 'direct', authoring: 'none', claims: [], obligations: [] } as unknown as InteropDecisionIR;
	assert.equal(isResolvedDirectInteropDecision(unknownStatus), false);
	assert.throws(() => canonicalizeInteropDecision(unknownStatus), /Unknown decision status/u);

	const unknownClaim = { status: 'resolved', mechanism: 'direct', authoring: 'none', claims: ['future-claim'], obligations: [] } as unknown as InteropDecisionIR;
	assert.equal(isResolvedDirectInteropDecision(unknownClaim), false);
	assert.throws(() => canonicalizeInteropDecision(unknownClaim), /Unknown Interop safety claim/u);
});

test('unrelated same-process metadata is omitted rather than becoming stable decision evidence', () => {
	const input = {
		status: 'resolved',
		mechanism: 'direct',
		authoring: 'none',
		claims: [],
		obligations: [{ kind: 'runtime-resolution', stage: 'check', status: 'discharged', providerPrivate: '/tmp/provider' }],
		providerPrivate: '/tmp/provider',
	} as unknown as InteropDecisionIR;

	const canonical = canonicalizeInteropDecision(input);
	assert.equal(isResolvedDirectInteropDecision(canonical), true);
	assert.equal(JSON.stringify(canonical).includes('providerPrivate'), false);
	assert.equal(JSON.stringify(canonical).includes('/tmp/provider'), false);
});
