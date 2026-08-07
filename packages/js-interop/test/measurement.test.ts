import assert from 'node:assert/strict';
import test from 'node:test';
import type { InteropDecision, InteropSafetyGate } from '../src/classifier.js';
import { evaluateGoldCorpus, summarizeInteropMeasurements, type InteropMeasurementSample } from '../src/measurement.js';

function decision(gate: InteropSafetyGate, reasons: InteropDecision['reasons'] = []): InteropDecision {
	return {
		gate,
		plan: {
			controls: gate === 'AUTO_SAFE' ? ['direct-access'] : ['unknown'],
			handle: 'none',
			inputTransfer: 'primitive',
			outputTransfer: 'primitive',
			lifetime: 'call',
			ownership: 'value',
			flowControl: 'none',
			realm: 'same',
			environment: 'node',
		},
		reasons,
		evidence: [],
	};
}

function sample(packageId: string, endpointId: string, shapeId: string, gate: InteropSafetyGate, reasons: InteropDecision['reasons'] = []): InteropMeasurementSample {
	return { packageId, target: 'node', endpointId, shapeId, decision: decision(gate, reasons) };
}

test('keeps endpoint-weighted and package-target-weighted rates separate', () => {
	const samples = [
		...Array.from({ length: 10 }, (_, index) => sample('large@1', `f${index}`, `safe-${index}`, 'AUTO_SAFE')),
		sample('small@1', 'x', 'unsafe', 'UNRESOLVED'),
	];
	const summary = summarizeInteropMeasurements(samples);
	assert.equal(summary.endpointWeighted.rates.AUTO_SAFE, 10 / 11);
	assert.equal(summary.packageTargetWeighted.meanRates.AUTO_SAFE, 0.5);
	assert.equal(summary.packageTargetCount, 2);
});

test('deduplicates repeated normalized shapes for unique-shape weighting', () => {
	const summary = summarizeInteropMeasurements([
		sample('a@1', 'a1', 'same-safe-shape', 'AUTO_SAFE'),
		sample('a@1', 'a2', 'same-safe-shape', 'AUTO_SAFE'),
		sample('b@1', 'b1', 'unresolved-shape', 'UNRESOLVED'),
	]);
	assert.equal(summary.endpointWeighted.rates.AUTO_SAFE, 2 / 3);
	assert.equal(summary.uniqueShapeWeighted.rates.AUTO_SAFE, 1 / 2);
	assert.equal(summary.uniqueShapeCount, 2);
});

test('does not majority-vote conflicting classifications for one normalized shape', () => {
	const summary = summarizeInteropMeasurements([
		sample('a@1', 'a1', 'conflict', 'AUTO_SAFE'),
		sample('b@1', 'b1', 'conflict', 'AUTO_SAFE'),
		sample('c@1', 'c1', 'conflict', 'SEMANTICS_REQUIRED'),
	]);
	assert.deepEqual(summary.shapeConflicts, [{ target: 'node', shapeId: 'conflict', gates: ['AUTO_SAFE', 'SEMANTICS_REQUIRED'] }]);
	assert.equal(summary.uniqueShapeWeighted.counts.SEMANTICS_REQUIRED, 1);
	assert.equal(summary.uniqueShapeWeighted.counts.AUTO_SAFE, 0);
});

test('counts each reason at most once per endpoint', () => {
	const summary = summarizeInteropMeasurements([
		sample('a@1', 'x', 'x', 'UNRESOLVED', ['EVIDENCE_CONFLICT', 'EVIDENCE_CONFLICT']),
		sample('b@1', 'y', 'y', 'SEMANTICS_REQUIRED', ['RUNTIME_BINDING_UNVERIFIED']),
	]);
	assert.equal(summary.reasonCounts.EVIDENCE_CONFLICT, 1);
	assert.equal(summary.reasonCounts.RUNTIME_BINDING_UNVERIFIED, 1);
});

test('evaluates false-safe independently from generic coverage', () => {
	const evaluation = evaluateGoldCorpus([
		{ id: 'tp', expectedAutoSafety: 'SAFE_AUTO', actual: decision('AUTO_SAFE'), expectedGate: 'AUTO_SAFE' },
		{ id: 'fp', expectedAutoSafety: 'NOT_SAFE_AUTO', actual: decision('AUTO_SAFE'), expectedGate: 'SEMANTICS_REQUIRED' },
		{ id: 'fn', expectedAutoSafety: 'SAFE_AUTO', actual: decision('SEMANTICS_REQUIRED') },
		{ id: 'tn', expectedAutoSafety: 'NOT_SAFE_AUTO', actual: decision('ADAPTER_REQUIRED') },
	]);
	assert.equal(evaluation.falseSafeCount, 1);
	assert.equal(evaluation.falseSafeRate, 0.5);
	assert.equal(evaluation.falseSafeShare, 0.25);
	assert.equal(evaluation.autoSafePrecision, 0.5);
	assert.equal(evaluation.autoSafeRecall, 0.5);
	assert.equal(evaluation.exactGateMatches, 1);
	assert.equal(evaluation.exactGateCompared, 2);
});

test('uses null precision or recall when a denominator has no evidence', () => {
	assert.equal(evaluateGoldCorpus([]).autoSafePrecision, null);
	assert.equal(evaluateGoldCorpus([]).autoSafeRecall, null);
	assert.equal(evaluateGoldCorpus([{ id: 'n', expectedAutoSafety: 'NOT_SAFE_AUTO', actual: decision('UNRESOLVED') }]).autoSafePrecision, null);
});


test('rejects duplicate canonical endpoints instead of silently skewing metrics', () => {
	const duplicated = [
		sample('a@1', 'same', 'shape-a', 'AUTO_SAFE'),
		sample('a@1', 'same', 'shape-b', 'UNRESOLVED'),
	];
	assert.throws(() => summarizeInteropMeasurements(duplicated), /Duplicate canonical endpoint/u);
});

test('rejects duplicate gold ids instead of double-counting reviewed evidence', () => {
	assert.throws(() => evaluateGoldCorpus([
		{ id: 'same', expectedAutoSafety: 'SAFE_AUTO', actual: decision('AUTO_SAFE') },
		{ id: 'same', expectedAutoSafety: 'NOT_SAFE_AUTO', actual: decision('UNRESOLVED') },
	]), /Duplicate gold sample/u);
});


test('does not collapse identical shapes across target profiles', () => {
	const node = sample('a@1', 'x', 'same-shape', 'AUTO_SAFE');
	const browser: InteropMeasurementSample = { ...sample('a@1', 'x', 'same-shape', 'SEMANTICS_REQUIRED'), target: 'browser' };
	const summary = summarizeInteropMeasurements([node, browser]);
	assert.equal(summary.uniqueShapeCount, 2);
	assert.deepEqual(summary.shapeConflicts, []);
	assert.equal(summary.uniqueShapeWeighted.counts.AUTO_SAFE, 1);
	assert.equal(summary.uniqueShapeWeighted.counts.SEMANTICS_REQUIRED, 1);
});

test('false-safe rate is conditioned on reviewed not-safe samples', () => {
	const evaluation = evaluateGoldCorpus([
		{ id: 'safe', expectedAutoSafety: 'SAFE_AUTO', actual: decision('AUTO_SAFE') },
		{ id: 'unsafe-fp', expectedAutoSafety: 'NOT_SAFE_AUTO', actual: decision('AUTO_SAFE') },
		{ id: 'unsafe-tn', expectedAutoSafety: 'NOT_SAFE_AUTO', actual: decision('UNRESOLVED') },
	]);
	assert.equal(evaluation.falseSafeRate, 0.5);
	assert.equal(evaluation.falseSafeShare, 1 / 3);
	assert.equal(evaluateGoldCorpus([{ id: 'only-safe', expectedAutoSafety: 'SAFE_AUTO', actual: decision('AUTO_SAFE') }]).falseSafeRate, null);
});
