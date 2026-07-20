import {
	lex,
	type AstNode,
	type BuiltModule,
	type CallExpression,
	type Expression,
	type ExternFunctionNode,
	type ForStatement,
	type FunctionDeclaration,
	type LambdaExpression,
	type LetStatement,
	type SourceFile,
	type TopLevelLetDeclaration,
	type TypeId,
} from '@virune/compiler/experimental';
import { InlayHintKind, type InlayHint, type Position, type Range } from 'vscode-languageserver/node';
import { walkAst } from '../analysis/ast.js';
import { nameRange, offsetToPosition, positionToOffset, sourcePositionToPosition } from '../analysis/position.js';
import { defaultEditorInformationSettings, type EditorInformationSettings } from '../editor-information.js';

export function inlayHints(
	module: BuiltModule,
	range?: Range,
	settings: EditorInformationSettings = defaultEditorInformationSettings,
): readonly InlayHint[] {
	if (module.ast === undefined || module.semantic === undefined) return [];
	const hints: InlayHint[] = [];
	const tokens = lex(module.source.text).tokens;
	walkAst(module.ast, node => {
		switch (node.kind) {
			case 'TopLevelLetDeclaration': {
				const declaration = node as TopLevelLetDeclaration;
				if (settings.inlayHints.variableTypes && declaration.annotation === undefined) {
					pushTypeHint(hints, module, declaration.name, declaration.span, declaration.inferredTypeId, range);
				}
				break;
			}
			case 'LetStatement': {
				const statement = node as LetStatement;
				if (settings.inlayHints.variableTypes && statement.annotation === undefined) {
					pushTypeHint(hints, module, statement.name, statement.span, statement.inferredTypeId, range);
				}
				break;
			}
			case 'ForStatement': {
				const statement = node as ForStatement;
				if (!settings.inlayHints.forLoopVariableTypes || statement.symbolId === undefined) break;
				const symbol = module.semantic?.symbols.get(statement.symbolId);
				pushTypeHint(hints, module, statement.name, statement.span, symbol?.typeId, range);
				break;
			}
			case 'FunctionDeclaration': {
				const declaration = node as FunctionDeclaration;
				if (!settings.inlayHints.functionReturnTypes || declaration.returnType !== undefined) break;
				const position = closingParenthesisPosition(module.source, declaration, tokens);
				const type = displayType(module, declaration.inferredTypeId);
				if (position !== undefined && type !== undefined && positionInRange(position, range)) {
					hints.push({
						position,
						label: ` -> ${type}`,
						kind: InlayHintKind.Type,
						tooltip: `Inferred return type: ${type}`,
					});
				}
				break;
			}
			case 'LambdaExpression': {
				const expression = node as LambdaExpression;
				addLambdaHints(hints, module, expression, tokens, range, settings);
				break;
			}
			case 'CallExpression':
				addParameterNameHints(hints, module, node as CallExpression, range, settings);
				break;
			default:
				break;
		}
	});
	return hints.sort(compareHints);
}

function addLambdaHints(
	hints: InlayHint[],
	module: BuiltModule,
	expression: LambdaExpression,
	tokens: ReturnType<typeof lex>['tokens'],
	range: Range | undefined,
	settings: EditorInformationSettings,
): void {
	if (settings.inlayHints.lambdaParameterTypes) {
		for (const parameter of expression.parameters) {
			if (parameter.annotation !== undefined || parameter.symbolId === undefined) continue;
			const symbol = module.semantic?.symbols.get(parameter.symbolId);
			pushTypeHint(hints, module, parameter.name, parameter.span, symbol?.typeId, range);
		}
	}
	if (!settings.inlayHints.functionReturnTypes || expression.returnType !== undefined || expression.inferredTypeId === undefined) return;
	const lambdaType = module.semantic?.arena.get(expression.inferredTypeId);
	if (lambdaType?.kind !== 'function') return;
	const position = closingParenthesisPosition(module.source, expression, tokens);
	const type = displayType(module, lambdaType.result);
	if (position === undefined || type === undefined || !positionInRange(position, range)) return;
	hints.push({
		position,
		label: ` -> ${type}`,
		kind: InlayHintKind.Type,
		tooltip: `Inferred lambda return type: ${type}`,
	});
}

function addParameterNameHints(
	hints: InlayHint[],
	module: BuiltModule,
	call: CallExpression,
	range: Range | undefined,
	settings: EditorInformationSettings,
): void {
	if (settings.inlayHints.parameterNames === 'none') return;
	const parameters = callParameters(module, call);
	if (parameters === undefined) return;
	for (const [index, argument] of call.arguments.entries()) {
		const parameter = parameters[index];
		if (parameter === undefined || !shouldShowParameterHint(argument, parameter.name, settings)) continue;
		const position = sourcePositionToPosition(argument.span.start);
		if (!positionInRange(position, range)) continue;
		hints.push({
			position,
			label: `${parameter.name}:`,
			kind: InlayHintKind.Parameter,
			paddingRight: true,
			tooltip: `Parameter ${parameter.name}`,
		});
	}
}

function shouldShowParameterHint(
	argument: Expression,
	parameterName: string,
	settings: EditorInformationSettings,
): boolean {
	if (argument.kind === 'IdentifierExpression' && argument.name === parameterName) return false;
	if (settings.inlayHints.parameterNames === 'all') return true;
	return literalLike(argument);
}

function literalLike(expression: Expression): boolean {
	return expression.kind === 'LiteralExpression'
		|| expression.kind === 'ListExpression'
		|| expression.kind === 'TupleExpression'
		|| expression.kind === 'RecordExpression';
}

function callParameters(module: BuiltModule, call: CallExpression): readonly { readonly name: string }[] | undefined {
	if (call.callee.kind === 'LambdaExpression') return call.callee.parameters;
	if (call.callee.kind !== 'IdentifierExpression' || call.callee.symbolId === undefined) return undefined;
	const symbol = module.semantic?.symbols.get(call.callee.symbolId);
	if (symbol?.kind !== 'function' && symbol?.kind !== 'extern') return undefined;
	const declaration = symbol.declaration;
	if (declaration?.kind === 'FunctionDeclaration') return (declaration as FunctionDeclaration).parameters;
	if (declaration?.kind === 'ExternFunction') return (declaration as ExternFunctionNode).parameters;
	return undefined;
}

function pushTypeHint(
	hints: InlayHint[],
	module: BuiltModule,
	name: string,
	span: AstNode['span'],
	typeId: TypeId | undefined,
	range: Range | undefined,
): void {
	const type = displayType(module, typeId);
	if (type === undefined) return;
	const position = nameRange(module.source, span, name).end;
	if (!positionInRange(position, range)) return;
	hints.push({
		position,
		label: `: ${type}`,
		kind: InlayHintKind.Type,
		tooltip: `Inferred type: ${type}`,
	});
}

function displayType(module: BuiltModule, typeId: TypeId | undefined): string | undefined {
	if (module.semantic === undefined || typeId === undefined) return undefined;
	const value = module.semantic.arena.display(typeId);
	return value === '<invalid>' ? undefined : value;
}

function closingParenthesisPosition(
	source: SourceFile,
	node: FunctionDeclaration | LambdaExpression,
	tokens: ReturnType<typeof lex>['tokens'],
): Position | undefined {
	const start = node.kind === 'FunctionDeclaration'
		? positionToOffset(source, nameRange(source, node.span, node.name).end)
		: node.span.start.offset;
	const end = Math.max(start, node.span.end.offset + 1);
	let depth = 0;
	let foundOpening = false;
	for (const token of tokens) {
		if (token.startOffset < start || token.startOffset >= end) continue;
		if (token.tokenType.name === 'LParen') {
			depth++;
			foundOpening = true;
			continue;
		}
		if (token.tokenType.name !== 'RParen' || !foundOpening) continue;
		depth--;
		if (depth === 0) return offsetToPosition(source, (token.endOffset ?? token.startOffset) + 1);
	}
	return undefined;
}

function positionInRange(position: Position, range: Range | undefined): boolean {
	if (range === undefined) return true;
	return comparePositions(position, range.start) >= 0 && comparePositions(position, range.end) <= 0;
}

function compareHints(left: InlayHint, right: InlayHint): number {
	const position = comparePositions(left.position, right.position);
	if (position !== 0) return position;
	return String(left.label).localeCompare(String(right.label));
}

function comparePositions(left: Position, right: Position): number {
	return left.line === right.line ? left.character - right.character : left.line - right.line;
}
