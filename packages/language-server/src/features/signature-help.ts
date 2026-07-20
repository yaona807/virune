import type {
	AstNode,
	BuiltModule,
	CallExpression,
	ExternFunctionNode,
	FunctionDeclaration,
	LambdaExpression,
	ParameterNode,
	SourceFile,
} from '@virune/compiler/experimental';
import { MarkupKind, type ParameterInformation, type SignatureHelp, type SignatureInformation } from 'vscode-languageserver/node';
import { findSmallestNode } from '../analysis/ast.js';
import { documentationText } from './documentation.js';

export function signatureHelpAt(module: BuiltModule, source: SourceFile, offset: number): SignatureHelp | undefined {
	if (module.ast === undefined || module.semantic === undefined) return undefined;
	const call = findSmallestNode(module.ast, source, offset, isCallExpression);
	if (call === undefined) return undefined;
	const callable = resolveCallable(module, call);
	if (callable === undefined) return undefined;
	const signature = signatureInformation(module, callable);
	const activeParameter = Math.min(
		Math.max(0, activeArgumentIndex(source, call, offset)),
		Math.max(0, signature.parameters?.length === undefined ? 0 : signature.parameters.length - 1),
	);
	return {
		signatures: [signature],
		activeSignature: 0,
		activeParameter,
	};
}

interface CallableInformation {
	readonly name: string;
	readonly public: boolean;
	readonly async: boolean;
	readonly typeParameters: readonly string[];
	readonly parameters: readonly { readonly name: string; readonly optional: boolean; readonly type: string }[];
	readonly result: string;
	readonly effects: readonly string[];
	readonly documentation?: string;
}

function resolveCallable(module: BuiltModule, call: CallExpression): CallableInformation | undefined {
	if (module.semantic === undefined) return undefined;
	const typeId = call.callee.inferredTypeId;
	if (typeId === undefined) return undefined;
	const type = module.semantic.arena.get(typeId);
	if (type.kind !== 'function') return undefined;
	const declaration = callableDeclaration(module, call);
	const parameterNodes = declaration?.parameters ?? [];
	const documentation = documentationText(declaration);
	return {
		name: callableName(call, declaration),
		public: declaration?.kind === 'FunctionDeclaration' ? declaration.public : false,
		async: type.async,
		typeParameters: type.typeParameters,
		parameters: type.parameters.map((parameterType, index) => ({
			name: parameterNodes[index]?.name ?? `arg${index + 1}`,
			optional: optionalParameter(parameterNodes[index]),
			type: module.semantic?.arena.display(parameterType) ?? '<invalid>',
		})),
		result: module.semantic.arena.display(type.result),
		effects: type.effects,
		...(documentation === undefined ? {} : { documentation }),
	};
}

function optionalParameter(parameter: { readonly name: string } | undefined): boolean {
	return parameter !== undefined && 'optional' in parameter && parameter.optional === true;
}

function signatureInformation(module: BuiltModule, callable: CallableInformation): SignatureInformation {
	const parameters = callable.parameters.map(parameter => `${parameter.name}${parameter.optional ? '?' : ''}: ${parameter.type}`);
	const typeParameters = callable.typeParameters.length === 0 ? '' : `<${callable.typeParameters.join(', ')}>`;
	const effects = callable.effects.length === 0 ? '' : ` uses ${callable.effects.join(', ')}`;
	const label = `${callable.public ? 'pub ' : ''}${callable.async ? 'async ' : ''}fn ${callable.name}${typeParameters}(${parameters.join(', ')}) -> ${callable.result}${effects}`;
	const parameterInformation: ParameterInformation[] = parameters.map(parameter => ({ label: parameter }));
	const details = `Defined in \`${module.source.path.replaceAll('`', '\\`')}\``;
	return {
		label,
		parameters: parameterInformation,
		documentation: {
			kind: MarkupKind.Markdown,
			value: callable.documentation === undefined ? details : `${callable.documentation}\n\n${details}`,
		},
	};
}

function callableDeclaration(
	module: BuiltModule,
	call: CallExpression,
): FunctionDeclaration | ExternFunctionNode | LambdaExpression | undefined {
	if (call.callee.kind === 'LambdaExpression') return call.callee;
	if (call.callee.kind !== 'IdentifierExpression' || call.callee.symbolId === undefined) return undefined;
	const symbol = module.semantic?.symbols.get(call.callee.symbolId);
	if (symbol?.kind !== 'function' && symbol?.kind !== 'extern') return undefined;
	const declaration = symbol.declaration;
	return declaration !== undefined && isCallableDeclaration(declaration) ? declaration : undefined;
}

function callableName(
	call: CallExpression,
	declaration: FunctionDeclaration | ExternFunctionNode | LambdaExpression | undefined,
): string {
	if (declaration?.kind === 'FunctionDeclaration' || declaration?.kind === 'ExternFunction') return declaration.name;
	if (call.callee.kind === 'IdentifierExpression') return call.callee.name;
	if (call.callee.kind === 'FieldExpression') return call.callee.field;
	return '<lambda>';
}

function activeArgumentIndex(source: SourceFile, call: CallExpression, offset: number): number {
	const start = call.callee.span.end.offset;
	const end = Math.min(offset, call.span.end.offset + 1, source.text.length);
	const open = source.text.indexOf('(', start);
	if (open < 0 || open >= end) return 0;
	let argument = 0;
	let parenthesisDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let inString = false;
	let escaped = false;
	for (let index = open + 1; index < end; index++) {
		const character = source.text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') {
			inString = true;
			continue;
		}
		if (character === '(') parenthesisDepth++;
		else if (character === ')') {
			if (parenthesisDepth === 0) break;
			parenthesisDepth--;
		} else if (character === '[') bracketDepth++;
		else if (character === ']') bracketDepth = Math.max(0, bracketDepth - 1);
		else if (character === '{') braceDepth++;
		else if (character === '}') braceDepth = Math.max(0, braceDepth - 1);
		else if (character === ',' && parenthesisDepth === 0 && bracketDepth === 0 && braceDepth === 0) argument++;
	}
	return argument;
}

function isCallExpression(node: AstNode): node is CallExpression {
	return node.kind === 'CallExpression';
}

function isCallableDeclaration(node: AstNode): node is FunctionDeclaration | ExternFunctionNode | LambdaExpression {
	return node.kind === 'FunctionDeclaration' || node.kind === 'ExternFunction' || node.kind === 'LambdaExpression';
}
