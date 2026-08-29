export * from './compiler.js';
export * from './project/project.js';
export * from './ast/nodes.js';
export * from './diagnostics/codes.js';
export * from './diagnostics/diagnostic.js';
export * from './diagnostics/render.js';
export * from './checker/checker.js';
export * from './types/types.js';
export * from './hir/nodes.js';
export * from './source.js';
export { lex } from './syntax/tokens.js';

export { parseSource } from './project/project.js';
export * from './project/incremental.js';
export {
	buildProject,
	checkModule,
	compileSource,
	IncrementalProjectBuilder,
	TypeChecker,
} from './interop/checked-api.js';
export * from './interop/decision.js';
export { externalOperationSequence } from './interop/operation-api.js';
export type {
	ExternalAwaitOperationIR,
	ExternalBridgeForeignPrimitiveOperationIR,
	ExternalBuildObjectOperationIR,
	ExternalCallableProjectionIR,
	ExternalCallOperationIR,
	ExternalConstructOperationIR,
	ExternalForeignOrigin,
	ExternalForeignValueShape,
	ExternalModuleLoadOperationIR,
	ExternalOperationEffect,
	ExternalOperationIR,
	ExternalOperationKind,
	ExternalReadIndexOperationIR,
	ExternalReadPropertyOperationIR,
	ExternalRuntimeResolutionWitness,
	ExternalSourcePosition,
	ExternalSourceSpan,
	ExternalWriteIndexOperationIR,
	ExternalWritePropertyOperationIR,
} from './interop/operation.js';
export type {
	CallableProjectionEvidence,
	ContextualCallablePrimitiveKind,
	ContextualCallableResult,
	ForeignCallResolution,
	ForeignIndexResolution,
	ForeignObjectResolution,
	ForeignOrigin,
	ForeignPrimitiveKind,
	ForeignTypeRef,
	ForeignTypeSnapshot,
	ForeignUsage,
	ForeignWriteResolution,
	InteropArgumentType,
	InteropCallableArgumentResolution,
	InteropCallTarget,
	InteropCallUsage,
	InteropIndexUsage,
	InteropLiteralValue,
	InteropObjectEntryUsage,
	InteropObjectUsage,
	InteropSemanticModel,
	InteropWriteUsage,
	JsImportKind,
	JsImportRequest,
	JsImportResolution,
	JsInteropProvider,
	ModuleResolutionWitness,
	NativeCallableBoundaryDescriptor,
	NativeCallablePrimitiveKind,
	NativeCallableTypeTemplate,
	PrimitiveBridgeKind,
	RuntimeImportPlan,
} from './interop/types.js';