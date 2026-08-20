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

test('provider-independent evidence preserves supported platform and runtime-format facts without TypeScript-provider correlation rules', () => {
	for (const value of [
		witness({ platform: 'browser', runtimeFormat: 'esm' }),
		witness({ platform: 'browser', runtimeFormat: 'commonjs' }),
		witness({ platform: 'neutral', runtimeFormat: 'esm' }),
	]) {
		const operation = load(value);
		assert.equal(operation.runtimeWitness?.platform, value.platform);
		assert.equal(operation.runtimeWitness?.runtimeFormat, value.runtimeFormat);
		assert.equal(operation.decision.status, 'resolved');
		assert.equal(isResolvedDirectInteropDecision(operation.decision), true);
	}
});

test('builtin witness facts are preserved instead of imposing one provider implementation policy', () => {
	const builtin = witness({
		moduleSpecifier: 'virtual:fs',
		runtimeEntry: 'node:fs',
		runtimeFormat: 'builtin',
		platform: 'browser',
		packageName: 'virtual-fs',
	});
	const operation = load(builtin);
	assert.equal(operation.runtimeWitness?.platform, 'browser');
	assert.equal(operation.runtimeWitness?.runtimeFormat, 'builtin');
	assert.equal(operation.runtimeWitness?.runtimeEntry, 'node:fs');
	assert.equal(operation.runtimeWitness?.packageName, 'virtual-fs');
	assert.equal(operation.decision.status, 'resolved');
});

test('runtime entry syntax does not infer or rewrite the provider-declared runtime format', () => {
	const operation = load(witness({ runtimeEntry: 'node:fs', runtimeFormat: 'esm' }));
	assert.equal(operation.runtimeWitness?.runtimeEntry, 'node:fs');
	assert.equal(operation.runtimeWitness?.runtimeFormat, 'esm');
	assert.equal(operation.decision.status, 'resolved');
});

test('bundler resolution remains a pending build obligation regardless of provider platform or early stable locator', () => {
	for (const value of [
		witness({ runtimeFormat: 'bundler', platform: 'node' }),
		witness({ runtimeFormat: 'bundler', platform: 'browser' }),
	]) {
		const operation = load(value);
		assert.equal(operation.runtimeWitness?.runtimeEntry, 'dist/library.js');
		assert.equal(operation.runtimeWitness?.platform, value.platform);
		assert.equal(operation.decision.status, 'obligation-pending');
		assert.equal(isResolvedDirectInteropDecision(operation.decision), false);
	}
});

test('unknown runtime format may retain a stable locator but never becomes resolved Direct evidence', () => {
	const operation = load(witness({
		runtimeEntry: 'dist/data.json',
		runtimeFormat: 'unknown',
	}));
	assert.equal(operation.runtimeWitness?.runtimeEntry, 'dist/data.json');
	assert.equal(operation.runtimeWitness?.runtimeFormat, 'unknown');
	assert.equal(operation.decision.status, 'unresolved');
	assert.equal(isResolvedDirectInteropDecision(operation.decision), false);
});
