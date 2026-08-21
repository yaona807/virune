import assert from 'node:assert/strict';
import test from 'node:test';
import { externalModuleLoadOperation, externalOperationFromUsage } from '../src/interop/operation.js';
import type { ForeignUsageIR, ModuleResolutionWitness } from '../src/interop/types.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

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

function property(packageName: string): ForeignUsageIR {
	return {
		kind: 'property',
		nodeId: 1,
		span,
		foreignType: {
			display: 'Value',
			category: 'object',
			origin: { moduleSpecifier: './library.js', packageName },
		},
	};
}

test('provider-private paths cannot hide behind arbitrary provider-text delimiters', () => {
	for (const packageName of [
		'pkg|/checkout/private/pkg',
		'pkg>C:/checkout/private/pkg',
		'pkg|file:///checkout/private/pkg',
		'pkg@file:///checkout/private/pkg',
		'pkg@C:private/pkg',
		'//server/share/private/pkg',
		'pkg|//server/share/private/pkg',
		'pkg@//server/share/private/pkg',
	]) {
		const operation = externalOperationFromUsage(property(packageName));
		assert.equal(operation?.kind, 'read-property');
		if (operation?.kind !== 'read-property') continue;
		assert.equal(operation.result.origin?.packageName, undefined);
		assert.equal(JSON.stringify(operation).includes('checkout/private'), false);
		assert.equal(JSON.stringify(operation).includes('server/share/private'), false);
	}

	for (const invalid of [
		witness({ packageName: 'pkg|/checkout/private/pkg' }),
		witness({ packageVersion: 'version>file:///checkout/private/package.json' }),
		witness({ conditions: ['types', 'condition>/checkout/private/condition'] }),
		witness({ packageName: 'pkg@file:///checkout/private/pkg' }),
		witness({ packageVersion: 'version@C:private/package.json' }),
		witness({ conditions: ['types', 'condition@/checkout/private/condition'] }),
		witness({ packageName: '//server/share/private/pkg' }),
		witness({ packageVersion: 'version>//server/share/private/package.json' }),
		witness({ conditions: ['types', 'condition>//server/share/private/condition'] }),
		witness({ conditions: ['types', 'condition@//server/share/private/condition'] }),
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

	for (const runtimeEntry of [
		'resolved|/checkout/private/library.js',
		'resolved@/checkout/private/library.js',
		'resolved@C:private/library.js',
	]) {
		assert.throws(
			() => externalModuleLoadOperation({
				nodeId: 1,
				span,
				moduleSpecifier: './library.js',
				witnesses: [witness({ runtimeEntry })],
			}),
			/not be absolute or drive-relative/u,
		);
	}
});

test('broader delimiter detection preserves legitimate source-like provider text', () => {
	const operation = externalModuleLoadOperation({
		nodeId: 1,
		span,
		moduleSpecifier: '@scope/package',
		witnesses: [witness({
			moduleSpecifier: '@scope/package',
			packageName: '@scope/package',
			packageVersion: '1.2.3-beta/1',
			conditions: ['node-addons', 'import'],
		})],
	});
	assert.equal(operation.decision.status, 'resolved');
	assert.equal(operation.runtimeWitness?.packageName, '@scope/package');

	const sourceLike = externalOperationFromUsage({
		...property('@scope/package'),
		foreignType: {
			...property('@scope/package').foreignType,
			origin: { moduleSpecifier: 'https://example.test/library.js', packageName: '@scope/package' },
		},
	});
	assert.equal(sourceLike?.kind, 'read-property');
	if (sourceLike?.kind === 'read-property') {
		assert.equal(sourceLike.result.origin?.moduleSpecifier, 'https://example.test/library.js');
	}
});
