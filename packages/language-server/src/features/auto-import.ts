import { dirname, relative } from 'node:path';
import type { BuiltModule, SourceFile } from '@virune/compiler/experimental';
import { CompletionItemKind, TextEdit, type CompletionItem } from 'vscode-languageserver/node';
import type { AnalysisSnapshot } from '../analysis/project-manager.js';
import { offsetToPosition } from '../analysis/position.js';

export function autoImportItems(
	snapshot: AnalysisSnapshot,
	module: BuiltModule,
	source: SourceFile,
	existingNames: ReadonlySet<string>,
): readonly CompletionItem[] {
	const items: CompletionItem[] = [];
	for (const symbol of snapshot.index.symbols.values()) {
		if (symbol.external || !symbol.public || symbol.modulePath === source.path || existingNames.has(symbol.name)) continue;
		if (!isAutoImportable(symbol.kind)) continue;
		const specifier = moduleSpecifier(source.path, symbol.modulePath);
		items.push({
			label: symbol.name,
			kind: completionKind(symbol.kind),
			detail: `Auto import from ${specifier}`,
			sortText: `9_${symbol.name}`,
			filterText: symbol.name,
			insertText: symbol.kind === 'function' || symbol.kind === 'extern' ? `${symbol.name}()` : symbol.name,
			additionalTextEdits: [TextEdit.insert(importInsertionPosition(module, source), `import { ${symbol.name} } from "${specifier}"\n`)],
		});
	}
	return items.sort((left, right) => left.label.localeCompare(right.label));
}

function isAutoImportable(kind: string): boolean {
	return kind === 'function' || kind === 'extern' || kind === 'type' || kind === 'variable' || kind === 'variant';
}

function completionKind(kind: string): CompletionItemKind {
	if (kind === 'function' || kind === 'extern') return CompletionItemKind.Function;
	if (kind === 'type') return CompletionItemKind.Class;
	if (kind === 'variant') return CompletionItemKind.EnumMember;
	return CompletionItemKind.Variable;
}

function moduleSpecifier(fromPath: string, toPath: string): string {
	const value = relative(dirname(fromPath), toPath).replaceAll('\\', '/');
	return value.startsWith('.') ? value : `./${value}`;
}

function importInsertionPosition(module: BuiltModule, source: SourceFile) {
	const lastImport = module.ast?.imports.at(-1);
	if (lastImport !== undefined) {
		const line = Math.max(0, lastImport.span.end.line);
		let offset = 0;
		for (let index = 0; index < line; index++) {
			const next = source.text.indexOf('\n', offset);
			if (next < 0) return offsetToPosition(source, source.text.length);
			offset = next + 1;
		}
		return offsetToPosition(source, offset);
	}
	const moduleDocumentation = module.ast?.documentation;
	if (moduleDocumentation !== undefined) {
		const line = Math.max(0, moduleDocumentation.span.end.line);
		let offset = 0;
		for (let index = 0; index < line; index++) {
			const next = source.text.indexOf('\n', offset);
			if (next < 0) return offsetToPosition(source, source.text.length);
			offset = next + 1;
		}
		return offsetToPosition(source, offset);
	}
	return { line: 0, character: 0 };
}
