import type { BuiltModule, Declaration, SourceFile } from '@virune/compiler/experimental';
import { SymbolKind, type DocumentSymbol } from 'vscode-languageserver/node';
import { nameRange, sourceSpanToRange } from '../analysis/position.js';

export function documentSymbols(module: BuiltModule): readonly DocumentSymbol[] {
	if (module.ast === undefined) return [];
	return module.ast.declarations.map(declaration => declarationSymbol(module.source, declaration));
}

function declarationSymbol(source: SourceFile, declaration: Declaration): DocumentSymbol {
	const name = declarationName(declaration);
	const children = [...declarationChildren(source, declaration)];
	const symbol: DocumentSymbol = {
		name,
		kind: declarationKind(declaration),
		range: sourceSpanToRange(declaration.span),
		selectionRange: nameRange(source, declaration.span, name),
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
				range: sourceSpanToRange(field.span),
				selectionRange: nameRange(source, field.span, field.name),
			}));
		case 'EnumDeclaration':
			return declaration.variants.map(variant => ({
				name: variant.name,
				kind: SymbolKind.EnumMember,
				range: sourceSpanToRange(variant.span),
				selectionRange: nameRange(source, variant.span, variant.name),
			}));
		case 'ExternDeclaration':
			return declaration.functions.map(fn => ({
				name: fn.name,
				kind: SymbolKind.Function,
				range: sourceSpanToRange(fn.span),
				selectionRange: nameRange(source, fn.span, fn.name),
			}));
		default:
			return [];
	}
}
