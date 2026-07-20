import type { NodeId, SourceSpan, TypeId } from '../source.js';

export type MirBlockId = number;

export interface MirInstruction {
	readonly nodeId: NodeId;
	readonly kind: 'let' | 'assign' | 'evaluate' | 'defer';
	readonly span: SourceSpan;
	readonly typeId?: TypeId;
}

export type MirTerminator =
	| { readonly kind: 'goto'; readonly target: MirBlockId }
	| { readonly kind: 'branch'; readonly conditionNodeId: NodeId; readonly thenTarget: MirBlockId; readonly elseTarget: MirBlockId }
	| { readonly kind: 'return'; readonly valueNodeId?: NodeId }
	| { readonly kind: 'end' }
	| { readonly kind: 'unreachable' };

export interface MirBasicBlock {
	readonly id: MirBlockId;
	readonly instructions: readonly MirInstruction[];
	readonly terminator: MirTerminator;
}

export interface MirFunction {
	readonly declarationNodeId: NodeId;
	readonly name: string;
	readonly entry: MirBlockId;
	readonly blocks: readonly MirBasicBlock[];
}
