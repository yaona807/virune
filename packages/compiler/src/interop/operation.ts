import type { NodeId, SourceSpan } from '../source.js';
import type {
	ForeignOrigin,
	ForeignUsageIR,
	ModuleResolutionWitness,
	PrimitiveBridgeKind,
	StableForeignTypeSnapshot,
} from './types.js';
import {
	canonicalizeInteropDecision,
	type InteropDecisionIR,
	type InteropSafetyClaim,
} from './decision.js';

export type ExternalOperationKind =
	| 'module-load'
	| 'read-property'
	| 'call'
	| 'await'
	| 'bridge-foreign-primitive';

interface ExternalOperationBase {
	readonly kind: ExternalOperationKind;
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
	readonly decision: InteropDecisionIR;
}

export interface ExternalModuleLoadOperationIR extends ExternalOperationBase {
	readonly kind: 'module-load';
	readonly moduleSpecifier: string;
	readonly witness: ModuleResolutionWitness;
}

export interface ExternalReadPropertyOperationIR extends ExternalOperationBase {
	readonly kind: 'read-property';
	readonly result: StableForeignTypeSnapshot;
}

export interface ExternalCallOperationIR extends ExternalOperationBase {
	readonly kind: 'call';
	readonly result: StableForeignTypeSnapshot;
	readonly receiverMode: 'none' | 'preserve-this';
	readonly mayReject: boolean;
}

export interface ExternalAwaitOperationIR extends ExternalOperationBase {
	readonly kind: 'await';
	readonly result: StableForeignTypeSnapshot;
	readonly mayReject: boolean;
}

export interface ExternalBridgeForeignPrimitiveOperationIR extends ExternalOperationBase {
	readonly kind: 'bridge-foreign-primitive';
	readonly source: StableForeignTypeSnapshot;
	readonly bridge: PrimitiveBridgeKind;
}

export type ExternalOperationIR =
	| ExternalModuleLoadOperationIR
	| ExternalReadPropertyOperationIR
	| ExternalCallOperationIR
	| ExternalAwaitOperationIR
	| ExternalBridgeForeignPrimitiveOperationIR;

/**
 * Convert one already-accepted non-import Foreign usage to provider-independent
 * operation evidence. Import usages intentionally return undefined: runtime
 * ModuleLoad semantics belong to the import declaration, because a type-only
 * import has no runtime load while a side-effect import has no bound value.
 */
export function externalOperationFromUsage(usage: ForeignUsageIR): ExternalOperationIR | undefined {
	const anchor = { nodeId: usage.nodeId, span: usage.span };
	switch (usage.kind) {
		case 'import': return undefined;
		case 'property':
			return {
				kind: 'read-property',
				...anchor,
				result: canonicalForeignType(usage.foreignType),
				decision: directDecision(),
			};
		case 'call': {
			const receiverMode = usage.receiverMode;
			if (receiverMode !== 'none' && receiverMode !== 'preserve-this') throw new Error('External Call operation requires a known receiver mode');
			if (typeof usage.mayReject !== 'boolean') throw new Error('External Call operation requires explicit rejection semantics');
			return {
				kind: 'call',
				...anchor,
				result: canonicalForeignType(usage.foreignType),
				receiverMode,
				mayReject: usage.mayReject,
				decision: directDecision(receiverMode === 'preserve-this' ? ['receiver-preserved'] : []),
			};
		}
		case 'await':
			if (typeof usage.mayReject !== 'boolean') throw new Error('External Await operation requires explicit rejection semantics');
			return {
				kind: 'await',
				...anchor,
				result: canonicalForeignType(usage.foreignType),
				mayReject: usage.mayReject,
				decision: directDecision(),
			};
		case 'bridge':
			if (usage.bridge?.kind !== 'primitive') throw new Error('External primitive bridge operation requires an explicit primitive bridge plan');
			return {
				kind: 'bridge-foreign-primitive',
				...anchor,
				source: canonicalForeignType(usage.foreignType),
				bridge: usage.bridge.bridge,
				decision: directDecision(['primitive-bridge-validated']),
			};
	}
}

/** Runtime ModuleLoad is built explicitly from declaration-level semantics. */
export function externalModuleLoadOperation(input: {
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
	readonly moduleSpecifier: string;
	readonly witness: ModuleResolutionWitness;
}): ExternalModuleLoadOperationIR {
	if (input.moduleSpecifier.length === 0) throw new Error('External ModuleLoad requires a module specifier');
	return {
		kind: 'module-load',
		nodeId: input.nodeId,
		span: input.span,
		moduleSpecifier: input.moduleSpecifier,
		witness: canonicalModuleWitness(input.witness),
		decision: directDecision(),
	};
}

function directDecision(claims: readonly InteropSafetyClaim[] = []): InteropDecisionIR {
	return canonicalizeInteropDecision({
		status: 'resolved',
		mechanism: 'direct',
		authoring: 'none',
		claims,
		obligations: [],
	});
}

function canonicalForeignType(snapshot: StableForeignTypeSnapshot): StableForeignTypeSnapshot {
	return {
		display: snapshot.display,
		category: snapshot.category,
		...(snapshot.primitive === undefined ? {} : { primitive: snapshot.primitive }),
		...(snapshot.mustUse === undefined ? {} : { mustUse: snapshot.mustUse }),
		...(snapshot.origin === undefined ? {} : { origin: canonicalOrigin(snapshot.origin) }),
	};
}

function canonicalOrigin(origin: ForeignOrigin): ForeignOrigin {
	return {
		moduleSpecifier: origin.moduleSpecifier,
		...(origin.packageName === undefined ? {} : { packageName: origin.packageName }),
		...(origin.packageVersion === undefined ? {} : { packageVersion: origin.packageVersion }),
		...(origin.declarationPath === undefined ? {} : { declarationPath: origin.declarationPath }),
		...(origin.exportName === undefined ? {} : { exportName: origin.exportName }),
	};
}

function canonicalModuleWitness(witness: ModuleResolutionWitness): ModuleResolutionWitness {
	return {
		moduleSpecifier: witness.moduleSpecifier,
		...(witness.packageName === undefined ? {} : { packageName: witness.packageName }),
		...(witness.packageVersion === undefined ? {} : { packageVersion: witness.packageVersion }),
		...(witness.declarationPackageName === undefined ? {} : { declarationPackageName: witness.declarationPackageName }),
		...(witness.declarationPackageVersion === undefined ? {} : { declarationPackageVersion: witness.declarationPackageVersion }),
		...(witness.declarationEntry === undefined ? {} : { declarationEntry: witness.declarationEntry }),
		...(witness.runtimeEntry === undefined ? {} : { runtimeEntry: witness.runtimeEntry }),
		...(witness.runtimeFormat === undefined ? {} : { runtimeFormat: witness.runtimeFormat }),
		conditions: [...witness.conditions],
		platform: witness.platform,
		providerVersion: witness.providerVersion,
		...(witness.declarationGraphHash === undefined ? {} : { declarationGraphHash: witness.declarationGraphHash }),
		...(witness.packageJsonHash === undefined ? {} : { packageJsonHash: witness.packageJsonHash }),
		...(witness.declarationPackageJsonHash === undefined ? {} : { declarationPackageJsonHash: witness.declarationPackageJsonHash }),
	};
}
