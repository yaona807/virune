import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { NodeId, SymbolId, TypeId } from '../source.js';
import { lowerFunctionToMir } from '../mir/lower.js';
import type { TypedHirModule } from './nodes.js';

export type HirModule = TypedHirModule;

function lowerExpression(expression: A.Expression): A.Expression {
	switch (expression.kind) {
		case 'PipelineExpression': {
			const left = lowerExpression(expression.left);
			const right = lowerExpression(expression.right);
			if (right.kind === 'CallExpression') return { ...right, arguments: [left, ...right.arguments.map(lowerExpression)] };
			return { id: expression.id, kind: 'CallExpression', span: expression.span, callee: right, typeArguments: [], arguments: [left], ...(expression.inferredTypeId === undefined ? {} : { inferredTypeId: expression.inferredTypeId }) };
		}
		case 'CallExpression': return { ...expression, callee: lowerExpression(expression.callee), arguments: expression.arguments.map(lowerExpression) };
		case 'FieldExpression': return { ...expression, target: lowerExpression(expression.target) };
		case 'BinaryExpression': return { ...expression, left: lowerExpression(expression.left), right: lowerExpression(expression.right) };
		case 'UnaryExpression': return { ...expression, operand: lowerExpression(expression.operand) };
		case 'TryExpression': return { ...expression, operand: lowerExpression(expression.operand) };
		case 'AwaitExpression': return { ...expression, operand: lowerExpression(expression.operand) };
		case 'RecordExpression': return { ...expression, entries: expression.entries.map(entry => ({ ...entry, value: lowerExpression(entry.value) })) };
		case 'RecordUpdateExpression': return { ...expression, base: lowerExpression(expression.base), entries: expression.entries.map(entry => ({ ...entry, value: lowerExpression(entry.value) })) };
		case 'ListExpression': return { ...expression, items: expression.items.map(lowerExpression) };
		case 'TupleExpression': return { ...expression, items: expression.items.map(lowerExpression) };
		case 'ConditionalExpression': return { ...expression, condition: lowerExpression(expression.condition), thenExpression: lowerExpression(expression.thenExpression), elseExpression: lowerExpression(expression.elseExpression) };
		case 'MatchExpression': return { ...expression, target: lowerExpression(expression.target), arms: expression.arms.map(arm => ({ ...arm, ...(arm.guard === undefined ? {} : { guard: lowerExpression(arm.guard) }), expression: lowerExpression(arm.expression) })) };
		case 'LambdaExpression': return { ...expression, body: expression.expressionBody ? lowerExpression(expression.body as A.Expression) : lowerBlock(expression.body as A.BlockStatement) };
		case 'ParallelExpression': return { ...expression, entries: expression.entries.map(entry => ({ ...entry, value: lowerExpression(entry.value) })) };
		default: return expression;
	}
}

function lowerStatement(statement: A.Statement): A.Statement {
	switch (statement.kind) {
		case 'LetStatement': return { ...statement, value: lowerExpression(statement.value) };
		case 'ReturnStatement': return statement.value === undefined ? statement : { ...statement, value: lowerExpression(statement.value) };
		case 'IfStatement': return { ...statement, condition: lowerExpression(statement.condition), thenBlock: lowerBlock(statement.thenBlock), ...(statement.elseBranch === undefined ? {} : { elseBranch: statement.elseBranch.kind === 'BlockStatement' ? lowerBlock(statement.elseBranch) : lowerStatement(statement.elseBranch) as A.IfStatement }) };
		case 'ForStatement': return { ...statement, iterable: lowerExpression(statement.iterable), body: lowerBlock(statement.body) };
		case 'WhileStatement': return { ...statement, condition: lowerExpression(statement.condition), body: lowerBlock(statement.body) };
		case 'AssignmentStatement': return { ...statement, value: lowerExpression(statement.value) };
		case 'DiscardStatement': return { ...statement, expression: lowerExpression(statement.expression) };
		case 'ExpressionStatement': return { ...statement, expression: lowerExpression(statement.expression) };
		case 'BreakStatement': case 'ContinueStatement': return statement;
		case 'DeferStatement': return { ...statement, expression: lowerExpression(statement.expression) };
	}
}

function lowerBlock(block: A.BlockStatement): A.BlockStatement { return { ...block, statements: block.statements.map(lowerStatement) }; }

export function lowerToHir(module: A.ModuleNode, semantic: SemanticModel): HirModule {
	const declarations = module.declarations.map(declaration => {
		if (declaration.kind === 'FunctionDeclaration') return { ...declaration, body: declaration.expressionBody ? lowerExpression(declaration.body as A.Expression) : lowerBlock(declaration.body as A.BlockStatement) };
		if (declaration.kind === 'TopLevelLetDeclaration') return { ...declaration, value: lowerExpression(declaration.value) };
		if (declaration.kind === 'TestDeclaration') return { ...declaration, body: lowerBlock(declaration.body) };
		return declaration;
	});
	const loweredModule = { ...module, declarations };
	const nodeTypes = new Map<NodeId, TypeId>();
	const symbolReferences = new Map<NodeId, SymbolId>();
	collectSemanticMetadata(loweredModule, nodeTypes, symbolReferences);
	const mirFunctions = declarations
		.filter((declaration): declaration is A.FunctionDeclaration => declaration.kind === 'FunctionDeclaration')
		.map(lowerFunctionToMir)
		.filter((value): value is NonNullable<typeof value> => value !== undefined);
	return { module: loweredModule, semantic, nodeTypes, symbolReferences, mirFunctions };
}

function collectSemanticMetadata(value: unknown, nodeTypes: Map<NodeId, TypeId>, symbolReferences: Map<NodeId, SymbolId>): void {
	if (value === null || typeof value !== 'object') return;
	if (Array.isArray(value)) { for (const item of value) collectSemanticMetadata(item, nodeTypes, symbolReferences); return; }
	const node = value as Record<string, unknown>;
	if (typeof node.id === 'number') {
		if (typeof node.inferredTypeId === 'number') nodeTypes.set(node.id, node.inferredTypeId);
		if (typeof node.resolvedTypeId === 'number') nodeTypes.set(node.id, node.resolvedTypeId);
		if (typeof node.symbolId === 'number') symbolReferences.set(node.id, node.symbolId);
		if (typeof node.targetSymbolId === 'number') symbolReferences.set(node.id, node.targetSymbolId);
	}
	for (const [key, child] of Object.entries(node)) {
		if (key === 'span' || key === 'inferredTypeId' || key === 'resolvedTypeId' || key === 'symbolId' || key === 'targetSymbolId') continue;
		collectSemanticMetadata(child, nodeTypes, symbolReferences);
	}
}
