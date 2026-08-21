import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSource } from '../src/project/project.js';
import type { Diagnostic } from '../src/diagnostics/diagnostic.js';
import type { ForeignUsageIR, InteropSemanticModel, ModuleResolutionWitness } from '../src/interop/types.js';
import {
	externalModuleLoadOperation,
	externalOperationFromUsage,
	externalOperationSequence,
} from '../src/interop/operation.js';
import { isResolvedDirectInteropDecision } from '../src/interop/decision.js';

const span = {
	fileId: 1,
	start: { offset: 0, line: 1, column: 1 },
	end: { offset: 1, line: 1, column: 2 },
};

const stableString = {
	display: 'string',
	category: 'primitive' as const,
	primitive: 'string' as const,
	origin: {
		moduleSpecifier: './library.js',
		exportName: 'value',
	},
};

function usage(overrides: Partial<ForeignUsageIR>): ForeignUsageIR {
	return {
		kind: 'property',
		nodeId: 1,
		span,
		foreignType: stableString,
		...overrides,
	};
}

test('import usages never infer ModuleLoad semantics from bound-value observations', () => {
	const operation = externalOperationFromUsage(usage({
		kind: 'import',
		runtimeImport: { kind: 'type-only' },
		moduleWitness: witness(),
	}));
	assert.equal(operation, undefined);
});

test('ModuleLoad keeps only runtime resolution evidence and strips declaration/provider-private metadata', () => {
	const providerPrivate = '/temporary/provider/private.d.ts';
	const operation = externalModuleLoadOperation({
		nodeId: 3,
		span,
		moduleSpecifier: './library.js',
		witnesses: [{
			...witness(),
			declarationEntry: '/checkout/private/library.d.ts',
			providerVersion: '/checkout/provider-private-version',
			conditions: ['types', 'import', 'node'],
			providerPrivate,
		} as unknown as ModuleResolutionWitness],
	});

	assert.equal(operation.kind, 'module-load');
	assert.deepEqual(operation.runtimeWitness?.conditions, ['import', 'node', 'types'], 'runtime conditions are canonical active-set evidence, not provider construction order');
	assert.equal(isResolvedDirectInteropDecision(operation.decision), true);
	assert.deepEqual(operation.decision.obligations, [
		{ kind: 'runtime-resolution', stage: 'check', status: 'discharged' },
	]);
	const serialized = JSON.stringify(operation);
	assert.equal(serialized.includes('providerVersion'), false);
	assert.equal(serialized.includes('declarationEntry'), false);
	assert.equal(serialized.includes('declarationGraphHash'), false);
	assert.equal(serialized.includes('providerPrivate'), false);
	assert.equal(serialized.includes('/checkout/'), false);
});

test('ModuleLoad represents bundler runtime resolution as a pending build obligation', () => {
	const { runtimeEntry: _runtimeEntry, ...withoutRuntimeEntry } = witness();
	const operation = externalModuleLoadOperation({
		nodeId: 3,
		span,
		moduleSpecifier: './library.js',
		witnesses: [{ ...withoutRuntimeEntry, platform: 'browser', runtimeFormat: 'bundler' }],
	});
	assert.equal(operation.decision.status, 'obligation-pending');
	assert.equal(operation.decision.mechanism, 'direct');
	assert.deepEqual(operation.decision.obligations, [
		{ kind: 'runtime-resolution', stage: 'build', status: 'pending' },
	]);
	assert.equal(isResolvedDirectInteropDecision(operation.decision), false);
});

test('ModuleLoad does not promote inconsistent binding witnesses to resolved Direct evidence', () => {
	const operation = externalModuleLoadOperation({
		nodeId: 3,
		span,
		moduleSpecifier: './library.js',
		witnesses: [
			witness(),
			{ ...witness(), runtimeEntry: 'dist/other.js' },
		],
	});
	assert.equal(operation.decision.status, 'unresolved');
	assert.equal(operation.runtimeWitness, undefined);
	assert.equal(isResolvedDirectInteropDecision(operation.decision), false);
});

test('ModuleLoad rejects mismatched, absolute, noncanonical, or unknown runtime witness facts', () => {
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: './library.js',
			witnesses: [{ ...witness(), moduleSpecifier: './other.js' }],
		}),
		/witness must resolve the same module specifier/u,
	);
	for (const invalidWitness of [
		{ ...witness(), runtimeEntry: '/absolute/library.js' },
		{ ...witness(), runtimeEntry: 'C:/absolute/library.js' },
		{ ...witness(), runtimeEntry: 'dist\\library.js' },
		{ ...witness(), runtimeEntry: 'dist/../library.js' },
	]) {
		assert.throws(
			() => externalModuleLoadOperation({ nodeId: 1, span, moduleSpecifier: './library.js', witnesses: [invalidWitness] }),
			/External operation runtime entry/u,
		);
	}
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: './library.js',
			witnesses: [{ ...witness(), runtimeFormat: 'future-format' } as unknown as ModuleResolutionWitness],
		}),
		/Unknown module witness runtime format/u,
	);
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: './library.js',
			witnesses: [{ ...witness(), platform: 'future-platform' } as unknown as ModuleResolutionWitness],
		}),
		/Unknown module witness platform/u,
	);
	assert.throws(
		() => externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier: './library.js',
			witnesses: [{ ...witness(), packageJsonHash: 'not-a-sha256' }],
		}),
		/runtime package\.json hash must be a lowercase SHA-256 digest/u,
	);
});

test('current property/call/await observations map to explicit Direct operations without stronger library claims', () => {
	const property = externalOperationFromUsage(usage({ kind: 'property' }));
	assert.equal(property?.kind, 'read-property');
	assert.deepEqual(property?.decision.claims, []);

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
});

test('call and await observations fail closed when required execution semantics are partial', () => {
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'call', mayReject: false })),
		/requires a known receiver mode/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'call', receiverMode: 'none' })),
		/requires explicit rejection semantics/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({ kind: 'await' })),
		/requires explicit rejection semantics/u,
	);
});

test('primitive bridge evidence drops ephemeral TypeId, display paths, declaration paths, and unknown provider metadata', () => {
	const privatePath = '/checkout/private/provider.ts';
	const operation = externalOperationFromUsage(usage({
		kind: 'bridge',
		foreignType: {
			...stableString,
			display: `import("${privatePath}").Value`,
			origin: {
				...stableString.origin,
				declarationPath: privatePath,
				providerPrivatePath: privatePath,
			} as unknown as typeof stableString.origin,
			providerPrivatePath: privatePath,
		} as unknown as ForeignUsageIR['foreignType'],
		bridge: {
			kind: 'primitive',
			bridge: 'string',
			targetType: 987654,
		},
	}));

	assert.equal(operation?.kind, 'bridge-foreign-primitive');
	if (operation?.kind === 'bridge-foreign-primitive') {
		assert.equal(operation.bridge, 'string');
		assert.deepEqual(operation.decision.claims, ['primitive-bridge-validated']);
	}
	const serialized = JSON.stringify(operation);
	assert.equal(serialized.includes('987654'), false, 'compiler TypeId must not enter stable operation evidence');
	assert.equal(serialized.includes('display'), false);
	assert.equal(serialized.includes('declarationPath'), false);
	assert.equal(serialized.includes('providerPrivatePath'), false);
	assert.equal(serialized.includes(privatePath), false);
});

test('unknown foreign, bridge, and usage enum values fail closed', () => {
	assert.throws(
		() => externalOperationFromUsage(usage({
			kind: 'property',
			foreignType: { ...stableString, category: 'future-category' } as unknown as ForeignUsageIR['foreignType'],
		})),
		/Unknown foreign type category/u,
	);
	assert.throws(
		() => externalOperationFromUsage(usage({
			kind: 'bridge',
			bridge: { kind: 'primitive', bridge: 'future-bridge', targetType: 1 } as unknown as NonNullable<ForeignUsageIR['bridge']>,
		})),
		/Unknown primitive bridge/u,
	);
	assert.throws(
		() => externalOperationFromUsage({ ...usage({}), kind: 'future-usage' } as unknown as ForeignUsageIR),
		/Unknown Foreign usage kind/u,
	);
});

test('External Operation sequence preserves import source order, includes side effects, and excludes type-only ModuleLoad', () => {
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
			'}',
			'',
		].join('\n'),
	});
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);
	const interop: InteropSemanticModel = {
		usages: [],
		usageIR: [],
		moduleWitnesses: [
			witness('./first.js'),
			witness('./side-effect.js'),
			witness('./types.js'),
			witness('./third.js'),
		],
		requiresJavaScriptInitialization: true,
	};
	const operations = externalOperationSequence({ module: parsed.ast, interop, diagnostics: [] });
	assert.deepEqual(operations.map(operation => operation.kind), [
		'module-load',
		'module-load',
		'module-load',
	]);
	assert.deepEqual(
		operations.map(operation => operation.kind === 'module-load' ? operation.moduleSpecifier : undefined),
		['./first.js', './side-effect.js', './third.js'],
	);
});

test('External Operation sequence withholds successful Direct evidence from invalid modules', () => {
	const parsed = parseSource({ id: 1, path: '/virtual/main.virune', text: 'import js "./library.js"\n' });
	assert.ok(parsed.ast);
	const interop: InteropSemanticModel = {
		usages: [],
		usageIR: [usage({ kind: 'call', receiverMode: 'none', mayReject: false })],
		moduleWitnesses: [witness()],
		requiresJavaScriptInitialization: true,
	};
	const diagnostics: Diagnostic[] = [{
		code: 'L9999',
		severity: 'error',
		message: 'synthetic later failure',
		span,
	}];
	assert.deepEqual(externalOperationSequence({ module: parsed.ast, interop, diagnostics }), []);
});

test('External Operation sequence rejects stale or partial module witness sequences fail closed', () => {
	const parsed = parseSource({ id: 1, path: '/virtual/main.virune', text: 'import js "./library.js"\n' });
	assert.ok(parsed.ast);
	assert.throws(
		() => externalOperationSequence({
			module: parsed.ast!,
			interop: { usages: [], usageIR: [], moduleWitnesses: [], requiresJavaScriptInitialization: true },
			diagnostics: [],
		}),
		/missing module witnesses/u,
	);
	assert.throws(
		() => externalOperationSequence({
			module: parsed.ast!,
			interop: { usages: [], usageIR: [], moduleWitnesses: [witness(), witness()], requiresJavaScriptInitialization: true },
			diagnostics: [],
		}),
		/unconsumed module witnesses/u,
	);
});

test('External Operation sequence rejects stale or cross-session usage anchors fail closed', () => {
	const parsed = parseSource({ id: 1, path: '/virtual/main.virune', text: 'import js { value } from "./library.js"\n' });
	assert.ok(parsed.ast);
	const declaration = parsed.ast.imports[0]!;
	const validImportUsage: ForeignUsageIR = usage({
		kind: 'import',
		nodeId: declaration.id,
		span: declaration.span,
		runtimeImport: { kind: 'named', importedName: 'value' },
		moduleWitness: witness(),
	});
	const base: InteropSemanticModel = {
		usages: [],
		usageIR: [validImportUsage],
		moduleWitnesses: [witness()],
		requiresJavaScriptInitialization: true,
	};
	assert.equal(externalOperationSequence({ module: parsed.ast, interop: base, diagnostics: [] })[0]?.kind, 'module-load');
	assert.throws(
		() => externalOperationSequence({
			module: parsed.ast!,
			interop: { ...base, usageIR: [{ ...validImportUsage, nodeId: declaration.id + 999 }] },
			diagnostics: [],
		}),
		/Stale or cross-session External usage evidence/u,
	);
	assert.throws(
		() => externalOperationSequence({
			module: parsed.ast!,
			interop: {
				...base,
				usageIR: [{
					...validImportUsage,
					span: { ...declaration.span, start: { ...declaration.span.start, offset: declaration.span.start.offset + 1 } },
				}],
			},
			diagnostics: [],
		}),
		/Stale or cross-session External usage evidence/u,
	);
});

test('equivalent checkout roots serialize identical External value evidence', () => {
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
	const first = externalOperationFromUsage(usage({
		kind: 'property',
		foreignType: { ...stableString, origin: { ...stableString.origin, packageName: 'react' } },
	}));
	const second = externalOperationFromUsage(usage({
		kind: 'property',
		foreignType: { ...stableString, origin: { ...stableString.origin, packageName: 'some-other-package' } },
	}));
	assert.equal(first?.kind, second?.kind);
	assert.deepEqual(first?.decision, second?.decision);
});

test('ModuleLoad preserves source-authored module specifier bytes', () => {
	for (const moduleSpecifier of ['', '/explicit/library.js']) {
		const operation = externalModuleLoadOperation({
			nodeId: 1,
			span,
			moduleSpecifier,
			witnesses: [witness(moduleSpecifier)],
		});
		assert.equal(operation.moduleSpecifier, moduleSpecifier);
		assert.equal(operation.runtimeWitness?.moduleSpecifier, moduleSpecifier);
		assert.equal(operation.decision.status, 'resolved');
	}
});

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
