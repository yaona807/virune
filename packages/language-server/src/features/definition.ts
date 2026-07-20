import type { AstNode, BuiltModule, SourceFile, SymbolId } from '@virune/compiler/experimental';
import type { AnalysisSnapshot } from '../analysis/project-manager.js';
import { findNodePathAtOffset } from '../analysis/ast.js';
import { filePathToUri, nameRange } from '../analysis/position.js';
import type { Location } from 'vscode-languageserver/node';

interface SymbolNode extends AstNode { readonly symbolId?: SymbolId; readonly name?: string; }

export function definitionAt(snapshot: AnalysisSnapshot, module: BuiltModule, source: SourceFile, offset: number): Location | undefined {
	if (module.ast === undefined || module.semantic === undefined) return undefined;
	const path = findNodePathAtOffset(module.ast, source, offset);
	for (const node of [...path].reverse() as SymbolNode[]) {
		const symbol = node.symbolId === undefined
			? (node.kind === 'TypeReference' && node.name !== undefined ? module.semantic.globalScope.lookup(node.name) : undefined)
			: module.semantic.symbols.get(node.symbolId);
		if (symbol === undefined || symbol.kind === 'builtin') continue;
		const definitionSource = snapshot.sourcesById.get(symbol.span.fileId);
		if (definitionSource === undefined) continue;
		return {
			uri: filePathToUri(definitionSource.path),
			range: nameRange(definitionSource, symbol.span, symbol.name),
		};
	}
	return undefined;
}
