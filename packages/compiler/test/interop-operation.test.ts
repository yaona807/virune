import assert from 'node:assert/strict';
import test from 'node:test';
import type { Diagnostic } from '../src/diagnostics/diagnostic.js';
import { isResolvedDirectInteropDecision } from '../src/interop/decision.js';
import {
	buildExternalOperationSequence,
	externalModuleLoadOperation,
	externalOperationFromUsage,
} from '../src/interop/operation.js';
import type { ForeignUsageIR, InteropSemanticModel, ModuleResolutionWitness } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};
const stableString = {
	display: 'string',
	category: 'primitive' as const,
	primitive: 'string' as const,
	origin: { moduleSpecifier: './library.js', exportName: 'value' },
};

function usage(overrides: Partial<ForeignUsageIR>): ForeignUsageIR {
	return { kind: 'property', nodeId: 1, span, foreignType: stableString, ...overrides };
}

function witness(moduleSpecifier = './library.js'): ModuleResolutionWitness {
	return {
		moduleSpecifier,
		declarationEntry: 'types/library.d.ts',
		runtimeEntry: 'dist/library.js',
		runtimeFormat: 'esm',
		conditions: ['types', 'import', 'node'],
		platform: 'node',
		providerVersion: 'test-provider-1',
		declarationGraphHash: 'a'.repeat(64),
		packageJsonHash: 'b'.repeat(64),
	};
}

test('current property, call, await, and primitive bridge observations map to explicit Direct operations', () => {
	const property = externalOperationFromUsage(usage({ kind: 'property' }));
	assert.equal(property?.kind, 'read-property');
	assert.deepEqual(property?.decision.claims, []);
	assert.equal(Object.isFrozen(property), true);

	const call = externalOperationFromUsage(usage({ kind: 'call', receiverMode: 'preserve-this', mayReject: false }));
	assert.equal(call?.kind, 'call');
	assert.deepEqual(call?.decision.claims, ['receiver-preserved']);
	if (call?.kind === 'call') {
		assert.equal(call.receiverMode, 'preserve-this');
		assert.equal(call.mayReject, false);
	}

	const awaited = externalOperationFromUsage(usage({ kind: 'await', mayReject: true }));
	assert.equal(awaited?.kind, 'await');
	if (awaited?.kind === 'await') assert.equal(awaited.mayReject, true);

	const bridged = externalOperationFromUsage(usage({
		kind: 'bridge',
		bridge: { kind: 'primitive', bridge: 'string', targetType: 999 },
	}));
	assert.equal(bridged?.kind, 'bridge-foreign-primitive');
	if (bridged?.kind === 'bridge-foreign-primitive') {
		assert.equal(bridged.bridge, 'string');
		assert.deepEqual(bridged.decision.claims, ['primitive-bridge-validated']);
	}
	assert.equal(JSON.stringify(bridged).includes('999'), false);
});

test('partial, contradictory, and unknown usage facts fail closed', () => {
	assert.throws(() => externalOperationFromUsage(usage({ kind: 'call', mayReject: false })), /known receiver mode/u);
	assert.throws(() => externalOperationFromUsage(usage({ kind: 'call', receiverMode: 'none' })), /explicit rejection semantics/u);
	assert.throws(() => externalOperationFromUsage(usage({ kind: 'await' })), /explicit rejection semantics/u);
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'property', foreignType: { ...stableString, category: 'any' } })),
		/TypeScript any cannot become successful External operation evidence/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({
			kind: 'property',
			foreignType: { ...stableString, category: 'future-category' } as unknown as ForeignUsageIR['foreignType'],
		})),
		/Unknown foreign type category/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({
			kind: 'property',
			foreignType: { ...stableString, category: 'object' },
		})),
		/foreign primitive is incompatible with category object/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({
			kind: 'property',
			foreignType: { display: 'incomplete', category: 'primitive' },
		})),
		/primitive category requires an explicit primitive kind/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'bridge', bridge: { kind: 'primitive', bridge: 'float', targetType: 1 } })),
		/primitive bridge evidence disagrees/u,
	);
	assert.throws(
		() => externalOperationFromUsage({ ...usage({}), kind: 'future-usage' } as unknown as ForeignUsageIR),
		/Unknown Foreign usage kind/u,
	);

	const unknownBridge = externalOperationFromUsage(usage({
		kind: 'bridge',
		foreignType: { display: 'unknown', category: 'unknown', origin: stableString.origin },
		bridge: { kind: 'primitive', bridge: 'unknown', targetType: 1 },
	}));
	assert.equal(unknownBridge?.kind, 'bridge-foreign-primitive');
	if (unknownBridge?.kind === 'bridge-foreign-primitive') {
		assert.equal(unknownBridge.decision.status, 'unresolved');
		assert.equal(isResolvedDirectInteropDecision(unknownBridge.decision), false);
	}
});

test('ModuleLoad projects runtime evidence only and canonicalizes set-like conditions', () => {
	const operation = externalModuleLoadOperation({
		nodeId: 3,
		span,
		moduleSpecifier: './library.js',
		witnesses: [{
			...witness(),
			conditions: ['node', 'types', 'import', 'node'],
			declarationEntry: '/checkout/private/library.d.ts',
			providerVersion: '/checkout/provider-private-version',
			providerPrivate: '/checkout/provider-private-value',
		} as unknown as ModuleResolutionWitness],
	});
	assert.deepEqual(operation.runtimeWitness?.conditions, ['import', 'node', 'types']);
	assert.equal(isResolvedDirectInteropDecision(operation.decision), true);
	assert.deepEqual(operation.decision.obligations, [{ kind: 'runtime-resolution', stage: 'check', status: 'discharged' }]);
	const serialized = JSON.stringify(operation);
	for (const forbidden of ['providerVersion', 'declarationEntry', 'declarationGraphHash', 'providerPrivate', '/checkout/']) {
		assert.equal(serialized.includes(forbidden), false);
	}
});

test('ModuleLoad distinguishes build obligations and inconsistent witnesses from resolved Direct evidence', () => {
	const { runtimeEntry: _runtimeEntry, ...withoutRuntimeEntry } = witness();
	const bundlerWitness: ModuleResolutionWitness = {
		...withoutRuntimeEntry,
		runtimeFormat: 'bundler',
		platform: 'browser',
	};
	const bundler = externalModuleLoadOperation({ nodeId: 3, span, moduleSpecifier: './library.js', witnesses: [bundlerWitness] });
	assert.equal(bundler.decision.status, 'obligation-pending');
	assert.deepEqual(bundler.decision.obligations, [{ kind: 'runtime-resolution', stage: 'build', status: 'pending' }]);
	assert.equal(isResolvedDirectInteropDecision(bundler.decision), false);

	const inconsistent = externalModuleLoadOperation({
		nodeId: 3,
		span,
		moduleSpecifier: './library.js',
		witnesses: [witness(), { ...witness(), runtimeEntry: 'dist/other.js' }],
	});
	assert.equal(inconsistent.decision.status, 'unresolved');
	assert.equal(inconsistent.runtimeWitness, undefined);
	assert.equal(isResolvedDirectInteropDecision(inconsistent.decision), false);
});

test('ModuleLoad rejects malformed or contradictory provider facts that enter stable runtime evidence', () => {
	assert.throws(
		() => externalModuleLoadOperation({ nodeId: 1, span, moduleSpecifier: './library.js', witnesses: [{ ...witness(), moduleSpecifier: './other.js' }] }),
		/witness must resolve the same module specifier/u,
	);
	for (const runtimeEntry of ['/absolute/library.js', 'dist\\library.js', 'dist/../library.js', 'https://example.test/library.js']) {
		assert.throws(
			() => externalModuleLoadOperation({ nodeId: 1, span, moduleSpecifier: './library.js', witnesses: [{ ...witness(), runtimeEntry }] }),
			/External operation runtime entry/u,
		);
	}
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1, span, moduleSpecifier: './library.js',
			witnesses: [{ ...witness(), runtimeFormat: 'future-format' } as unknown as ModuleResolutionWitness],
		}),
		/Unknown module witness runtime format/u,
	);
	assert.throws(
		() => externalModuleLoadOperation({ nodeId: 1, span, moduleSpecifier: './library.js', witnesses: [{ ...witness(), packageJsonHash: 'not-a-sha256' }] }),
		/runtime package\.json hash must be a lowercase SHA-256 digest/u,
	);
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: 'node:fs',
			witnesses: [{ ...witness('node:fs'), runtimeEntry: 'node:fs', runtimeFormat: 'esm' }],
		}),
		/node: module specifier requires matching builtin runtime evidence/u,
	);
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: 'node:fs',
			witnesses: [{ ...witness('node:fs'), runtimeEntry: 'node:fs', runtimeFormat: 'builtin', platform: 'browser' }],
		}),
		/node: module specifier requires matching builtin runtime evidence/u,
	);
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: './library.js',
			witnesses: [{ ...witness(), runtimeFormat: 'builtin' }],
		}),
		/builtin runtime format requires a node builtin runtime entry/u,
	);

	const builtin = externalModuleLoadOperation({
		nodeId: 1,
		span,
		moduleSpecifier: 'node:fs',
		witnesses: [{ ...witness('node:fs'), runtimeEntry: 'node:fs', runtimeFormat: 'builtin', platform: 'node' }],
	});
	assert.equal(isResolvedDirectInteropDecision(builtin.decision), true);
});

test('operation sequence preserves runtime import source order, includes side effects, and excludes type-only imports', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/main.virune',
		text: [
			'import js { value } from "./first.js"',
			'import js "./side-effect.js"',
			'import js type { Shape } from "./types.js"',
			'import js * as ns from "./third.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\treturn Unit',
			'}',
			'',
		].join('\n'),
	});
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const interop: InteropSemanticModel = {
		usages: [],
		usageIR: [],
		moduleWitnesses: [witness('./first.js'), witness('./side-effect.js'), witness('./types.js'), witness('./third.js')],
		requiresJavaScriptInitialization: true,
	};
	const operations = buildExternalOperationSequence({ module: parsed.ast, interop, diagnostics: [] });
	assert.deepEqual(operations.map(operation => operation.kind), ['module-load', 'module-load', 'module-load']);
	assert.deepEqual(
		operations.map(operation => operation.kind === 'module-load' ? operation.moduleSpecifier : undefined),
		['./first.js', './side-effect.js', './third.js'],
	);
});

test('missing or extra module witness evidence fails closed', () => {
	const parsed = parseSource({ id: 1, path: '/virtual/main.virune', text: 'import js "./library.js"\n' });
	assert.ok(parsed.ast);
	assert.throws(
		() => buildExternalOperationSequence({
			module: parsed.ast!,
			interop: { usages: [], usageIR: [], moduleWitnesses: [], requiresJavaScriptInitialization: true },
			diagnostics: [],
		}),
		/missing module witnesses/u,
	);
	assert.throws(
		() => buildExternalOperationSequence({
			module: parsed.ast!,
			interop: { usages: [], usageIR: [], moduleWitnesses: [witness(), witness()], requiresJavaScriptInitialization: true },
			diagnostics: [],
		}),
		/unconsumed module witnesses/u,
	);
});

test('invalid modules expose no successful operation sequence', () => {
	const parsed = parseSource({ id: 1, path: '/virtual/main.virune', text: 'import js "./library.js"\n' });
	assert.ok(parsed.ast);
	const interop: InteropSemanticModel = {
		usages: [], usageIR: [], moduleWitnesses: [witness()], requiresJavaScriptInitialization: true,
	};
	const diagnostics: Diagnostic[] = [{ code: 'L9999', severity: 'error', message: 'synthetic failure', span }];
	assert.deepEqual(buildExternalOperationSequence({ module: parsed.ast, interop, diagnostics }), []);
});

test('equivalent checkout roots serialize identical provider-independent value evidence', () => {
	const first = externalOperationFromUsage(usage({
		kind: 'property',
		foreignType: {
			...stableString,
			display: 'import("/checkout/a/node_modules/pkg/index.d.ts").Value',
			origin: { ...stableString.origin, declarationPath: '/checkout/a/node_modules/pkg/index.d.ts' },
		},
	}));
	const second = externalOperationFromUsage(usage({
		kind: 'property',
		foreignType: {
			...stableString,
			display: 'import("/checkout/b/node_modules/pkg/index.d.ts").Value',
			origin: { ...stableString.origin, declarationPath: '/checkout/b/node_modules/pkg/index.d.ts' },
		},
	}));
	assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('package identity never selects operation mechanism or safety claims', () => {
	const first = externalOperationFromUsage(usage({ kind: 'property', foreignType: { ...stableString, origin: { ...stableString.origin, packageName: 'react' } } }));
	const second = externalOperationFromUsage(usage({ kind: 'property', foreignType: { ...stableString, origin: { ...stableString.origin, packageName: 'some-other-package' } } }));
	assert.equal(first?.kind, second?.kind);
	assert.deepEqual(first?.decision, second?.decision);
});
