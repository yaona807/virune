import {
	lex,
	type AstNode,
	type BuiltModule,
	type Declaration,
	type SemanticModel,
	type SourceFile,
} from '@virune/compiler/experimental';
import { SemanticTokensBuilder, type Range, type SemanticTokens } from 'vscode-languageserver/node';
import { walkAst } from '../analysis/ast.js';
import { nameRange, offsetToPosition } from '../analysis/position.js';

type SymbolInfo = SemanticModel['symbols'] extends ReadonlyMap<number, infer Value> ? Value : never;

export const semanticTokenTypes = ['namespace', 'type', 'enumMember', 'function', 'method', 'parameter', 'variable', 'property', 'event'] as const;
export const semanticTokenModifiers = ['declaration', 'readonly', 'async', 'defaultLibrary'] as const;

interface TokenEntry {
	readonly range: Range;
	readonly type: typeof semanticTokenTypes[number];
	readonly modifiers: readonly typeof semanticTokenModifiers[number][];
}

export function semanticTokens(module: BuiltModule): SemanticTokens {
	const builder = new SemanticTokensBuilder();
	if (module.ast === undefined) return builder.build();
	const entries: TokenEntry[] = [];
	collectNamedTypeTokens(entries, module);
	for (const declaration of module.ast.declarations) collectDeclaration(entries, module.source, declaration);
	walkAst(module.ast, node => collectNode(entries, module, node));
	const unique = deduplicate(entries);
	for (const entry of unique) {
		if (entry.range.start.line !== entry.range.end.line) continue;
		const length = entry.range.end.character - entry.range.start.character;
		if (length <= 0) continue;
		builder.push(
			entry.range.start.line,
			entry.range.start.character,
			length,
			semanticTokenTypes.indexOf(entry.type),
			modifierMask(entry.modifiers),
		);
	}
	return builder.build();
}

function collectNamedTypeTokens(entries: TokenEntry[], module: BuiltModule): void {
	if (module.semantic === undefined) return;
	for (const token of lex(module.source.text).tokens) {
		if (!module.semantic.namedTypes.has(token.image)) continue;
		const start = token.startOffset;
		const end = (token.endOffset ?? start) + 1;
		add(entries, {
			start: offsetToPosition(module.source, start),
			end: offsetToPosition(module.source, end),
		}, 'type', []);
	}
}

function collectDeclaration(entries: TokenEntry[], source: SourceFile, declaration: Declaration): void {
	if (declaration.kind === 'ExternDeclaration') {
		for (const fn of declaration.functions) {
			add(entries, nameRange(source, fn.span, fn.name), 'function', ['declaration', ...(fn.async ? ['async'] as const : [])]);
			for (const parameter of fn.parameters) add(entries, nameRange(source, parameter.span, parameter.name), 'parameter', ['declaration', 'readonly']);
		}
		return;
	}
	const name = declaration.name;
	switch (declaration.kind) {
		case 'FunctionDeclaration':
			add(entries, nameRange(source, declaration.span, name), 'function', ['declaration', ...(declaration.async ? ['async'] as const : [])]);
			for (const parameter of declaration.parameters) add(entries, nameRange(source, parameter.span, parameter.name), 'parameter', ['declaration', 'readonly']);
			break;
		case 'RecordDeclaration':
			add(entries, nameRange(source, declaration.span, name), 'type', ['declaration']);
			for (const field of declaration.fields) add(entries, nameRange(source, field.span, field.name), 'property', ['declaration']);
			break;
		case 'EnumDeclaration':
			add(entries, nameRange(source, declaration.span, name), 'type', ['declaration']);
			for (const variant of declaration.variants) add(entries, nameRange(source, variant.span, variant.name), 'enumMember', ['declaration', 'readonly']);
			break;
		case 'NewtypeDeclaration':
		case 'TypeAliasDeclaration':
			add(entries, nameRange(source, declaration.span, name), 'type', ['declaration']);
			break;
		case 'TestDeclaration':
			break;
		case 'TopLevelLetDeclaration':
			add(entries, nameRange(source, declaration.span, name), 'variable', ['declaration', ...(declaration.constant ? ['readonly'] as const : [])]);
			break;
	}
}

function collectNode(entries: TokenEntry[], module: BuiltModule, node: AstNode): void {
	const source = module.source;
	const symbol = symbolForNode(module, node);
	if (node.kind === 'IdentifierExpression' && symbol !== undefined && 'name' in node && typeof node.name === 'string') {
		add(entries, nameRange(source, node.span, node.name), tokenType(symbol), symbolModifiers(symbol));

	} else if (node.kind === 'LetStatement' && 'name' in node && typeof node.name === 'string') {
		add(entries, nameRange(source, node.span, node.name), 'variable', ['declaration', ...(('mutable' in node && node.mutable === false) ? ['readonly'] as const : [])]);
	} else if (node.kind === 'ForStatement' && 'name' in node && typeof node.name === 'string') {
		add(entries, nameRange(source, node.span, node.name), 'variable', ['declaration']);
	} else if (node.kind === 'BindingPattern' && 'name' in node && typeof node.name === 'string') {
		add(entries, nameRange(source, node.span, node.name), 'variable', ['declaration']);
	} else if (node.kind === 'FieldExpression' && 'field' in node && typeof node.field === 'string') {
		add(entries, nameRange(source, node.span, node.field), 'property', []);
	} else if (node.kind === 'RecordExpression' && 'name' in node && typeof node.name === 'string') {
		add(entries, nameRange(source, node.span, node.name), 'type', []);
	} else if (node.kind === 'VariantPattern' && 'name' in node && typeof node.name === 'string') {
		add(entries, nameRange(source, node.span, node.name), 'enumMember', []);
	} else if (node.kind === 'LambdaExpression' && 'parameters' in node && Array.isArray(node.parameters)) {
		for (const parameter of node.parameters) {
			if (parameter !== null && typeof parameter === 'object' && 'name' in parameter && 'span' in parameter && typeof parameter.name === 'string') {
				add(entries, nameRange(source, parameter.span as never, parameter.name), 'parameter', ['declaration', 'readonly']);
			}
		}
	}
}

function symbolForNode(module: BuiltModule, node: AstNode): SymbolInfo | undefined {
	if (module.semantic === undefined || !('symbolId' in node) || typeof node.symbolId !== 'number') return undefined;
	return module.semantic.symbols.get(node.symbolId);
}

function tokenType(symbol: SymbolInfo): TokenEntry['type'] {
	switch (symbol.kind) {
		case 'function': return 'function';
		case 'extern': return 'function';
		case 'builtin': return 'function';
		case 'type': return 'type';
		case 'variant': return 'enumMember';
		case 'parameter': return 'parameter';
		case 'variable': return 'variable';
		case 'import': return 'namespace';
	}
	return 'variable';
}

function symbolModifiers(symbol: SymbolInfo): readonly TokenEntry['modifiers'][number][] {
	return [
		...(symbol.constant || (!symbol.mutable && symbol.kind === 'variable') ? ['readonly'] as const : []),
		...(symbol.kind === 'builtin' ? ['defaultLibrary'] as const : []),
	];
}

function add(entries: TokenEntry[], range: Range, type: TokenEntry['type'], modifiers: TokenEntry['modifiers']): void {
	entries.push({ range, type, modifiers });
}

function deduplicate(entries: readonly TokenEntry[]): readonly TokenEntry[] {
	const sorted = [...entries].sort((left, right) =>
		left.range.start.line - right.range.start.line
		|| left.range.start.character - right.range.start.character
		|| (right.modifiers.includes('declaration') ? 1 : 0) - (left.modifiers.includes('declaration') ? 1 : 0));
	const result: TokenEntry[] = [];
	const seen = new Set<string>();
	for (const entry of sorted) {
		const key = `${entry.range.start.line}:${entry.range.start.character}:${entry.range.end.character}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(entry);
	}
	return result;
}

function modifierMask(modifiers: readonly TokenEntry['modifiers'][number][]): number {
	let result = 0;
	for (const modifier of modifiers) result |= 1 << semanticTokenModifiers.indexOf(modifier);
	return result;
}
