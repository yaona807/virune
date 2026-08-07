import assert from 'node:assert/strict';
import test from 'node:test';
import {
	classifyInterop,
	type InteropCallbackFacts,
	type InteropDuplexFacts,
	type InteropFacetIR,
	type InteropFacts,
	type InteropProfile,
	type InteropResourceFacts,
	type InteropTransfer,
} from '../src/classifier.js';

interface FactOverrides {
	readonly shape?: Partial<InteropFacetIR>;
	readonly profile?: Partial<InteropProfile>;
	readonly inputTransfer?: InteropTransfer;
	readonly outputTransfer?: InteropTransfer;
	readonly callback?: InteropCallbackFacts;
	readonly resource?: InteropResourceFacts;
	readonly duplex?: InteropDuplexFacts;
	readonly lifecycleAuthority?: InteropFacts['lifecycleAuthority'];
	readonly nativeCallableOutbound?: boolean;
	readonly evidenceConflict?: boolean;
}

function facts(overrides: FactOverrides = {}): InteropFacts {
	const shape: InteropFacetIR = {
		facets: ['call'],
		runtimeRepresentation: 'function',
		typeCertainty: 'declared',
		callResolution: 'resolved',
		receiver: 'none',
		structuralData: 'none',
		runtimeBinding: 'verified',
		dynamic: false,
		...overrides.shape,
	};
	const profile: InteropProfile = {
		direction: 'bidirectional',
		cardinality: 'one',
		lifetime: 'call',
		ownership: 'value',
		delivery: 'sync',
		concurrency: 'concurrent',
		flowControl: 'none',
		realm: 'same',
		execution: 'normal',
		environment: 'node',
		...overrides.profile,
	};
	return {
		shape,
		profile,
		inputTransfer: overrides.inputTransfer ?? 'primitive',
		outputTransfer: overrides.outputTransfer ?? 'primitive',
		...(overrides.callback === undefined ? {} : { callback: overrides.callback }),
		...(overrides.resource === undefined ? {} : { resource: overrides.resource }),
		...(overrides.duplex === undefined ? {} : { duplex: overrides.duplex }),
		...(overrides.lifecycleAuthority === undefined ? {} : { lifecycleAuthority: overrides.lifecycleAuthority }),
		...(overrides.nativeCallableOutbound === undefined ? {} : { nativeCallableOutbound: overrides.nativeCallableOutbound }),
		...(overrides.evidenceConflict === undefined ? {} : { evidenceConflict: overrides.evidenceConflict }),
	};
}

test('classifies a declared primitive call as auto-safe', () => {
	const decision = classifyInterop(facts());
	assert.equal(decision.gate, 'AUTO_SAFE');
	assert.deepEqual(decision.plan.controls, ['direct-call']);
	assert.equal(decision.plan.handle, 'none');
	assert.deepEqual(decision.reasons, []);
});

test('keeps one-shot promise work on the operation control axis', () => {
	const decision = classifyInterop(facts({ profile: { delivery: 'promise', lifetime: 'operation' } }));
	assert.equal(decision.gate, 'AUTO_SAFE');
	assert.deepEqual(decision.plan.controls, ['operation']);
});

test('routes a proven repeated callback through a push session adapter', () => {
	const decision = classifyInterop(facts({
		profile: { delivery: 'callback', lifetime: 'session', cardinality: 'unbounded' },
		lifecycleAuthority: 'caller',
		callback: { cardinality: 'many', lifetime: 'session', escapes: 'yes', setupRollback: 'guaranteed' },
	}));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['push-session']);
	assert.ok(decision.reasons.includes('CALLBACK_REQUIRES_ADAPTER'));
});

test('does not guess callback semantics when cardinality and lifetime are unknown', () => {
	const decision = classifyInterop(facts({
		profile: { delivery: 'callback', lifetime: 'session' },
		callback: { cardinality: 'unknown', lifetime: 'unknown', escapes: 'unknown', setupRollback: 'unknown' },
	}));
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.ok(decision.reasons.includes('AMBIGUOUS_CALLBACK'));
	assert.ok(decision.reasons.includes('AMBIGUOUS_LIFETIME'));
	assert.ok(decision.reasons.includes('AMBIGUOUS_SETUP_ROLLBACK'));
});

test('recognizes async iterator protocol as a pull-source adapter', () => {
	const decision = classifyInterop(facts({
		shape: { facets: ['async-iterator'], runtimeRepresentation: 'object' },
		profile: { delivery: 'iterator', cardinality: 'unbounded', lifetime: 'session' },
		lifecycleAuthority: 'caller',
		outputTransfer: 'codec',
	}));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['pull-source']);
	assert.ok(decision.reasons.includes('ASYNC_ITERATOR_REQUIRES_PULL_SOURCE'));
});

test('requires semantic evidence before structural objects become codecs', () => {
	const decision = classifyInterop(facts({
		shape: { runtimeRepresentation: 'object', structuralData: 'snapshot-unknown' },
		outputTransfer: 'codec',
	}));
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.ok(decision.reasons.includes('STRUCTURAL_OBJECT_REQUIRES_SNAPSHOT_EVIDENCE'));
});

test('models resource management on the handle axis without replacing call control', () => {
	const decision = classifyInterop(facts({
		profile: { lifetime: 'resource', ownership: 'owned' },
		outputTransfer: 'foreign-identity',
		resource: {
			cleanupProtocol: 'known',
			ownershipAuthority: 'owned',
			shutdownPolicy: 'drain',
			cleanupErrorPolicy: 'aggregate',
		},
	}));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['direct-call']);
	assert.equal(decision.plan.handle, 'managed-resource');
	assert.ok(decision.reasons.includes('RESOURCE_REQUIRES_MANAGED_HANDLE'));
});

test('keeps a resource unresolved at the semantic layer while ownership is unknown', () => {
	const decision = classifyInterop(facts({
		profile: { lifetime: 'resource', ownership: 'unknown' },
		resource: {
			cleanupProtocol: 'known',
			ownershipAuthority: 'unknown',
			shutdownPolicy: 'cancel',
			cleanupErrorPolicy: 'primary-wins',
		},
	}));
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.ok(decision.reasons.includes('AMBIGUOUS_OWNERSHIP'));
});

test('uses host wiring when the framework owns lifecycle', () => {
	const decision = classifyInterop(facts({ lifecycleAuthority: 'host' }));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['host-wiring']);
	assert.ok(decision.reasons.includes('FRAMEWORK_OWNS_LIFECYCLE'));
});

test('realm boundaries remain orthogonal to operation control', () => {
	const decision = classifyInterop(facts({
		profile: { delivery: 'promise', lifetime: 'operation', realm: 'worker' },
		inputTransfer: 'codec',
		outputTransfer: 'codec',
	}));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['operation']);
	assert.equal(decision.plan.realm, 'worker');
	assert.ok(decision.reasons.includes('REALM_BOUNDARY'));
});

test('does not call a duplex surface auto-safe without termination and flow-control semantics', () => {
	const decision = classifyInterop(facts({
		shape: { facets: ['duplex'], runtimeRepresentation: 'object' },
		profile: { delivery: 'stream', lifetime: 'session', cardinality: 'unbounded', flowControl: 'unknown' },
		lifecycleAuthority: 'caller',
	}));
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['stream-source', 'duplex-session']);
	assert.ok(decision.reasons.includes('AMBIGUOUS_DUPLEX_TERMINATION'));
	assert.ok(decision.reasons.includes('AMBIGUOUS_FLOW_CONTROL'));
});

test('accepts known duplex semantics as adapter-required rather than ambiguous', () => {
	const decision = classifyInterop(facts({
		shape: { facets: ['duplex'], runtimeRepresentation: 'object' },
		profile: { delivery: 'stream', lifetime: 'session', cardinality: 'unbounded', flowControl: 'backpressure' },
		lifecycleAuthority: 'caller',
		duplex: { directionalTermination: 'known', upstreamFlowControl: 'native' },
	}));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.ok(decision.plan.controls.includes('duplex-session'));
	assert.ok(!decision.reasons.includes('AMBIGUOUS_DUPLEX_TERMINATION'));
});

test('treats evidence conflict as unresolved even when the shape otherwise looks direct-safe', () => {
	const decision = classifyInterop(facts({ evidenceConflict: true }));
	assert.equal(decision.gate, 'UNRESOLVED');
	assert.ok(decision.reasons.includes('EVIDENCE_CONFLICT'));
});

test('does not allow native callable capabilities to cross an outbound safe boundary', () => {
	const decision = classifyInterop(facts({ nativeCallableOutbound: true }));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['direct-call']);
	assert.ok(decision.reasons.includes('NATIVE_CALLABLE_OUTBOUND'));
});

test('routes symbol-valued surfaces away from direct safe bridging', () => {
	const decision = classifyInterop(facts({ shape: { runtimeRepresentation: 'symbol' } }));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.ok(decision.reasons.includes('SYMBOL_REQUIRES_ADAPTER'));
});

test('fails closed when a callable surface lacks TypeScript call-resolution evidence', () => {
	const decision = classifyInterop(facts({ shape: { callResolution: 'unknown' } }));
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.ok(decision.reasons.includes('CALL_RESOLUTION_UNKNOWN'));
});

test('fails closed when lifecycle is unknown even if the callable shape otherwise looks direct', () => {
	const decision = classifyInterop(facts({ profile: { lifetime: 'unknown' } }));
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.ok(decision.reasons.includes('AMBIGUOUS_LIFETIME'));
});

test('classifies a verified primitive value surface as direct access', () => {
	const decision = classifyInterop(facts({
		shape: { facets: ['value'], runtimeRepresentation: 'string' },
	}));
	assert.equal(decision.gate, 'AUTO_SAFE');
	assert.deepEqual(decision.plan.controls, ['direct-access']);
});

test('requires an adapter for constructor surfaces without inventing a new core control topology', () => {
	const decision = classifyInterop(facts({ shape: { facets: ['construct'], receiver: 'none' } }));
	assert.equal(decision.gate, 'ADAPTER_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['direct-call']);
	assert.ok(decision.reasons.includes('CONSTRUCTOR_REQUIRES_ADAPTER'));
});

test('does not claim a raw foreign identity can cross a realm boundary', () => {
	const decision = classifyInterop(facts({
		profile: { delivery: 'promise', lifetime: 'operation', realm: 'worker' },
		outputTransfer: 'foreign-identity',
	}));
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['operation']);
	assert.ok(decision.reasons.includes('FOREIGN_IDENTITY_CROSSES_REALM'));
});

test('does not return AUTO_SAFE for a surface whose control topology is unknown', () => {
	const decision = classifyInterop(facts({
		shape: { facets: [], runtimeRepresentation: 'object', runtimeBinding: 'not-applicable' },
	}));
	assert.equal(decision.gate, 'SEMANTICS_REQUIRED');
	assert.deepEqual(decision.plan.controls, ['unknown']);
	assert.ok(decision.reasons.includes('UNKNOWN_CONTROL'));
});
