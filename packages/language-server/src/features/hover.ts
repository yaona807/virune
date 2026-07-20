import type { AstNode, BuiltModule, SourceFile, SymbolId, TypeId } from '@virune/compiler/experimental';
import { MarkupKind, type Hover } from 'vscode-languageserver/node';
import { findNodePathAtOffset } from '../analysis/ast.js';
import { sourceSpanToRange } from '../analysis/position.js';

interface SymbolNode extends AstNode { readonly symbolId?: SymbolId; readonly inferredTypeId?: TypeId; readonly resolvedTypeId?: TypeId; }

export function hoverAt(module: BuiltModule, source: SourceFile, offset: number): Hover | undefined {
	if (module.ast === undefined || module.semantic === undefined) return undefined;
	const path = findNodePathAtOffset(module.ast, source, offset);
	for (const node of [...path].reverse() as SymbolNode[]) {
		if (node.symbolId !== undefined) {
			const symbol = module.semantic.symbols.get(node.symbolId);
			if (symbol !== undefined) {
				return {
					range: sourceSpanToRange(node.span),
					contents: {
						kind: MarkupKind.Markdown,
						value: `\`\`\`virune\n${symbolLabel(symbol.kind, symbol.name, module.semantic.arena.display(symbol.typeId), symbol.mutable, symbol.constant)}\n\`\`\``,
					},
				};
			}
		}
		const typeId = node.inferredTypeId ?? node.resolvedTypeId;
		if (typeId !== undefined) {
			return {
				range: sourceSpanToRange(node.span),
				contents: {
					kind: MarkupKind.Markdown,
					value: `\`\`\`virune\n${module.semantic.arena.display(typeId)}\n\`\`\``,
				},
			};
		}
	}
	return undefined;
}

function symbolLabel(kind: string, name: string, type: string, mutable: boolean, constant: boolean): string {
	if (kind === 'function' || kind === 'extern' || kind === 'builtin') return `${name}: ${type}`;
	if (kind === 'type') return `type ${name}`;
	if (kind === 'variant') return `${name}: ${type}`;
	if (kind === 'parameter') return `${name}: ${type}`;
	return `${constant ? 'const' : 'let'}${mutable ? ' mut' : ''} ${name}: ${type}`;
}
