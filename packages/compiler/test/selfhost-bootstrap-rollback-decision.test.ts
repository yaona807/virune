import assert from 'node:assert/strict';
import test from 'node:test';
import {
	evaluateBootstrapRollbackDecision,
	REQUIRED_ROLLBACK_GATES,
	type BootstrapRollbackDecisionInput,
} from '../src/selfhost/bootstrap-rollback-decision.js';

const candidateSha256 = 'a'.repeat(64);

function validInput(): BootstrapRollbackDecisionInput {
	return {
		version: 1,
		candidateVersion: '1.1.0-selfhost.1',
		candidateSha256,
		releaseVersion: '1.1.0',
		evaluatedAt: '2026-08-01T06:00:00.000Z',
		maximumEvidenceAgeSeconds: 3600,
		gates: REQUIRED_ROLLBACK_GATES.map((name, index) => ({
			name,
			candidateSha256,
			checkedAt: '2026-08-01T05:30:00.000Z',
			status: 'pass',
			evidenceSha256: index.toString(16).padStart(64, '0'),
		})),
	};
}

test('all current candidate-bound gates retain the self-host selection deterministically', () => {
	const first = evaluateBootstrapRollbackDecision(validInput());
	const input = validInput();
	const second = evaluateBootstrapRollbackDecision({ ...input, gates: [...input.gates].reverse() });
	assert.equal(first.serialized, second.serialized);
	assert.equal(first.sha256, second.sha256);
	assert.equal(first.decision.selection, 'self-host');
	assert.equal(first.decision.rollbackRequired, false);
	assert.deepEqual(first.decision.reasons, []);
});

test('missing, stale, failed, and mismatched gates select Legacy rollback', () => {
	const input = validInput();
	const gates = input.gates
		.filter(gate => gate.name !== 'clean-bootstrap')
		.map(gate => {
			if (gate.name === 'performance') return { ...gate, status: 'fail' as const };
			if (gate.name === 'runtime-behaviour') return { ...gate, checkedAt: '2026-08-01T03:00:00.000Z' };
			if (gate.name === 'rollback-smoke') return { ...gate, candidateSha256: 'b'.repeat(64) };
			return gate;
		});
	const result = evaluateBootstrapRollbackDecision({ ...input, gates });
	assert.equal(result.decision.selection, 'legacy');
	assert.equal(result.decision.rollbackRequired, true);
	assert.deepEqual(result.decision.reasons, [
		{ gate: 'clean-bootstrap', code: 'MISSING' },
		{ gate: 'performance', code: 'FAILED' },
		{ gate: 'rollback-smoke', code: 'SUBJECT_MISMATCH' },
		{ gate: 'runtime-behaviour', code: 'STALE' },
	]);
});

test('malformed and duplicate boundary data fails closed', () => {
	const input = validInput();
	assert.throws(() => evaluateBootstrapRollbackDecision({ ...input, unexpected: true }), /unknown/u);
	assert.throws(() => evaluateBootstrapRollbackDecision({ ...input, candidateSha256: 'BAD' }), /lowercase SHA-256/u);
	assert.throws(() => evaluateBootstrapRollbackDecision({ ...input, maximumEvidenceAgeSeconds: 0 }), /positive safe integer/u);
	assert.throws(() => evaluateBootstrapRollbackDecision({ ...input, gates: [...input.gates, input.gates[0]] }), /duplicated/u);
});
