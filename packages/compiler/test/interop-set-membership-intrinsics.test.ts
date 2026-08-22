import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/interop/checked-api.js';
import {
	canonicalizeInteropDecision,
	isResolvedDirectInteropDecision,
	type InteropDecisionIR,
} from '../src/interop/decision.js';
import { externalOperationFromUsage } from '../src/interop/operation.js';
import {
	captureCheckedSourceReuseSeal,
	matchesCheckedSourceReuseSeal,
} from '../src/interop/source-identity.js';
import type { JsInteropProvider } from '../src/interop/types.js';

function provider(): JsInteropProvider {
	return {
		id: 'set-membership-intrinsics-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			if (request.kind !== 'side-effect') throw new Error('test provider expects a side-effect import');
			return {
				runtime: { kind: 'side-effect' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'set-membership-intrinsics-provider-1',
				},
			};
		},
		getProperty() { return undefined; },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'unknown'; },
	};
}

function withSetHasOverride<T>(replacement: (this: Set<unknown>, value: unknown) => boolean, callback: () => T): T {
	const previous = Object.getOwnPropertyDescriptor(Set.prototype, 'has');
	Object.defineProperty(Set.prototype, 'has', {
		configurable: true,
		writable: true,
		value: replacement,
	});
	try {
		return callback();
	} finally {
		if (previous === undefined) Reflect.deleteProperty(Set.prototype, 'has');
		else Object.defineProperty(Set.prototype, 'has', previous);
	}
}

function withSpoofedSetHas<T>(spoofedValue: unknown, callback: () => T): T {
	const original = Set.prototype.has;
	return withSetHasOverride(function spoofedHas(value: unknown): boolean {
		if (value === spoofedValue) return true;
		return Reflect.apply(original, this, [value]) as boolean;
	}, callback);
}

test('unknown decision claims cannot become resolved Direct through Set.prototype.has', () => {
	const decision = {
		status: 'resolved',
		mechanism: 'direct',
		authoring: 'none',
		claims: ['future-claim'],
		obligations: [],
	} as unknown as InteropDecisionIR;

	withSpoofedSetHas('future-claim', () => {
		assert.equal(isResolvedDirectInteropDecision(decision), false);
		assert.throws(
			() => canonicalizeInteropDecision(decision),
			/Unknown Interop safety claim/u,
		);
	});
});

test('unknown foreign categories cannot become Direct through Set.prototype.has', () => {
	const usage = {
		kind: 'property',
		nodeId: 1,
		span: {
			fileId: 1,
			start: { offset: 0, line: 1, column: 1 },
			end: { offset: 1, line: 1, column: 2 },
		},
		foreignType: {
			display: 'future',
			category: 'future-category',
		},
	} as never;

	withSpoofedSetHas('future-category', () => {
		assert.throws(
			() => externalOperationFromUsage(usage),
			/Unknown foreign type category/u,
		);
	});
});

test('source-authored typeOnly cannot be hidden from reuse seals through Set.prototype.has', () => {
	const checked = compileSource({
		id: 1,
		path: '/virtual/set-membership-source.virune',
		text: [
			'import js "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {}',
			'',
		].join('\n'),
	}, { emit: false, platform: 'node', jsInteropProvider: provider() });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.ast);
	assert.equal(checked.ast.imports[0]?.typeOnly, false);

	withSpoofedSetHas('typeOnly', () => {
		const seal = captureCheckedSourceReuseSeal(checked.ast!);
		(checked.ast!.imports[0] as { typeOnly: boolean }).typeOnly = true;
		assert.equal(
			matchesCheckedSourceReuseSeal(checked.ast!, seal),
			false,
			'Set prototype spoofing must not classify source-authored typeOnly as checker-derived',
		);
	});
});

test('Set.prototype.has cannot erase the exact source object-graph witness', () => {
	const checked = compileSource({
		id: 2,
		path: '/virtual/set-membership-identity.virune',
		text: [
			'import js "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {}',
			'',
		].join('\n'),
	}, { emit: false, platform: 'node', jsInteropProvider: provider() });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.ast);

	withSetHasOverride(() => true, () => {
		const seal = captureCheckedSourceReuseSeal(checked.ast!);
		const replacement = Array.from(checked.ast!.imports);
		(checked.ast as { imports: typeof checked.ast.imports }).imports = replacement;
		assert.equal(
			matchesCheckedSourceReuseSeal(checked.ast!, seal),
			false,
			'structurally equivalent collection replacement must still fail exact identity checks',
		);
	});
});
