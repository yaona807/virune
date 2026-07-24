import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePerformanceRegression, median } from './performance-benchmark-utils.mjs';

const baseline = {
	schemaVersion: 1,
	lsp: {
		thresholds: {
			relativeMultiplier: 1.5,
			initialAbsoluteIncreaseMs: 100,
			editedAbsoluteIncreaseMs: 20,
		},
		modules: [{ modules: 100, initialCompletionMs: 100, editedCompletionMs: 10 }],
	},
	interop: {
		maxDriftBytes: 1_000,
		expectedCacheEntriesBeforeDispose: 1,
		expectedCacheEntriesAfterDispose: 0,
	},
};

function lsp(initialCompletionMs, editedCompletionMs) {
	return {
		schemaVersion: 1,
		report: [{ modules: 100, initialCompletionMs, editedCompletionMs }],
	};
}

function interop(overrides = {}) {
	return {
		schemaVersion: 1,
		driftBytes: 10,
		cacheEntriesBeforeDispose: 1,
		cacheEntriesAfterDispose: 0,
		...overrides,
	};
}

test('median is resistant to one slow sample', () => {
	assert.equal(median([10, 11, 12, 13, 1_000]), 12);
});

test('latency fails only when relative and absolute limits are both exceeded', () => {
	assert.equal(evaluatePerformanceRegression(baseline, lsp(151, 10), interop()).passed, true);
	assert.equal(evaluatePerformanceRegression(baseline, lsp(201, 10), interop()).passed, false);
});

test('heap drift and dispose cache state are enforced', () => {
	assert.equal(evaluatePerformanceRegression(baseline, lsp(100, 10), interop({ driftBytes: 1_001 })).passed, false);
	assert.equal(evaluatePerformanceRegression(baseline, lsp(100, 10), interop({ cacheEntriesAfterDispose: 1 })).passed, false);
});
