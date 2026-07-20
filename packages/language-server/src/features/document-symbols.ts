import type { BuiltModule, Declaration, SourceFile, SourceSpan } from '@virune/compiler/experimental';
import { SymbolKind, type DocumentSymbol, type Range } from 'vscode-languageserver/node';
import { nameRange, sourceSpanToRange } from '../analysis/position.js';

export function documentSymbols(module: BuiltModule): readonly DocumentSymbol[] {
	if (module.ast === undefined) return [];
	return module.ast.declarations.map(declaration => declarationSymbol(module.source, declaration));
}

function declarationSymbol(source: SourceFile, declaration: Declaration): DocumentSymbol {
	const name = declarationName(declaration);
	const children = [...declarationChildren(source, declaration)];
	const ranges = documentSymbolRanges(source, declaration.span, name);
	const symbol: DocumentSymbol = {
		name,
		kind: declarationKind(declaration),
		...ranges,
	};
	if (children.length > 0) symbol.children = children;
	return symbol;
}

function declarationName(declaration: Declaration): string {
	if (declaration.kind === 'ExternDeclaration') return declaration.module;
	return declaration.name;
}

function declarationKind(declaration: Declaration): SymbolKind {
	switch (declaration.kind) {
		case 'FunctionDeclaration': return SymbolKind.Function;
		case 'RecordDeclaration': return SymbolKind.Struct;
		case 'EnumDeclaration': return SymbolKind.Enum;
		case 'NewtypeDeclaration': return SymbolKind.Class;
		case 'TypeAliasDeclaration': return SymbolKind.TypeParameter;
		case 'ExternDeclaration': return SymbolKind.Module;
		case 'TestDeclaration': return SymbolKind.Function;
		case 'TopLevelLetDeclaration': return declaration.constant ? SymbolKind.Constant : SymbolKind.Variable;
	}
}

function declarationChildren(source: SourceFile, declaration: Declaration): readonly DocumentSymbol[] {
	switch (declaration.kind) {
		case 'RecordDeclaration':
			return declaration.fields.map(field => ({
				name: field.name,
				kind: SymbolKind.Field,
				...documentSymbolRanges(source, field.span, field.name),
			}));
		case 'EnumDeclaration':
			return declaration.variants.map(variant => ({
				name: variant.name,
				kind: SymbolKind.EnumMember,
				...documentSymbolRanges(source, variant.span, variant.name),
			}));
		case 'ExternDeclaration':
			return declaration.functions.map(fn => ({
				name: fn.name,
				kind: SymbolKind.Function,
				...documentSymbolRanges(source, fn.span, fn.name),
			}));
		default:
			return [];
	}
}

function documentSymbolRanges(
	source: SourceFile,
	span: SourceSpan,
	name: string,
): Pick<DocumentSymbol, 'range' | 'selectionRange'> {
	const range = normalizeRange(sourceSpanToRange(span));
	const candidate = normalizeRange(nameRange(source, span, name));
	return {
		range,
		selectionRange: rangeContains(range, candidate) ? candidate : range,
	};
}

function normalizeRange(range: Range): Range {
	return comparePosition(range.start, range.end) <= 0 ? range : { start: range.start, end: range.start };
}

function rangeContains(parent: Range, child: Range): boolean {
	return comparePosition(parent.start, child.start) <= 0 && comparePosition(child.end, parent.end) <= 0;
}

function comparePosition(left: Range['start'], right: Range['start']): number {
	return left.line === right.line ? left.character - right.character : left.line - right.line;
}
