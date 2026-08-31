import type { NodeId, SourceSpan, TypeId } from '../source.js';

export type ForeignPrimitiveKind = 'boolean' | 'string' | 'number' | 'bigint' | 'void' | 'undefined' | 'null';
export type NativeCallablePrimitiveKind = 'Bool' | 'Int' | 'Float' | 'BigInt' | 'String' | 'Unit';
export type ContextualCallablePrimitiveKind = 'boolean' | 'string' | 'number' | 'bigint' | 'undefined';

/** Opaque reference whose lifetime is limited to one provider generation. */
export interface ForeignTypeRef {
	readonly providerId: string;
	readonly generation: number;
	readonly id: string;
}

/** Ephemeral editor metadata. Providers must not serialize this into stable semantic evidence. */
export interface ForeignTypeNavigation {
	readonly declarationPath: string;
}

export interface ForeignTypeSnapshot {
	readonly ref: ForeignTypeRef;
	readonly display: string;
	readonly category: 'primitive' | 'literal' | 'object' | 'function' | 'constructor' | 'promise' | 'array' | 'tuple' | 'union' | 'unknown' | 'any';
	readonly primitive?: ForeignPrimitiveKind;
	readonly mustUse?: boolean;
	readonly origin?: ForeignOrigin;
	readonly navigation?: ForeignTypeNavigation;
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

export type InteropLiteralValue =
	| { readonly kind: 'String'; readonly value: string }
	| { readonly kind: 'Bool'; readonly value: boolean }
	| { readonly kind: 'Int' | 'Float'; readonly value: number }
	| { readonly kind: 'BigInt'; readonly value: string };

/** Provider-facing native callable template. Compiler-owned effects and provenance are intentionally excluded. */
export interface NativeCallableTypeTemplate {
	readonly parameters: readonly NativeCallablePrimitiveKind[];
	readonly result: NativeCallablePrimitiveKind;
	readonly async: boolean;
}

export interface InteropObjectEntryUsage {
	readonly property: string;
	readonly value: InteropArgumentType;
}

export interface InteropObjectUsage {
	readonly entries: readonly InteropObjectEntryUsage[];
}

export type InteropArgumentType =
	| { readonly kind: 'foreign'; readonly type: ForeignTypeRef }
	| { readonly kind: 'native-primitive'; readonly primitive: NativeCallablePrimitiveKind; readonly literal?: InteropLiteralValue }
	| { readonly kind: 'native-callable'; readonly callable: NativeCallableTypeTemplate }
	| { readonly kind: 'contextual-object'; readonly object: InteropObjectUsage }
	| { readonly kind: 'unknown' };

export type InteropCallTarget =
	| { readonly kind: 'value' }
	| { readonly kind: 'member'; readonly receiver: ForeignTypeRef; readonly property: string }
	| { readonly kind: 'indexed-member'; readonly receiver: ForeignTypeRef; readonly index: InteropArgumentType };

export interface InteropCallUsage {
	readonly target: InteropCallTarget;
	readonly arguments: readonly InteropArgumentType[];
}

export interface InteropIndexUsage {
	readonly index: InteropArgumentType;
}

export type InteropWriteUsage =
	| { readonly kind: 'property'; readonly property: string; readonly value: InteropArgumentType }
	| { readonly kind: 'index'; readonly index: InteropArgumentType; readonly value: InteropArgumentType };

export type ContextualCallableResult =
	| { readonly kind: 'void' }
	| { readonly kind: 'value'; readonly value: ContextualCallablePrimitiveKind }
	| { readonly kind: 'promise'; readonly value: ContextualCallablePrimitiveKind | 'void' };

/** Selected TypeScript callback facts for one native-callable argument or contextual object entry. */
export interface InteropCallableArgumentResolution {
	readonly index: number;
	readonly target: {
		readonly parameters: readonly ContextualCallablePrimitiveKind[];
		readonly result: ContextualCallableResult;
	};
}

export interface ForeignObjectEntryResolution {
	readonly index: number;
	readonly property: string;
	readonly callable?: InteropCallableArgumentResolution['target'];
	readonly object?: ForeignObjectResolution;
}

/** Whole-object contextual proof from one fixed provider snapshot. Entries retain source order. */
export interface ForeignObjectResolution {
	readonly result: ForeignTypeSnapshot;
	readonly entries: readonly ForeignObjectEntryResolution[];
}

export interface InteropObjectArgumentResolution {
	readonly index: number;
	readonly object: ForeignObjectResolution;
}

export interface ForeignCallResolution {
	readonly result: ForeignTypeSnapshot;
	readonly parameterCount: number;
	readonly optionalParameterCount: number;
	readonly minimumArgumentCount?: number;
	readonly rest: boolean;
	readonly mayReject: boolean;
	readonly receiverMode: 'none' | 'preserve-this';
	readonly callableArguments?: readonly InteropCallableArgumentResolution[];
	readonly objectArguments?: readonly InteropObjectArgumentResolution[];
}

export interface ForeignIndexResolution {
	readonly result: ForeignTypeSnapshot;
}

export interface ForeignWriteResolution {
	readonly accepted: true;
	readonly objectValue?: ForeignObjectResolution;
}

export interface JsInteropProvider {
	readonly id: string;
	readonly version: string;
	readonly generation: number;
	resolveImport(request: JsImportRequest): JsImportResolution;
	getProperty(type: ForeignTypeRef, name: string): ForeignTypeSnapshot | undefined;
	/** Whole-usage resolver. When implemented, callers must not fall back to resolveCall after it returns undefined. */
	resolveCallUsage?(type: ForeignTypeRef, usage: InteropCallUsage): ForeignCallResolution | undefined;
	/** Whole-usage construct resolver. A call-like source is constructable only when call usage is not also valid. */
	resolveConstructUsage?(type: ForeignTypeRef, usage: InteropCallUsage): ForeignCallResolution | undefined;
	/** Whole-usage index resolver. Unknown/unsupported receiver or key evidence must return undefined. */
	resolveIndexUsage?(type: ForeignTypeRef, usage: InteropIndexUsage): ForeignIndexResolution | undefined;
	/** Whole-usage writable-facet resolver. Unknown/readonly/inaccessible evidence must return undefined. */
	resolveWriteUsage?(type: ForeignTypeRef, usage: InteropWriteUsage): ForeignWriteResolution | undefined;
	/** Contextual object resolver for an already-known External expected type. */
	resolveObjectUsage?(type: ForeignTypeRef, usage: InteropObjectUsage): ForeignObjectResolution | undefined;
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

/** Stable compiler-owned description of one generated native-to-JavaScript callable boundary. */
export interface NativeCallableBoundaryDescriptor {
	readonly version: 'virune-callable-shim/v1';
	readonly parameters: readonly NativeCallablePrimitiveKind[];
	readonly result: NativeCallablePrimitiveKind;
	readonly async: boolean;
	readonly effects: readonly string[];
	readonly contextMode: 'root-argument';
}

/** Ordering evidence for a callable projection performed while evaluating a JavaScript call argument. */
export interface CallableProjectionEvidence {
	readonly callNodeId: NodeId;
	readonly argumentIndex: number;
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
	readonly beforeUsageIndex: number;
	readonly descriptor: NativeCallableBoundaryDescriptor;
}

/** Ordering evidence for a callable projection performed while evaluating a contextual External object entry. */
export interface ObjectCallableProjectionEvidence {
	readonly objectNodeId: NodeId;
	readonly entryIndex: number;
	readonly property: string;
	readonly beforeUsageIndex: number;
	readonly descriptor: NativeCallableBoundaryDescriptor;
}

export interface ForeignUsage {
	readonly kind: 'import' | 'property' | 'index' | 'write-property' | 'write-index' | 'object' | 'call' | 'construct' | 'await' | 'bridge';
	readonly nodeId: NodeId;
	readonly span: SourceSpan;
	readonly foreignType: ForeignTypeSnapshot;
	readonly runtimeImport?: RuntimeImportPlan;
	readonly moduleWitness?: ModuleResolutionWitness;
	readonly receiverMode?: 'none' | 'preserve-this';
	readonly mayReject?: boolean;
	readonly property?: string;
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
	readonly property?: string;
	readonly bridge?: PrimitiveBridgePlan;
}

export interface InteropSemanticModel {
	readonly usages: readonly ForeignUsage[];
	/** Serializable provider-independent records consumed by downstream tools. */
	readonly usageIR: readonly ForeignUsageIR[];
	readonly callableProjections?: readonly CallableProjectionEvidence[];
	readonly objectCallableProjections?: readonly ObjectCallableProjectionEvidence[];
	readonly moduleWitnesses: readonly ModuleResolutionWitness[];
	readonly requiresJavaScriptInitialization: boolean;
}
