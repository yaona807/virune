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
	ExternalCallOperationIR,
	ExternalForeignOrigin,
	ExternalForeignValueShape,
	ExternalModuleLoadOperationIR,
	ExternalOperationEffect,
	ExternalOperationIR,
	ExternalOperationKind,
	ExternalReadPropertyOperationIR,
	ExternalRuntimeResolutionWitness,
	ExternalSourcePosition,
	ExternalSourceSpan,
} from './interop/operation.js';
export type {
	CallableProjectionEvidence,
	ContextualCallablePrimitiveKind,
	ContextualCallableResult,
	ForeignCallResolution,
	ForeignOrigin,
	ForeignPrimitiveKind,
	ForeignTypeRef,
	ForeignTypeSnapshot,
	ForeignUsage,
	InteropArgumentType,
	InteropCallableArgumentResolution,
	InteropCallTarget,
	InteropCallUsage,
	InteropLiteralValue,
	InteropSemanticModel,
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
