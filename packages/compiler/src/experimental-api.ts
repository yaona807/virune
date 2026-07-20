export * from './compiler.js';
export * from './project/project.js';
export * from './ast/nodes.js';
export * from './diagnostics/diagnostic.js';
export * from './diagnostics/render.js';
export * from './checker/checker.js';
export * from './types/types.js';
export * from './hir/nodes.js';
export * from './source.js';
export { lex } from './syntax/tokens.js';

export { parseSource } from './project/project.js';
export * from './project/incremental.js';
export type {
	ForeignCallResolution,
	ForeignOrigin,
	ForeignPrimitiveKind,
	ForeignTypeRef,
	ForeignTypeSnapshot,
	ForeignUsage,
	InteropArgumentType,
	InteropSemanticModel,
	JsImportKind,
	JsImportRequest,
	JsImportResolution,
	JsInteropProvider,
	ModuleResolutionWitness,
	PrimitiveBridgeKind,
	RuntimeImportPlan,
} from './interop/types.js';
