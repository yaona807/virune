export type InteropTargetProfile = 'node' | 'browser' | 'worker' | 'edge' | 'neutral';

export type InteropRuntimeRepresentation =
	| 'boolean'
	| 'string'
	| 'number'
	| 'bigint'
	| 'symbol'
	| 'null'
	| 'undefined'
	| 'function'
	| 'object'
	| 'array'
	| 'promise'
	| 'never'
	| 'unknown';

export type InteropEvidenceSource =
	| 'declaration'
	| 'typescript-source'
	| 'jsdoc'
	| 'javascript-inference'
	| 'static-behavior'
	| 'standard-protocol'
	| 'adapter-contract'
	| 'runtime-observation'
	| 'resolution-witness';

export interface InteropEvidence {
	readonly source: InteropEvidenceSource;
	readonly fact: string;
	readonly detail?: string;
}

export type InteropFacetKind =
	| 'value'
	| 'call'
	| 'construct'
	| 'property'
	| 'index'
	| 'iterator'
	| 'async-iterator'
	| 'stream-source'
	| 'stream-sink'
	| 'duplex'
	| 'disposable'
	| 'async-disposable';

export interface InteropFacetIR {
	readonly facets: readonly InteropFacetKind[];
	readonly runtimeRepresentation: InteropRuntimeRepresentation;
	readonly typeCertainty: 'declared' | 'inferred' | 'unknown' | 'any';
	readonly callResolution?: 'resolved' | 'ambiguous' | 'contextual' | 'unknown';
	readonly receiver?: 'none' | 'preserved' | 'required' | 'unknown';
	readonly structuralData?: 'none' | 'snapshot-proven' | 'snapshot-unknown';
	readonly runtimeBinding?: 'verified' | 'unverified' | 'not-applicable';
	readonly dynamic?: boolean;
}

export interface InteropCallbackFacts {
	readonly cardinality: 'one' | 'many' | 'scoped' | 'unknown';
	readonly lifetime: 'call' | 'operation' | 'scope' | 'session' | 'unknown';
	readonly escapes: 'no' | 'yes' | 'unknown';
	readonly setupRollback: 'guaranteed' | 'adapter-managed' | 'unknown';
}

export interface InteropResourceFacts {
	readonly cleanupProtocol: 'known' | 'none' | 'unknown';
	readonly ownershipAuthority: 'owned' | 'borrowed' | 'shared' | 'unknown';
	readonly shutdownPolicy: 'drain' | 'cancel' | 'immediate' | 'reject-busy' | 'unknown';
	readonly cleanupErrorPolicy: 'protocol' | 'primary-wins' | 'aggregate' | 'cleanup-wins' | 'unknown';
}

export interface InteropDuplexFacts {
	readonly directionalTermination: 'known' | 'unknown';
	readonly upstreamFlowControl: 'native' | 'adapter-bounded' | 'unavailable' | 'unknown';
}

export interface InteropProfile {
	readonly direction: 'outbound' | 'inbound' | 'bidirectional';
	readonly cardinality: 'one' | 'finite-many' | 'unbounded' | 'unknown';
	readonly lifetime: 'call' | 'operation' | 'scope' | 'session' | 'resource' | 'process' | 'unknown';
	readonly ownership: 'value' | 'owned' | 'borrowed' | 'shared' | 'unknown';
	readonly delivery: 'sync' | 'promise' | 'callback' | 'event' | 'iterator' | 'stream' | 'unknown';
	readonly concurrency: 'exclusive' | 'concurrent' | 'reentrant' | 'unknown';
	readonly flowControl: 'none' | 'cancellation' | 'backpressure' | 'cancellation-backpressure' | 'unknown';
	readonly realm: 'same' | 'worker' | 'process' | 'remote' | 'unknown';
	readonly execution: 'normal' | 'blocking' | 'unknown';
	readonly environment: InteropTargetProfile;
}

export type InteropTransfer = 'primitive' | 'codec' | 'foreign-identity' | 'managed-handle' | 'unknown';

export interface InteropFacts {
	readonly shape: InteropFacetIR;
	readonly profile: InteropProfile;
	readonly inputTransfer: InteropTransfer;
	readonly outputTransfer: InteropTransfer;
	readonly callback?: InteropCallbackFacts;
	readonly resource?: InteropResourceFacts;
	readonly duplex?: InteropDuplexFacts;
	readonly lifecycleAuthority?: 'caller' | 'host' | 'unknown';
	readonly nativeCallableOutbound?: boolean;
	readonly evidenceConflict?: boolean;
	readonly evidence?: readonly InteropEvidence[];
}

export type InteropSafetyGate = 'AUTO_SAFE' | 'ADAPTER_REQUIRED' | 'SEMANTICS_REQUIRED' | 'UNRESOLVED';

export type InteropControl =
	| 'direct-access'
	| 'direct-call'
	| 'operation'
	| 'pull-source'
	| 'push-session'
	| 'stream-source'
	| 'stream-sink'
	| 'duplex-session'
	| 'scoped-workflow'
	| 'host-wiring'
	| 'unknown';

export type InteropHandleStrategy = 'none' | 'foreign-identity' | 'managed-handle' | 'managed-resource';

export type InteropReasonCode =
	| 'EVIDENCE_CONFLICT'
	| 'TYPESCRIPT_ANY'
	| 'UNTYPED_EXPORT'
	| 'DYNAMIC_EXPORT'
	| 'RUNTIME_BINDING_UNVERIFIED'
	| 'CALL_RESOLUTION_UNKNOWN'
	| 'CONSTRUCTOR_REQUIRES_ADAPTER'
	| 'NATIVE_CALLABLE_OUTBOUND'
	| 'SYMBOL_REQUIRES_ADAPTER'
	| 'OVERLOAD_AMBIGUOUS'
	| 'GENERIC_REQUIRES_CONTEXT'
	| 'RECEIVER_REQUIRES_ADAPTER'
	| 'AMBIGUOUS_RECEIVER'
	| 'CALLBACK_REQUIRES_ADAPTER'
	| 'AMBIGUOUS_CALLBACK'
	| 'AMBIGUOUS_LIFETIME'
	| 'AMBIGUOUS_DELIVERY'
	| 'AMBIGUOUS_CARDINALITY'
	| 'AMBIGUOUS_CONCURRENCY'
	| 'AMBIGUOUS_SETUP_ROLLBACK'
	| 'FRAMEWORK_OWNS_LIFECYCLE'
	| 'SCOPED_CAPABILITY'
	| 'ASYNC_ITERATOR_REQUIRES_PULL_SOURCE'
	| 'ITERATOR_REQUIRES_PULL_SOURCE'
	| 'STREAM_REQUIRES_SESSION'
	| 'DUPLEX_REQUIRES_SESSION'
	| 'AMBIGUOUS_DUPLEX_TERMINATION'
	| 'AMBIGUOUS_FLOW_CONTROL'
	| 'BLOCKING_EXECUTION_REQUIRES_ADAPTER'
	| 'REENTRANCY_REQUIRES_ADAPTER'
	| 'AMBIGUOUS_OWNERSHIP'
	| 'AMBIGUOUS_CLEANUP_PROTOCOL'
	| 'AMBIGUOUS_SHUTDOWN_POLICY'
	| 'AMBIGUOUS_CLEANUP_ERROR_POLICY'
	| 'RESOURCE_REQUIRES_MANAGED_HANDLE'
	| 'STRUCTURAL_OBJECT_REQUIRES_SNAPSHOT_EVIDENCE'
	| 'REALM_BOUNDARY'
	| 'FOREIGN_IDENTITY_CROSSES_REALM'
	| 'MANAGED_HANDLE_CROSSES_REALM'
	| 'UNKNOWN_CONTROL'
	| 'UNKNOWN_TRANSFER';

export interface InteropPlan {
	/** Control-flow mechanisms are compositional; realm/resource concerns never overwrite them. */
	readonly controls: readonly InteropControl[];
	readonly handle: InteropHandleStrategy;
	readonly inputTransfer: InteropTransfer;
	readonly outputTransfer: InteropTransfer;
	readonly lifetime: InteropProfile['lifetime'];
	readonly ownership: InteropProfile['ownership'];
	readonly flowControl: InteropProfile['flowControl'];
	readonly realm: InteropProfile['realm'];
	readonly environment: InteropTargetProfile;
}

export interface InteropDecision {
	readonly gate: InteropSafetyGate;
	readonly plan: InteropPlan;
	readonly reasons: readonly InteropReasonCode[];
	readonly evidence: readonly InteropEvidence[];
}

const CONTROL_ORDER: readonly InteropControl[] = [
	'direct-access',
	'direct-call',
	'operation',
	'pull-source',
	'push-session',
	'stream-source',
	'stream-sink',
	'duplex-session',
	'scoped-workflow',
	'host-wiring',
	'unknown',
];

export function classifyInterop(facts: InteropFacts): InteropDecision {
	const reasons: InteropReasonCode[] = [];
	let gate: InteropSafetyGate = 'AUTO_SAFE';
	const controls = new Set<InteropControl>(baseControls(facts));
	let handle = baseHandle(facts);
	const facets = new Set(facts.shape.facets);

	const requireGate = (next: InteropSafetyGate): void => {
		if (gateRank(next) > gateRank(gate)) gate = next;
	};
	const reason = (code: InteropReasonCode, next: InteropSafetyGate): void => {
		if (!reasons.includes(code)) reasons.push(code);
		requireGate(next);
	};
	const addControl = (control: InteropControl): void => {
		controls.delete('unknown');
		controls.add(control);
	};

	if (facts.evidenceConflict === true) reason('EVIDENCE_CONFLICT', 'UNRESOLVED');
	if (facts.shape.typeCertainty === 'any') reason('TYPESCRIPT_ANY', 'UNRESOLVED');
	if (facts.shape.typeCertainty === 'unknown') reason('UNTYPED_EXPORT', 'UNRESOLVED');
	if (facts.shape.dynamic === true || facts.shape.runtimeRepresentation === 'unknown') reason('DYNAMIC_EXPORT', 'UNRESOLVED');
	if (facts.shape.runtimeBinding === 'unverified') reason('RUNTIME_BINDING_UNVERIFIED', 'SEMANTICS_REQUIRED');
	if (facts.shape.runtimeBinding === undefined && hasRuntimeFacet(facets)) reason('RUNTIME_BINDING_UNVERIFIED', 'SEMANTICS_REQUIRED');
	if (facts.shape.runtimeRepresentation === 'symbol') reason('SYMBOL_REQUIRES_ADAPTER', 'ADAPTER_REQUIRED');

	if (facts.profile.lifetime === 'unknown') reason('AMBIGUOUS_LIFETIME', 'SEMANTICS_REQUIRED');
	if (facts.profile.delivery === 'unknown') reason('AMBIGUOUS_DELIVERY', 'SEMANTICS_REQUIRED');
	if (requiresKnownCardinality(facts) && facts.profile.cardinality === 'unknown') reason('AMBIGUOUS_CARDINALITY', 'SEMANTICS_REQUIRED');
	if (requiresKnownConcurrency(facts) && facts.profile.concurrency === 'unknown') reason('AMBIGUOUS_CONCURRENCY', 'SEMANTICS_REQUIRED');
	if (requiresKnownFlowControl(facts) && facts.profile.flowControl === 'unknown') reason('AMBIGUOUS_FLOW_CONTROL', 'SEMANTICS_REQUIRED');
	if (facts.profile.execution === 'blocking') reason('BLOCKING_EXECUTION_REQUIRES_ADAPTER', 'ADAPTER_REQUIRED');
	if (facts.profile.concurrency === 'reentrant') reason('REENTRANCY_REQUIRES_ADAPTER', 'ADAPTER_REQUIRED');

	if (facts.nativeCallableOutbound === true) reason('NATIVE_CALLABLE_OUTBOUND', 'ADAPTER_REQUIRED');

	if (facets.has('construct')) reason('CONSTRUCTOR_REQUIRES_ADAPTER', 'ADAPTER_REQUIRED');
	if ((facets.has('call') || facets.has('construct')) && (facts.shape.callResolution === undefined || facts.shape.callResolution === 'unknown')) reason('CALL_RESOLUTION_UNKNOWN', 'SEMANTICS_REQUIRED');
	if (facts.shape.callResolution === 'ambiguous') reason('OVERLOAD_AMBIGUOUS', 'ADAPTER_REQUIRED');
	if (facts.shape.callResolution === 'contextual') reason('GENERIC_REQUIRES_CONTEXT', 'ADAPTER_REQUIRED');
	if (facets.has('call') && facts.shape.receiver === undefined) reason('AMBIGUOUS_RECEIVER', 'SEMANTICS_REQUIRED');
	if (facts.shape.receiver === 'required') reason('RECEIVER_REQUIRES_ADAPTER', 'ADAPTER_REQUIRED');
	if (facts.shape.receiver === 'unknown') reason('AMBIGUOUS_RECEIVER', 'SEMANTICS_REQUIRED');

	if (facts.lifecycleAuthority === 'host') {
		reason('FRAMEWORK_OWNS_LIFECYCLE', 'ADAPTER_REQUIRED');
		controls.delete('direct-call');
		controls.delete('direct-access');
		addControl('host-wiring');
	} else if ((facts.lifecycleAuthority === undefined || facts.lifecycleAuthority === 'unknown') && requiresLifecycleAuthority(facts.profile.lifetime)) {
		reason('AMBIGUOUS_LIFETIME', 'SEMANTICS_REQUIRED');
	}

	if (facts.profile.delivery === 'event') {
		reason('CALLBACK_REQUIRES_ADAPTER', 'ADAPTER_REQUIRED');
		controls.delete('direct-call');
		addControl('push-session');
		if (facts.callback === undefined) reason('AMBIGUOUS_CALLBACK', 'SEMANTICS_REQUIRED');
	}
	if (facts.profile.delivery === 'iterator') reason('ITERATOR_REQUIRES_PULL_SOURCE', 'ADAPTER_REQUIRED');
	if (facts.profile.delivery === 'stream') reason('STREAM_REQUIRES_SESSION', 'ADAPTER_REQUIRED');
	if (facts.profile.lifetime === 'scope') reason('SCOPED_CAPABILITY', 'ADAPTER_REQUIRED');

	if (facts.callback !== undefined) {
		controls.delete('direct-call');
		if (facts.callback.cardinality === 'unknown') reason('AMBIGUOUS_CALLBACK', 'SEMANTICS_REQUIRED');
		if (facts.callback.lifetime === 'unknown') reason('AMBIGUOUS_LIFETIME', 'SEMANTICS_REQUIRED');
		if (facts.callback.setupRollback === 'unknown' && facts.callback.escapes !== 'no') {
			reason('AMBIGUOUS_SETUP_ROLLBACK', 'SEMANTICS_REQUIRED');
		}
		if (facts.callback.cardinality !== 'unknown' && facts.callback.lifetime !== 'unknown') {
			reason('CALLBACK_REQUIRES_ADAPTER', 'ADAPTER_REQUIRED');
			if (facts.callback.cardinality === 'one') addControl('operation');
			if (facts.callback.cardinality === 'many') addControl('push-session');
			if (facts.callback.cardinality === 'scoped') {
				addControl('scoped-workflow');
				if (!reasons.includes('SCOPED_CAPABILITY')) reasons.push('SCOPED_CAPABILITY');
			}
		}
		if (controls.size === 0) controls.add('unknown');
	}

	if (facets.has('duplex')) {
		reason('DUPLEX_REQUIRES_SESSION', 'ADAPTER_REQUIRED');
		addControl('duplex-session');
		if (facts.duplex === undefined || facts.duplex.directionalTermination === 'unknown') {
			reason('AMBIGUOUS_DUPLEX_TERMINATION', 'SEMANTICS_REQUIRED');
		}
		if (facts.duplex === undefined || facts.duplex.upstreamFlowControl === 'unknown') {
			reason('AMBIGUOUS_FLOW_CONTROL', 'SEMANTICS_REQUIRED');
		}
	}
	if (facets.has('stream-source')) {
		reason('STREAM_REQUIRES_SESSION', 'ADAPTER_REQUIRED');
		addControl('stream-source');
	}
	if (facets.has('stream-sink')) {
		reason('STREAM_REQUIRES_SESSION', 'ADAPTER_REQUIRED');
		addControl('stream-sink');
	}
	if (facets.has('async-iterator')) {
		reason('ASYNC_ITERATOR_REQUIRES_PULL_SOURCE', 'ADAPTER_REQUIRED');
		addControl('pull-source');
	} else if (facets.has('iterator')) {
		reason('ITERATOR_REQUIRES_PULL_SOURCE', 'ADAPTER_REQUIRED');
		addControl('pull-source');
	}

	if (facts.resource !== undefined || facts.profile.lifetime === 'resource') {
		const resource = facts.resource;
		if (resource === undefined || resource.ownershipAuthority === 'unknown') reason('AMBIGUOUS_OWNERSHIP', 'SEMANTICS_REQUIRED');
		if (resource === undefined || resource.cleanupProtocol === 'unknown') reason('AMBIGUOUS_CLEANUP_PROTOCOL', 'SEMANTICS_REQUIRED');
		if (resource === undefined || resource.shutdownPolicy === 'unknown') reason('AMBIGUOUS_SHUTDOWN_POLICY', 'SEMANTICS_REQUIRED');
		if (resource === undefined || resource.cleanupErrorPolicy === 'unknown') reason('AMBIGUOUS_CLEANUP_ERROR_POLICY', 'SEMANTICS_REQUIRED');
		if (
			resource !== undefined
			&& resource.ownershipAuthority !== 'unknown'
			&& resource.cleanupProtocol !== 'unknown'
			&& resource.shutdownPolicy !== 'unknown'
			&& resource.cleanupErrorPolicy !== 'unknown'
		) {
			reason('RESOURCE_REQUIRES_MANAGED_HANDLE', 'ADAPTER_REQUIRED');
			handle = 'managed-resource';
		}
	}

	if (facts.shape.structuralData === 'snapshot-unknown') {
		reason('STRUCTURAL_OBJECT_REQUIRES_SNAPSHOT_EVIDENCE', 'SEMANTICS_REQUIRED');
	}

	if (facts.profile.realm !== 'same') {
		reason('REALM_BOUNDARY', facts.profile.realm === 'unknown' ? 'SEMANTICS_REQUIRED' : 'ADAPTER_REQUIRED');
		if (facts.inputTransfer === 'foreign-identity' || facts.outputTransfer === 'foreign-identity') reason('FOREIGN_IDENTITY_CROSSES_REALM', 'SEMANTICS_REQUIRED');
		if (facts.inputTransfer === 'managed-handle' || facts.outputTransfer === 'managed-handle') reason('MANAGED_HANDLE_CROSSES_REALM', 'SEMANTICS_REQUIRED');
	}

	if (facts.inputTransfer === 'unknown' || facts.outputTransfer === 'unknown') reason('UNKNOWN_TRANSFER', 'SEMANTICS_REQUIRED');
	if (controls.size === 0 || (controls.size === 1 && controls.has('unknown'))) reason('UNKNOWN_CONTROL', 'SEMANTICS_REQUIRED');

	return {
		gate,
		plan: {
			controls: [...controls].sort((left, right) => CONTROL_ORDER.indexOf(left) - CONTROL_ORDER.indexOf(right)),
			handle,
			inputTransfer: facts.inputTransfer,
			outputTransfer: facts.outputTransfer,
			lifetime: facts.profile.lifetime,
			ownership: facts.profile.ownership,
			flowControl: facts.profile.flowControl,
			realm: facts.profile.realm,
			environment: facts.profile.environment,
		},
		reasons,
		evidence: facts.evidence ?? [],
	};
}

function baseControls(facts: InteropFacts): readonly InteropControl[] {
	if (facts.profile.delivery === 'promise' || facts.profile.lifetime === 'operation') return ['operation'];
	if (facts.profile.delivery === 'iterator') return ['pull-source'];
	if (facts.profile.delivery === 'event') return ['push-session'];
	if (facts.profile.delivery === 'stream') return ['stream-source'];
	if (facts.profile.lifetime === 'scope') return ['scoped-workflow'];
	if (facts.shape.facets.includes('call') || facts.shape.facets.includes('construct')) return ['direct-call'];
	if (facts.shape.facets.some(facet => facet === 'value' || facet === 'property' || facet === 'index')) return ['direct-access'];
	return ['unknown'];
}

function baseHandle(facts: InteropFacts): InteropHandleStrategy {
	if (facts.inputTransfer === 'managed-handle' || facts.outputTransfer === 'managed-handle') return 'managed-handle';
	if (facts.inputTransfer === 'foreign-identity' || facts.outputTransfer === 'foreign-identity') return 'foreign-identity';
	return 'none';
}

function hasRuntimeFacet(facets: ReadonlySet<InteropFacetKind>): boolean {
	for (const facet of facets) {
		if (facet === 'value' || facet === 'call' || facet === 'construct' || facet === 'property' || facet === 'index') return true;
	}
	return false;
}

function requiresKnownCardinality(facts: InteropFacts): boolean {
	return facts.profile.delivery === 'callback'
		|| facts.profile.delivery === 'event'
		|| facts.profile.delivery === 'iterator'
		|| facts.profile.delivery === 'stream'
		|| facts.profile.lifetime === 'session';
}

function requiresKnownConcurrency(facts: InteropFacts): boolean {
	return facts.profile.lifetime === 'resource'
		|| facts.profile.lifetime === 'session'
		|| facts.shape.facets.includes('duplex');
}

function requiresKnownFlowControl(facts: InteropFacts): boolean {
	return facts.profile.cardinality === 'unbounded'
		|| facts.profile.delivery === 'stream'
		|| facts.shape.facets.includes('duplex');
}

function requiresLifecycleAuthority(lifetime: InteropProfile['lifetime']): boolean {
	return lifetime === 'scope' || lifetime === 'session' || lifetime === 'process';
}

function gateRank(gate: InteropSafetyGate): number {
	switch (gate) {
		case 'AUTO_SAFE': return 0;
		case 'ADAPTER_REQUIRED': return 1;
		case 'SEMANTICS_REQUIRED': return 2;
		case 'UNRESOLVED': return 3;
	}
}
