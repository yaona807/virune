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

test('source-authored origin module specifiers are preserved exactly', () => {
	for (const moduleSpecifier of ['', '/explicit/library.js', 'file:///explicit/library.js', 'C:explicit/library.js']) {
		const operation = externalOperationFromUsage(usageWithOrigin({ moduleSpecifier }));
		assert.equal(operation?.kind, 'read-property');
		if (operation?.kind === 'read-property') assert.equal(operation.result.origin?.moduleSpecifier, moduleSpecifier);
	}
});

test('absolute checkout paths cannot hide in provider origin semantic text fields', () => {
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

test('source anchors are reconstructed from known scalar fields and cannot carry private metadata', () => {
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
	assert.deepEqual(operation?.span, span);

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
