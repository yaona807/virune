import assert from 'node:assert/strict';
import test from 'node:test';
import { externalModuleLoadOperation, externalOperationFromUsage } from '../src/interop/operation.js';
import type { ForeignUsageIR, ModuleResolutionWitness } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

function witness(runtimeEntry: string): ModuleResolutionWitness {
	return {
		moduleSpecifier: './library.js',
		runtimeEntry,
		runtimeFormat: 'esm',
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'test-provider-1',
	};
}

test('file URIs and Windows drive-relative provider runtime locators cannot enter stable evidence', () => {
	for (const runtimeEntry of ['file:/checkout/private.js', 'file:C:/checkout/private.js', 'C:private/library.js']) {
		assert.throws(
			() => externalModuleLoadOperation({
				nodeId: 1,
				span,
				moduleSpecifier: './library.js',
				witnesses: [witness(runtimeEntry)],
			}),
			/not be absolute or drive-relative/u,
		);
	}
});

test('source-authored module specifiers remain exact while provider semantic paths fail closed', () => {
	for (const moduleSpecifier of ['/explicit/library.js', 'file:///explicit/library.js', 'C:explicit/library.js']) {
		const operation = externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier,
			witnesses: [{ ...witness('dist/library.js'), moduleSpecifier }],
		});
		assert.equal(operation.moduleSpecifier, moduleSpecifier);
		assert.equal(operation.runtimeWitness?.moduleSpecifier, moduleSpecifier);
		assert.equal(operation.decision.status, 'resolved');
	}

	const usage: ForeignUsageIR = {
		kind: 'property',
		nodeId: 1,
		span,
		foreignType: {
			display: 'Value',
			category: 'object',
			origin: { moduleSpecifier: './library.js', packageName: 'C:private/package' },
		},
	};
	assert.throws(() => externalOperationFromUsage(usage), /provider-private path syntax/u);
});
