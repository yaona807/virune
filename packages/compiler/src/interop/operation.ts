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

const FOREIGN_CATEGORIES = new Set<StableForeignTypeSnapshot['category']>([
	'primitive', 'literal', 'object', 'function', 'constructor', 'promise', 'array', 'tuple', 'union', 'unknown', 'any',
]);
const FOREIGN_PRIMITIVES = new Set<NonNullable<StableForeignTypeSnapshot['primitive']>>([
	'boolean', 'string', 'number', 'bigint', 'void', 'undefined', 'null',
]);
const BRIDGES = new Set<PrimitiveBridgeKind>(['string', 'bool', 'float', 'bigint', 'unit', 'unknown']);
const RUNTIME_FORMATS = new Set<NonNullable<ModuleResolutionWitness['runtimeFormat']>>([
	'esm', 'commonjs', 'builtin', 'bundler', 'unknown',
]);
const PLATFORMS = new Set<ModuleResolutionWitness['platform']>(['node', 'browser', 'neutral']);

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
		case 'bridge': {
			if (usage.bridge?.kind !== 'primitive') throw new Error('External primitive bridge operation requires an explicit primitive bridge plan');
			assertKnown(BRIDGES, usage.bridge.bridge, 'primitive bridge');
			return {
				kind: 'bridge-foreign-primitive',
				...anchor,
				source: canonicalForeignType(usage.foreignType),
				bridge: usage.bridge.bridge,
				decision: directDecision(['primitive-bridge-validated']),
			};
		}
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
	if (input.witness.moduleSpecifier !== input.moduleSpecifier) throw new Error('External ModuleLoad witness must resolve the same module specifier');
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
	if (snapshot.display.length === 0) throw new Error('External operation foreign type requires a display');
	assertKnown(FOREIGN_CATEGORIES, snapshot.category, 'foreign type category');
	if (snapshot.primitive !== undefined) assertKnown(FOREIGN_PRIMITIVES, snapshot.primitive, 'foreign primitive');
	if (snapshot.mustUse !== undefined && typeof snapshot.mustUse !== 'boolean') throw new Error('External operation foreign mustUse must be boolean');
	return {
		display: snapshot.display,
		category: snapshot.category,
		...(snapshot.primitive === undefined ? {} : { primitive: snapshot.primitive }),
		...(snapshot.mustUse === undefined ? {} : { mustUse: snapshot.mustUse }),
		...(snapshot.origin === undefined ? {} : { origin: canonicalOrigin(snapshot.origin) }),
	};
}

function canonicalOrigin(origin: ForeignOrigin): ForeignOrigin {
	if (origin.moduleSpecifier.length === 0) throw new Error('External operation origin requires a module specifier');
	return {
		moduleSpecifier: origin.moduleSpecifier,
		...(origin.packageName === undefined ? {} : { packageName: origin.packageName }),
		...(origin.packageVersion === undefined ? {} : { packageVersion: origin.packageVersion }),
		...(origin.declarationPath === undefined ? {} : { declarationPath: canonicalRelativeLocator(origin.declarationPath, 'declaration path') }),
		...(origin.exportName === undefined ? {} : { exportName: origin.exportName }),
	};
}

function canonicalModuleWitness(witness: ModuleResolutionWitness): ModuleResolutionWitness {
	if (witness.moduleSpecifier.length === 0) throw new Error('External ModuleLoad witness requires a module specifier');
	if (witness.providerVersion.length === 0) throw new Error('External ModuleLoad witness requires a provider version');
	assertKnown(PLATFORMS, witness.platform, 'module witness platform');
	if (witness.runtimeFormat !== undefined) assertKnown(RUNTIME_FORMATS, witness.runtimeFormat, 'module witness runtime format');
	const conditions = witness.conditions.map(condition => {
		if (typeof condition !== 'string' || condition.length === 0) throw new Error('External ModuleLoad witness conditions must be non-empty strings');
		return condition;
	});
	return {
		moduleSpecifier: witness.moduleSpecifier,
		...(witness.packageName === undefined ? {} : { packageName: witness.packageName }),
		...(witness.packageVersion === undefined ? {} : { packageVersion: witness.packageVersion }),
		...(witness.declarationPackageName === undefined ? {} : { declarationPackageName: witness.declarationPackageName }),
		...(witness.declarationPackageVersion === undefined ? {} : { declarationPackageVersion: witness.declarationPackageVersion }),
		...(witness.declarationEntry === undefined ? {} : { declarationEntry: canonicalRelativeLocator(witness.declarationEntry, 'declaration entry') }),
		...(witness.runtimeEntry === undefined ? {} : { runtimeEntry: canonicalRelativeLocator(witness.runtimeEntry, 'runtime entry') }),
		...(witness.runtimeFormat === undefined ? {} : { runtimeFormat: witness.runtimeFormat }),
		conditions,
		platform: witness.platform,
		providerVersion: witness.providerVersion,
		...(witness.declarationGraphHash === undefined ? {} : { declarationGraphHash: witness.declarationGraphHash }),
		...(witness.packageJsonHash === undefined ? {} : { packageJsonHash: witness.packageJsonHash }),
		...(witness.declarationPackageJsonHash === undefined ? {} : { declarationPackageJsonHash: witness.declarationPackageJsonHash }),
	};
}

function canonicalRelativeLocator(value: string, description: string): string {
	if (value.length === 0) throw new Error(`External operation ${description} must not be empty`);
	if (value.includes('\\')) throw new Error(`External operation ${description} must use canonical forward slashes`);
	if (value.startsWith('/') || /^[A-Za-z]:\//u.test(value)) throw new Error(`External operation ${description} must not be absolute`);
	const segments = value.split('/');
	if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) throw new Error(`External operation ${description} must be a canonical relative locator`);
	return value;
}

function assertKnown<T extends string>(known: ReadonlySet<T>, value: T, description: string): void {
	if (!known.has(value)) throw new Error(`Unknown ${description}: ${String(value)}`);
}
