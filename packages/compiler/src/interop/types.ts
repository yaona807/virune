import type { NodeId, SourceSpan, TypeId } from '../source.js';

export type ForeignPrimitiveKind = 'boolean' | 'string' | 'number' | 'bigint' | 'void' | 'undefined' | 'null';

/** Opaque reference whose lifetime is limited to one provider generation. */
export interface ForeignTypeRef {
	readonly providerId: string;
	readonly generation: number;
	readonly id: string;
}

export interface ForeignTypeSnapshot {
	readonly ref: ForeignTypeRef;
	readonly display: string;
	readonly category: 'primitive' | 'literal' | 'object' | 'function' | 'constructor' | 'promise' | 'array' | 'tuple' | 'union' | 'unknown' | 'any';
	readonly primitive?: ForeignPrimitiveKind;
	readonly mustUse?: boolean;
	readonly origin?: ForeignOrigin;
}

export interface ForeignOrigin {
	readonly moduleSpecifier: string;
	readonly packageName?: string;
	readonly packageVersion?: string;
	readonly declarationPath?: string;
	readonly exportName?: string;
}

export type JsImportKind = 'named' | 'default' | 'namespace' | 'side-effect' | 'type-only';

export interface JsImportRequest {
	readonly containingFile: string;
	readonly moduleSpecifier: string;
	readonly kind: JsImportKind;
	readonly importedName?: string;
	readonly platform: 'node' | 'browser' | 'neutral';
}

export interface JsImportResolution {
	readonly type?: ForeignTypeSnapshot;
	readonly runtime: RuntimeImportPlan;
	readonly witness: ModuleResolutionWitness;
}

export type RuntimeImportPlan =
	| { readonly kind: 'named'; readonly importedName: string }
	| { readonly kind: 'default' }
	| { readonly kind: 'namespace' }
	| { readonly kind: 'side-effect' }
	| { readonly kind: 'type-only' };

export interface ModuleResolutionWitness {
	readonly moduleSpecifier: string;
	/** Runtime package selected by the target loader. */
	readonly packageName?: string;
	readonly packageVersion?: string;
	/** Declaration package when types are supplied separately, for example @types/lodash. */
	readonly declarationPackageName?: string;
	readonly declarationPackageVersion?: string;
	readonly declarationEntry?: string;
	readonly runtimeEntry?: string;
	readonly runtimeFormat?: 'esm' | 'commonjs' | 'builtin' | 'bundler' | 'unknown';
	readonly conditions: readonly string[];
	readonly platform: 'node' | 'browser' | 'neutral';
	readonly providerVersion: string;
	readonly declarationGraphHash?: string;
	readonly packageJsonHash?: string;
	readonly declarationPackageJsonHash?: string;
}

export type InteropArgumentType =
	| { readonly kind: 'foreign'; readonly type: ForeignTypeRef }
	| { readonly kind: 'native-primitive'; readonly primitive: 'Bool' | 'Int' | 'Float' | 'BigInt' | 'String' | 'Unit' }
	| { readonly kind: 'unknown' };

export interface ForeignCallResolution {
	readonly result: ForeignTypeSnapshot;
	readonly parameterCount: number;
	readonly optionalParameterCount: number;
	readonly rest: boolean;
	readonly mayReject: boolean;
	readonly receiverMode: 'none' | 'preserve-this';
}

export interface JsInteropProvider {
	readonly id: string;
	readonly version: string;
	readonly generation: number;
	resolveImport(request: JsImportRequest): JsImportResolution;
	getProperty(type: ForeignTypeRef, name: string): ForeignTypeSnapshot | undefined;
	resolveCall(type: ForeignTypeRef, argumentsList: readonly InteropArgumentType[]): ForeignCallResolution | undefined;
	resolveConstruct(type: ForeignTypeRef, argumentsList: readonly InteropArgumentType[]): ForeignCallResolution | undefined;
	getAwaitedType(type: ForeignTypeRef): ForeignTypeSnapshot | undefined;
	display(type: ForeignTypeRef): string;
}

export type PrimitiveBridgeKind = 'string' | 'bool' | 'float' | 'bigint' | 'unit' | 'unknown';

export interface PrimitiveBridgePlan {
	readonly kind: 'primitive';
	readonly bridge: PrimitiveBridgeKind;
	readonly targetType: TypeId;
}

export interface ForeignUsage {
	readonly kind: 'import' | 'property' | 'call' | 'await' | 'bridge';
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
	readonly foreignType: ForeignTypeSnapshot;
	readonly runtimeImport?: RuntimeImportPlan;
	readonly moduleWitness?: ModuleResolutionWitness;
	readonly receiverMode?: 'none' | 'preserve-this';
	readonly mayReject?: boolean;
	readonly bridge?: PrimitiveBridgePlan;
}

export interface StableForeignTypeSnapshot {
	readonly display: string;
	readonly category: ForeignTypeSnapshot['category'];
	readonly primitive?: ForeignPrimitiveKind;
	readonly mustUse?: boolean;
	readonly origin?: ForeignOrigin;
}

export interface ForeignUsageIR {
	readonly kind: ForeignUsage['kind'];
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
	readonly foreignType: StableForeignTypeSnapshot;
	readonly runtimeImport?: RuntimeImportPlan;
	readonly moduleWitness?: ModuleResolutionWitness;
	readonly receiverMode?: 'none' | 'preserve-this';
	readonly mayReject?: boolean;
	readonly bridge?: PrimitiveBridgePlan;
}

export interface InteropSemanticModel {
	readonly usages: readonly ForeignUsage[];
	/** Serializable provider-independent records consumed by downstream tools. */
	readonly usageIR: readonly ForeignUsageIR[];
	readonly moduleWitnesses: readonly ModuleResolutionWitness[];
	readonly requiresJavaScriptInitialization: boolean;
}
