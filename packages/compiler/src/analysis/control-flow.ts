import type * as A from '../ast/nodes.js';
import type { SourceSpan, TypeId } from '../source.js';
import type { TypeArena } from '../types/types.js';

export interface ControlFlowAnalysis {
	readonly alwaysTerminates: boolean;
	readonly unreachable: readonly SourceSpan[];
}

interface StatementAnalysis {
	readonly terminates: boolean;
	readonly unreachable: readonly SourceSpan[];
}

export function analyzeControlFlow(block: A.BlockStatement, arena: TypeArena): ControlFlowAnalysis {
	const result = analyzeBlock(block, arena);
	return { alwaysTerminates: result.terminates, unreachable: result.unreachable };
}

function analyzeBlock(block: A.BlockStatement, arena: TypeArena): StatementAnalysis {
	let terminated = false;
	const unreachable: SourceSpan[] = [];
	for (const statement of block.statements) {
		if (terminated) {
			unreachable.push(statement.span);
			continue;
		}
		const result = analyzeStatement(statement, arena);
		unreachable.push(...result.unreachable);
		terminated = result.terminates;
	}
	return { terminates: terminated, unreachable };
}

function analyzeStatement(statement: A.Statement, arena: TypeArena): StatementAnalysis {
	switch (statement.kind) {
		case 'ReturnStatement': return { terminates: true, unreachable: [] };
		case 'ExpressionStatement': case 'DiscardStatement': return { terminates: isNever(statement.expression.inferredTypeId, arena), unreachable: [] };
		case 'BreakStatement': case 'ContinueStatement': return { terminates: true, unreachable: [] };
		case 'IfStatement': {
			const thenResult = analyzeBlock(statement.thenBlock, arena);
			if (statement.elseBranch === undefined) return { terminates: false, unreachable: thenResult.unreachable };
			const elseResult = statement.elseBranch.kind === 'BlockStatement'
				? analyzeBlock(statement.elseBranch, arena)
				: analyzeStatement(statement.elseBranch, arena);
			return { terminates: thenResult.terminates && elseResult.terminates, unreachable: [...thenResult.unreachable, ...elseResult.unreachable] };
		}
		case 'WhileStatement': {
			const body = analyzeBlock(statement.body, arena);
			const alwaysRuns = statement.condition.kind === 'LiteralExpression' && statement.condition.literalKind === 'Bool' && statement.condition.value === true;
			return { terminates: alwaysRuns && body.terminates, unreachable: body.unreachable };
		}
		case 'ForStatement': return { terminates: false, unreachable: analyzeBlock(statement.body, arena).unreachable };
		default: return { terminates: false, unreachable: [] };
	}
}

function isNever(typeId: TypeId | undefined, arena: TypeArena): boolean {
	return typeId !== undefined && arena.equals(typeId, arena.never);
}
