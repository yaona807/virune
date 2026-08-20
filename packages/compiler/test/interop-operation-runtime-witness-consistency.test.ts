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

function witness(overrides: Partial<ModuleResolutionWitness> = {}): ModuleResolutionWitness {
	return {
		moduleSpecifier: './library.js',
		runtimeEntry: 'dist/library.js',
		runtimeFormat: 'esm',
		conditions: ['types', 'node-addons', 'node', 'import', 'module-sync'],
		platform: 'node',
		providerVersion: 'provider-1',
		packageJsonHash: 'a'.repeat(64),
		...overrides,
	};
}

function load(value: ModuleResolutionWitness) {
	return externalModuleLoadOperation({
		nodeId: 1,
		span,
		moduleSpecifier: value.moduleSpecifier,
		witnesses: [value],
	});
}

test('runtime format and platform combinations fail closed when contradictory', () => {
	const nodeBundler: ModuleResolutionWitness = {
		moduleSpecifier: './library.js',
		runtimeFormat: 'bundler',
		conditions: ['types', 'node-addons', 'node', 'import', 'module-sync'],
		platform: 'node',
		providerVersion: 'provider-1',
	};
	for (const [value, expected] of [
		[witness({ platform: 'browser', runtimeFormat: 'esm' }), /esm runtime witness requires the node platform/u],
		[witness({ platform: 'browser', runtimeFormat: 'commonjs' }), /commonjs runtime witness requires the node platform/u],
		[nodeBundler, /bundler runtime witness requires the browser platform/u],
		[witness({ platform: 'browser', runtimeFormat: 'bundler' }), /must defer its runtime entry to the build stage/u],
	]) {
		assert.throws(() => load(value as ModuleResolutionWitness), expected as RegExp);
	}
});

test('builtin runtime witnesses require node and cannot impersonate a package', () => {
	const builtin: ModuleResolutionWitness = {
		moduleSpecifier: 'node:fs',
		runtimeEntry: 'node:fs',
		runtimeFormat: 'builtin',
		conditions: ['types', 'node-addons', 'node', 'import', 'module-sync'],
		platform: 'node',
		providerVersion: 'provider-1',
	};
	assert.equal(load(builtin).decision.status, 'resolved');

	assert.throws(
		() => load({ ...builtin, platform: 'browser' }),
		/builtin runtime witness requires the node platform/u,
	);
	assert.throws(
		() => load({ ...builtin, packageName: 'fs' }),
		/builtin runtime witness must not carry package identity/u,
	);
});

test('node: runtime entries cannot be relabeled as non-builtin resolution', () => {
	assert.throws(
		() => load(witness({ runtimeEntry: 'node:fs', runtimeFormat: 'esm' })),
		/non-builtin runtime entry must not use a node: specifier/u,
	);
});

test('browser bundler resolution remains a pending build obligation', () => {
	const browserBundler: ModuleResolutionWitness = {
		moduleSpecifier: './library.js',
		runtimeFormat: 'bundler',
		conditions: ['types', 'import', 'browser'],
		platform: 'browser',
		providerVersion: 'provider-1',
	};
	const operation = load(browserBundler);
	assert.equal(operation.decision.status, 'obligation-pending');
	assert.equal(isResolvedDirectInteropDecision(operation.decision), false);
});

test('unknown Node runtime format may retain a stable locator but never becomes resolved Direct evidence', () => {
	const operation = load(witness({
		runtimeEntry: 'dist/data.json',
		runtimeFormat: 'unknown',
	}));
	assert.equal(operation.runtimeWitness?.runtimeEntry, 'dist/data.json');
	assert.equal(operation.runtimeWitness?.runtimeFormat, 'unknown');
	assert.equal(operation.decision.status, 'unresolved');
	assert.equal(isResolvedDirectInteropDecision(operation.decision), false);
});
