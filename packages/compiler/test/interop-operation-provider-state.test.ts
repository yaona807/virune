import assert from 'node:assert/strict';
import test from 'node:test';
import {
	externalModuleLoadOperation,
	externalOperationFromUsage,
} from '../src/interop/operation.js';
import type { ForeignUsageIR, ModuleResolutionWitness } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

function usageWithOrigin(origin: ForeignUsageIR['foreignType']['origin']): ForeignUsageIR {
	return {
		kind: 'property',
		nodeId: 1,
		span,
		foreignType: {
			display: 'Value',
			category: 'object',
			...(origin === undefined ? {} : { origin }),
		},
	};
}

function witness(overrides: Partial<ModuleResolutionWitness> = {}): ModuleResolutionWitness {
	return {
		moduleSpecifier: './library.js',
		runtimeEntry: 'dist/library.js',
		runtimeFormat: 'esm',
		conditions: ['types', 'import', 'node'],
		platform: 'node',
		providerVersion: 'provider-1',
		packageJsonHash: 'a'.repeat(64),
		...overrides,
	};
}

test('absolute checkout paths cannot hide in origin semantic text fields', () => {
	for (const origin of [
		{ moduleSpecifier: './library.js', packageName: '/checkout/private/pkg' },
		{ moduleSpecifier: './library.js', packageVersion: 'file:///checkout/private/package.json' },
		{ moduleSpecifier: './library.js', exportName: 'C:/checkout/private/export' },
	]) {
		assert.throws(
			() => externalOperationFromUsage(usageWithOrigin(origin)),
			/provider-private path syntax/u,
		);
	}
});

test('absolute checkout paths cannot hide in runtime witness package or condition fields', () => {
	for (const invalid of [
		witness({ packageName: '/checkout/private/pkg' }),
		witness({ packageVersion: 'file:///checkout/private/package.json' }),
		witness({ conditions: ['types', '/checkout/private/condition'] }),
	]) {
		assert.throws(
			() => externalModuleLoadOperation({
				nodeId: 1,
				span,
				moduleSpecifier: './library.js',
				witnesses: [invalid],
			}),
			/provider-private path syntax/u,
		);
	}
});

test('scoped package names and ordinary semantic conditions remain valid', () => {
	const operation = externalModuleLoadOperation({
		nodeId: 1,
		span,
		moduleSpecifier: '@scope/package',
		witnesses: [witness({
			moduleSpecifier: '@scope/package',
			packageName: '@scope/package',
			packageVersion: '1.2.3',
			conditions: ['types', 'node-addons', 'node', 'import'],
		})],
	});
	assert.equal(operation.decision.status, 'resolved');
	assert.equal(operation.runtimeWitness?.packageName, '@scope/package');
});
