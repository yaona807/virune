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

test('stable source-like origin module specifiers remain available when they do not expose provider paths', () => {
	for (const moduleSpecifier of ['./library.js', '../shared.js', '@scope/package', 'node:fs', 'https://example.test/library.js']) {
		const operation = externalOperationFromUsage(usageWithOrigin({ moduleSpecifier }));
		assert.equal(operation?.kind, 'read-property');
		if (operation?.kind === 'read-property') assert.equal(operation.result.origin?.moduleSpecifier, moduleSpecifier);
	}
});

test('provider-origin absolute paths are stripped without rejecting an otherwise accepted Direct operation', () => {
	for (const origin of [
		{ moduleSpecifier: '/checkout/private/library.js', packageName: 'pkg', exportName: 'value' },
		{ moduleSpecifier: './library.js', packageName: '/checkout/private/pkg', exportName: 'value' },
		{ moduleSpecifier: './library.js', packageVersion: 'file:///checkout/private/package.json', exportName: 'value' },
		{ moduleSpecifier: './library.js', exportName: 'C:/checkout/private/export' },
	]) {
		const operation = externalOperationFromUsage(usageWithOrigin(origin));
		assert.equal(operation?.kind, 'read-property');
		if (operation?.kind !== 'read-property') continue;
		const serialized = JSON.stringify(operation);
		assert.equal(serialized.includes('/checkout/private'), false);
		assert.equal(serialized.includes('file:///checkout/private'), false);
		assert.equal(serialized.includes('C:/checkout/private'), false);
		assert.equal(operation.decision.status, 'resolved');
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

test('source anchors are reconstructed from known stable fields and cannot carry cache-local or private metadata', () => {
	const privatePath = '/checkout/private/anchor-state';
	const dirtySpan = {
		...span,
		providerPrivatePath: privatePath,
		start: { ...span.start, providerPrivatePath: privatePath },
		end: { ...span.end, providerPrivatePath: privatePath },
	};
	const operation = externalOperationFromUsage({
		...usageWithOrigin({ moduleSpecifier: './library.js' }),
		span: dirtySpan,
	} as ForeignUsageIR);
	assert.equal(JSON.stringify(operation).includes(privatePath), false);
	assert.deepEqual(operation?.span, { start: span.start, end: span.end });
	assert.equal(JSON.stringify(operation).includes('fileId'), false);

	const differentFileId = externalOperationFromUsage({
		...usageWithOrigin({ moduleSpecifier: './library.js' }),
		span: { ...span, fileId: 999 },
	});
	assert.equal(JSON.stringify(operation), JSON.stringify(differentFileId));

	assert.throws(
		() => externalOperationFromUsage({ ...usageWithOrigin(undefined), nodeId: Number.NaN }),
		/node id must be a safe integer/u,
	);
	assert.throws(
		() => externalOperationFromUsage({
			...usageWithOrigin(undefined),
			span: { ...span, start: { ...span.start, offset: Number.POSITIVE_INFINITY } },
		}),
		/source span must contain safe integer positions/u,
	);
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
