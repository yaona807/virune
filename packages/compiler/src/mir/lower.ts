import type * as A from '../ast/nodes.js';
import type { MirBasicBlock, MirBlockId, MirFunction, MirInstruction, MirTerminator } from './nodes.js';

interface MutableBlock {
	readonly id: MirBlockId;
	readonly instructions: MirInstruction[];
	terminator?: MirTerminator;
}

class MirBuilder {
	readonly #blocks: MutableBlock[] = [];
	readonly #loops: Array<{ readonly continueTarget: MirBlockId; readonly breakTarget: MirBlockId }> = [];

	public lower(declaration: A.FunctionDeclaration): MirFunction | undefined {
		if (declaration.expressionBody) return undefined;
		const entry = this.createBlock();
		const exit = this.lowerBlock(declaration.body as A.BlockStatement, entry);
		if (this.block(exit).terminator === undefined) this.block(exit).terminator = { kind: 'end' };
		return {
			declarationNodeId: declaration.id,
			name: declaration.name,
			entry,
			blocks: this.#blocks.map(block => ({ id: block.id, instructions: block.instructions, terminator: block.terminator ?? { kind: 'end' } })),
		};
	}

	private createBlock(): MirBlockId {
		const id = this.#blocks.length;
		this.#blocks.push({ id, instructions: [] });
		return id;
	}

	private block(id: MirBlockId): MutableBlock { return this.#blocks[id]!; }

	private lowerBlock(block: A.BlockStatement, start: MirBlockId): MirBlockId {
		let current = start;
		for (const statement of block.statements) {
			if (this.block(current).terminator !== undefined) {
				const unreachable = this.createBlock();
				this.block(unreachable).terminator = { kind: 'unreachable' };
				continue;
			}
			current = this.lowerStatement(statement, current);
		}
		return current;
	}

	private lowerStatement(statement: A.Statement, current: MirBlockId): MirBlockId {
		switch (statement.kind) {
			case 'LetStatement':
				this.push(current, statement, 'let', statement.value.inferredTypeId);
				return current;
			case 'AssignmentStatement':
				this.push(current, statement, 'assign', statement.value.inferredTypeId);
				return current;
			case 'ExpressionStatement':
			case 'DiscardStatement':
				this.push(current, statement, 'evaluate', statement.expression.inferredTypeId);
				return current;
			case 'DeferStatement':
				this.push(current, statement, 'defer', statement.expression.inferredTypeId);
				return current;
			case 'ReturnStatement':
				this.block(current).terminator = { kind: 'return', ...(statement.value === undefined ? {} : { valueNodeId: statement.value.id }) };
				return current;
			case 'BreakStatement': { const loop = this.#loops.at(-1); this.block(current).terminator = loop === undefined ? { kind: 'unreachable' } : { kind: 'goto', target: loop.breakTarget }; return current; }
			case 'ContinueStatement': { const loop = this.#loops.at(-1); this.block(current).terminator = loop === undefined ? { kind: 'unreachable' } : { kind: 'goto', target: loop.continueTarget }; return current; }
			case 'IfStatement': return this.lowerIf(statement, current);
			case 'WhileStatement': return this.lowerWhile(statement, current);
			case 'ForStatement': return this.lowerFor(statement, current);
		}
	}

	private lowerIf(statement: A.IfStatement, current: MirBlockId): MirBlockId {
		const thenBlock = this.createBlock();
		const elseBlock = this.createBlock();
		const merge = this.createBlock();
		this.block(current).terminator = { kind: 'branch', conditionNodeId: statement.condition.id, thenTarget: thenBlock, elseTarget: elseBlock };
		const thenExit = this.lowerBlock(statement.thenBlock, thenBlock);
		if (this.block(thenExit).terminator === undefined) this.block(thenExit).terminator = { kind: 'goto', target: merge };
		let elseExit = elseBlock;
		if (statement.elseBranch !== undefined) {
			elseExit = statement.elseBranch.kind === 'BlockStatement'
				? this.lowerBlock(statement.elseBranch, elseBlock)
				: this.lowerStatement(statement.elseBranch, elseBlock);
		}
		if (this.block(elseExit).terminator === undefined) this.block(elseExit).terminator = { kind: 'goto', target: merge };
		return merge;
	}

	private lowerWhile(statement: A.WhileStatement, current: MirBlockId): MirBlockId {
		const condition = this.createBlock();
		const body = this.createBlock();
		const exit = this.createBlock();
		this.block(current).terminator = { kind: 'goto', target: condition };
		this.block(condition).terminator = { kind: 'branch', conditionNodeId: statement.condition.id, thenTarget: body, elseTarget: exit };
		this.#loops.push({ continueTarget: condition, breakTarget: exit });
		const bodyExit = this.lowerBlock(statement.body, body);
		this.#loops.pop();
		if (this.block(bodyExit).terminator === undefined) this.block(bodyExit).terminator = { kind: 'goto', target: condition };
		return exit;
	}

	private lowerFor(statement: A.ForStatement, current: MirBlockId): MirBlockId {
		// The iterator protocol is lowered by code generation. MIR records the loop's
		// control-flow shape and the iterable expression as an evaluated instruction.
		this.push(current, statement, 'evaluate', statement.iterable.inferredTypeId);
		const condition = this.createBlock();
		const body = this.createBlock();
		const exit = this.createBlock();
		this.block(current).terminator = { kind: 'goto', target: condition };
		this.block(condition).terminator = { kind: 'branch', conditionNodeId: statement.iterable.id, thenTarget: body, elseTarget: exit };
		this.#loops.push({ continueTarget: condition, breakTarget: exit });
		const bodyExit = this.lowerBlock(statement.body, body);
		this.#loops.pop();
		if (this.block(bodyExit).terminator === undefined) this.block(bodyExit).terminator = { kind: 'goto', target: condition };
		return exit;
	}

	private push(blockId: MirBlockId, node: A.AstNode, kind: MirInstruction['kind'], typeId?: number): void {
		this.block(blockId).instructions.push({ nodeId: node.id, kind, span: node.span, ...(typeId === undefined ? {} : { typeId }) });
	}
}

export function lowerFunctionToMir(declaration: A.FunctionDeclaration): MirFunction | undefined {
	return new MirBuilder().lower(declaration);
}
