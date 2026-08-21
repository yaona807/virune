import assert from 'node:assert/strict';
import test from 'node:test';
import { isResolvedDirectInteropDecision } from '../src/interop/decision.js';
import { externalModuleLoadOperation } from '../src/interop/operation.js';
import type { ModuleResolutionWitness } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

function witness(runtimeFormat: 'esm' | 'commonjs' | 'builtin'): ModuleResolutionWitness {
	return {
		moduleSpecifier: runtimeFormat === 'builtin' ? 'node:test' : './library.js',
		runtimeFormat,
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'test-provider-1',
	};
}

test('known runtime format without a runtime entry is unresolved, not Direct success evidence', () => {
	for (const runtimeFormat of ['esm', 'commonjs', 'builtin'] as const) {
		const item = witness(runtimeFormat);
		const operation = externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: item.moduleSpecifier,
			witnesses: [item],
		});
		assert.equal(operation.decision.status, 'unresolved');
		assert.deepEqual(operation.decision.obligations, []);
		assert.equal(isResolvedDirectInteropDecision(operation.decision), false);
	}
});
