import {
	lex,
	type AstNode,
	type BuiltModule,
	type SemanticModel,
	type SourceFile,
} from '@virune/compiler/experimental';
import { CompletionItemKind, MarkupKind, type CompletionItem } from 'vscode-languageserver/node';
import { nameRange, positionToOffset } from '../analysis/position.js';
import { autoImportItems, type WorkspaceExport } from './auto-import.js';
import { documentationSummary, recordFieldDocumentation, symbolDocumentationSummary } from './documentation.js';

type SymbolInfo = SemanticModel['symbols'] extends ReadonlyMap<number, infer Value> ? Value : never;

const keywords = [
	'as', 'async', 'await', 'break', 'const', 'continue', 'defer', 'derives', 'discard', 'else',
	'enum', 'extern', 'false', 'fn', 'for', 'from', 'if', 'import', 'in', 'js', 'let', 'match', 'module', 'mut',
	'newtype', 'parallel', 'pub', 'record', 'return', 'test', 'then', 'true', 'try', 'type', 'unsafe',
	'uses', 'while', 'with',
] as const;

interface BraceScope {
	readonly start: number;
	readonly end: number;
}

export function completionItems(
	module: BuiltModule,
	source: SourceFile,
	offset: number,
	workspaceExports: readonly WorkspaceExport[] = [],
): readonly CompletionItem[] {
	const semantic = module.semantic;
	if (semantic === undefined) return keywordItems();
	const globalIds = new Set(semantic.globalScope.values().map(symbol => symbol.id));
	const visibleSymbols = new Map<string, SymbolInfo>();
	for (const symbol of semantic.globalScope.values()) visibleSymbols.set(symbol.name, symbol);
	for (const symbol of semantic.symbols.values()) {
		if (globalIds.has(symbol.id) || !isLocalSymbol(symbol)) continue;
		if (isVisibleLocal(symbol, module, source, offset)) visibleSymbols.set(symbol.name, symbol);
	}

	const fieldItems = completeFieldAccess(source, offset, visibleSymbols, module);
	if (fieldItems !== undefined) return fieldItems;

	const items = [...visibleSymbols.values()]
		.map(symbol => symbolCompletion(symbol, module))
		.sort((left, right) => left.label.localeCompare(right.label));
	const existing = new Set(items.map(item => item.label));
	for (const item of autoImportItems(workspaceExports, module, source, existing)) {
		if (!existing.has(item.label)) items.push(item);
	}
	for (const item of keywordItems()) if (!existing.has(item.label)) items.push(item);
	return items;
}

function completeFieldAccess(
	source: SourceFile,
	offset: number,
	visibleSymbols: ReadonlyMap<string, SymbolInfo>,
	module: BuiltModule,
): readonly CompletionItem[] | undefined {
	if (module.semantic === undefined) return undefined;
	const prefix = source.text.slice(Math.max(0, offset - 256), offset);
	const match = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)?$/u.exec(prefix);
	if (match?.[1] === undefined) return undefined;
	const symbol = visibleSymbols.get(match[1]);
	if (symbol === undefined) return [];
	const type = module.semantic.arena.get(symbol.typeId);
	if (type.kind !== 'named') return [];
	const items: CompletionItem[] = [];
	for (const [name, typeId] of type.fields ?? []) {
		const documentation = documentationSummary(recordFieldDocumentation(module, symbol.typeId, name));
		items.push({
			label: name,
			kind: CompletionItemKind.Field,
			detail: module.semantic.arena.display(typeId),
			...(documentation === undefined ? {} : { documentation: { kind: MarkupKind.Markdown, value: documentation } }),
		});
	}
	return items.sort((left, right) => left.label.localeCompare(right.label));
}

function isLocalSymbol(symbol: SymbolInfo): boolean {
	return symbol.kind === 'variable' || symbol.kind === 'parameter';
}

function isVisibleLocal(symbol: SymbolInfo, module: BuiltModule, source: SourceFile, offset: number): boolean {
	if (symbol.span.fileId !== source.id || symbol.declaration === undefined || module.ast === undefined) return false;
	const declarationOffset = positionToOffset(source, nameRange(source, symbol.span, symbol.name).start);
	if (symbol.kind === 'variable' && declarationOffset >= offset) return false;
	const scopes = braceScopes(source.text);
	const cursorScope = innermostScope(scopes, offset);
	const declarationScope = innermostScope(scopes, declarationOffset);
	if (symbol.kind === 'parameter') {
		const owner = symbol.declaration;
		const ownerScope = (owner.kind === 'FunctionDeclaration' || owner.kind === 'LambdaExpression') && 'body' in owner
			? scopeContainingNode(scopes, source, owner.body as AstNode)
			: undefined;
		return ownerScope === undefined ? sameTopLevelRegion(module, source, owner, offset) : scopeContains(ownerScope, offset);
	}
	if (symbol.declaration.kind === 'ForStatement' && 'body' in symbol.declaration) {
		const bodyScope = scopeContainingNode(scopes, source, symbol.declaration.body as AstNode);
		return bodyScope !== undefined && scopeContains(bodyScope, offset);
	}
	if (symbol.declaration.kind === 'BindingPattern') {
		const declarationLine = nameRange(source, symbol.span, symbol.name).start.line;
		const cursorLine = offsetToLine(source.text, offset);
		return declarationLine === cursorLine && declarationOffset < offset;
	}
	return declarationScope === undefined
		? sameTopLevelRegion(module, source, symbol.declaration, offset)
		: cursorScope !== undefined && isAncestorScope(declarationScope, cursorScope);
}

function sameTopLevelRegion(module: BuiltModule, source: SourceFile, declaration: AstNode, offset: number): boolean {
	if (module.ast === undefined) return false;
	const topLevel = module.ast.declarations.find(item => containsObject(item, declaration));
	if (topLevel === undefined) return false;
	const declarations = module.ast.declarations;
	const index = declarations.indexOf(topLevel);
	const startLine = Math.max(0, topLevel.span.start.line - 1);
	const start = lineStartOffset(source.text, startLine);
	const next = declarations[index + 1];
	const end = next === undefined ? source.text.length : lineStartOffset(source.text, Math.max(0, next.span.start.line - 1));
	return offset >= start && offset < end;
}

function containsObject(root: unknown, target: object): boolean {
	if (root === target) return true;
	if (Array.isArray(root)) return root.some(item => containsObject(item, target));
	if (root === null || typeof root !== 'object') return false;
	for (const [key, value] of Object.entries(root)) {
		if (key === 'span') continue;
		if (containsObject(value, target)) return true;
	}
	return false;
}

function scopeContainingNode(scopes: readonly BraceScope[], source: SourceFile, node: AstNode): BraceScope | undefined {
	const offset = positionToOffset(source, { line: Math.max(0, node.span.start.line - 1), character: Math.max(0, node.span.start.column - 1) });
	return innermostScope(scopes, offset);
}

function braceScopes(text: string): readonly BraceScope[] {
	const stack: number[] = [];
	const result: BraceScope[] = [];
	for (const token of lex(text).tokens) {
		if (token.tokenType.name === 'LBrace') stack.push(token.startOffset);
		else if (token.tokenType.name === 'RBrace') {
			const open = stack.pop();
			if (open !== undefined) result.push({ start: open, end: (token.endOffset ?? token.startOffset) + 1 });
		}
	}
	return result;
}

function innermostScope(scopes: readonly BraceScope[], offset: number): BraceScope | undefined {
	return scopes
		.filter(scope => scopeContains(scope, offset))
		.sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
}

function scopeContains(scope: BraceScope, offset: number): boolean {
	return offset > scope.start && offset < scope.end;
}

function isAncestorScope(ancestor: BraceScope, child: BraceScope): boolean {
	return ancestor.start <= child.start && ancestor.end >= child.end;
}

function offsetToLine(text: string, offset: number): number {
	let line = 0;
	for (let index = 0; index < Math.min(offset, text.length); index++) if (text.charCodeAt(index) === 10) line++;
	return line;
}

function lineStartOffset(text: string, targetLine: number): number {
	let line = 0;
	let offset = 0;
	while (line < targetLine) {
		const next = text.indexOf('\n', offset);
		if (next < 0) return text.length;
		offset = next + 1;
		line++;
	}
	return offset;
}

function symbolCompletion(symbol: SymbolInfo, module: BuiltModule): CompletionItem {
	const item: CompletionItem = {
		label: symbol.name,
		kind: completionKind(symbol.kind, symbol.constant),
	};
	if (module.semantic !== undefined) item.detail = module.semantic.arena.display(symbol.typeId);
	if (symbol.kind === 'function' || symbol.kind === 'extern' || symbol.kind === 'builtin') item.insertText = `${symbol.name}()`;
	const documentation = symbolDocumentationSummary(symbol);
	if (documentation !== undefined) item.documentation = { kind: MarkupKind.Markdown, value: documentation };
	return item;
}

function completionKind(kind: SymbolInfo['kind'], constant: boolean): CompletionItemKind {
	switch (kind) {
		case 'function': return CompletionItemKind.Function;
		case 'extern': return CompletionItemKind.Function;
		case 'builtin': return CompletionItemKind.Function;
		case 'type': return CompletionItemKind.Class;
		case 'variant': return CompletionItemKind.EnumMember;
		case 'parameter': return CompletionItemKind.Variable;
		case 'variable': return constant ? CompletionItemKind.Constant : CompletionItemKind.Variable;
		case 'import': return CompletionItemKind.Reference;
	}
	return CompletionItemKind.Text;
}

function keywordItems(): CompletionItem[] {
	return keywords.map(keyword => ({ label: keyword, kind: CompletionItemKind.Keyword }));
}
