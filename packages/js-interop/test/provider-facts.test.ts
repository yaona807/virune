import assert from 'node:assert/strict';
import test from 'node:test';
import type { ForeignCallResolution, ForeignTypeSnapshot, JsImportResolution, ModuleResolutionWitness } from '@virune/compiler/experimental';
import { classifyInterop } from '../src/classifier.js';
import { extractProviderInteropFacts, factsFromImportResolution } from '../src/provider-facts.js';

function snapshot(overrides: Partial<ForeignTypeSnapshot> = {}): ForeignTypeSnapshot {
	return {
		ref: { providerId: 'typescript', generation: 1, id: 't1' },
		display: '(value: string) => string',
		category: 'function',
		origin: { moduleSpecifier: 'fixture', declarationPath: '/repo/node_modules/fixture/index.d.ts', exportName: 'default' },
		...overrides,
	};
}

function witness(): ModuleResolutionWitness {
	return {
		moduleSpecifier: 'fixture',
		declarationEntry: '/repo/node_modules/fixture/index.d.ts',
		runtimeEntry: '/repo/node_modules/fixture/index.js',
		runtimeFormat: 'esm',
		conditions: ['import', 'node'],
		platform: 'node',
		providerVersion: 'typescript-6.0.3',
	};
}

function call(result: ForeignTypeSnapshot, overrides: Partial<ForeignCallResolution> = {}): ForeignCallResolution {
	return { result, parameterCount: 1, optionalParameterCount: 0, rest: false, mayReject: false, receiverMode: 'preserve-this', ...overrides };
}

test('import resolution stays runtime-unverified until a runtime witness exists', () => {
	const resolution: JsImportResolution = { type: snapshot(), runtime: { kind: 'default' }, witness: witness() };
	const facts = factsFromImportResolution(resolution);
	assert.ok(facts !== undefined);
	assert.deepEqual(facts.shape.facets, ['value', 'call']);
	assert.equal(facts.shape.runtimeBinding, 'unverified');
	assert.equal(facts.shape.typeCertainty, 'declared');
	assert.equal(classifyInterop(facts).gate, 'SEMANTICS_REQUIRED');
});

test('resolved standalone primitive call is auto-safe only with explicit receiver and runtime evidence', () => {
	const result = snapshot({ display: 'string', category: 'primitive', primitive: 'string' });
	const facts = extractProviderInteropFacts({
		usage: 'call', subject: snapshot(), callResolution: call(result),
		argumentsList: [{ kind: 'native-primitive', primitive: 'String' }],
		runtimeBinding: 'verified', receiver: 'none', witness: witness(),
	});
	const decision = classifyInterop(facts);
	assert.equal(decision.gate, 'AUTO_SAFE');
	assert.deepEqual(decision.plan.controls, ['direct-call']);
	assert.equal(decision.plan.outputTransfer, 'primitive');
});

test('provider preserve-this does not prove receiver independence', () => {
	const result = snapshot({ display: 'string', category: 'primitive', primitive: 'string' });
	const facts = extractProviderInteropFacts({ usage: 'call', subject: snapshot(), callResolution: call(result), runtimeBinding: 'verified' });
	const decision = classifyInterop(facts);
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.ok(decision.reasons.includes('AMBIGUOUS_RECEIVER'));
});

test('promise call maps to operation without inventing execution or concurrency facts', () => {
	const result = snapshot({ display: 'Promise<string>', category: 'promise' });
	const facts = extractProviderInteropFacts({
		usage: 'call', subject: snapshot(), callResolution: call(result, { mayReject: true }),
		argumentsList: [], runtimeBinding: 'verified', receiver: 'none',
	});
	assert.equal(facts.profile.delivery, 'promise');
	assert.equal(facts.profile.lifetime, 'operation');
	assert.equal(facts.profile.execution, 'unknown');
	assert.equal(facts.profile.concurrency, 'unknown');
	assert.deepEqual(classifyInterop(facts).plan.controls, ['operation']);
});

test('derived property remains runtime-unverified', () => {
	const facts = extractProviderInteropFacts({ usage: 'property', subject: snapshot({ display: 'string', category: 'primitive', primitive: 'string' }), witness: witness() });
	const decision = classifyInterop(facts);
	assert.equal(facts.shape.runtimeBinding, 'unverified');
	assert.ok(decision.reasons.includes('RUNTIME_BINDING_UNVERIFIED'));
});

test('any and unions never become auto-safe from type evidence alone', () => {
	const anyFacts = extractProviderInteropFacts({ usage: 'import', subject: snapshot({ display: 'any', category: 'any' }), runtimeBinding: 'verified' });
	assert.equal(classifyInterop(anyFacts).gate, 'UNRESOLVED');
	const unionFacts = extractProviderInteropFacts({ usage: 'import', subject: snapshot({ display: 'string | number', category: 'union' }), runtimeBinding: 'verified' });
	assert.notEqual(classifyInterop(unionFacts).gate, 'AUTO_SAFE');
});

test('construct signatures remain adapter-required', () => {
	const result = snapshot({ display: 'Client', category: 'object' });
	const facts = extractProviderInteropFacts({
		usage: 'construct', subject: snapshot({ display: 'new () => Client', category: 'constructor' }),
		callResolution: call(result, { parameterCount: 0, receiverMode: 'none' }), runtimeBinding: 'verified', receiver: 'none',
	});
	assert.ok(classifyInterop(facts).reasons.includes('CONSTRUCTOR_REQUIRES_ADAPTER'));
});

test('foreign identity ownership stays unknown without behavioral evidence', () => {
	const result = snapshot({ display: 'Client', category: 'object' });
	const facts = extractProviderInteropFacts({ usage: 'call', subject: snapshot(), callResolution: call(result), runtimeBinding: 'verified', receiver: 'none' });
	assert.equal(facts.outputTransfer, 'foreign-identity');
	assert.equal(facts.profile.ownership, 'unknown');
});

test('unresolved calls do not invent result, delivery, lifetime, or cardinality', () => {
	const facts = extractProviderInteropFacts({ usage: 'call', subject: snapshot(), runtimeBinding: 'verified', receiver: 'none' });
	assert.equal(facts.outputTransfer, 'unknown');
	assert.equal(facts.profile.delivery, 'unknown');
	assert.equal(facts.profile.lifetime, 'unknown');
	assert.equal(facts.profile.cardinality, 'unknown');
	assert.ok(classifyInterop(facts).reasons.includes('CALL_RESOLUTION_UNKNOWN'));
});

test('await without awaited-type evidence leaves the output unresolved', () => {
	const facts = extractProviderInteropFacts({ usage: 'await', subject: snapshot({ display: 'Promise<User>', category: 'promise' }), runtimeBinding: 'verified' });
	assert.equal(facts.outputTransfer, 'unknown');
	assert.ok(classifyInterop(facts).reasons.includes('UNKNOWN_TRANSFER'));
});

test('resolution evidence is recorded but never promoted to behavioral proof', () => {
	const facts = extractProviderInteropFacts({ usage: 'import', subject: snapshot(), witness: witness(), runtimeBinding: 'verified' });
	assert.ok(facts.evidence?.some(item => item.source === 'resolution-witness'));
	assert.equal(facts.profile.execution, 'unknown');
	assert.equal(facts.profile.concurrency, 'unknown');
});
