import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { NodeId, SymbolId, TypeId } from '../source.js';
import type { MirFunction } from '../mir/nodes.js';

export interface TypedHirModule {
	readonly module: A.ModuleNode;
	readonly semantic: SemanticModel;
	readonly nodeTypes: ReadonlyMap<NodeId, TypeId>;
	readonly symbolReferences: ReadonlyMap<NodeId, SymbolId>;
	readonly mirFunctions: readonly MirFunction[];
}
