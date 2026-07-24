import { dirname, relative, resolve } from 'node:path';
import type { BuiltModule, SourceFile } from '@virune/compiler/experimental';
import { CompletionItemKind, TextEdit, type CompletionItem } from 'vscode-languageserver/node';
import { offsetToPosition } from '../analysis/position.js';

export type WorkspaceExportKind = 'function' | 'extern' | 'type' | 'variable' | 'variant';

export interface WorkspaceExport {
	readonly name: string;
	readonly kind: WorkspaceExportKind;
	readonly modulePath: string;
}

export function collectWorkspaceExports(modulesByPath: ReadonlyMap<string, BuiltModule>): readonly WorkspaceExport[] {
	const items: WorkspaceExport[] = [];
	const seen = new Set<string>();
	for (const module of modulesByPath.values()) {
		if (module.semantic === undefined) continue;
		const modulePath = resolve(module.source.path);
		for (const symbol of module.semantic.symbols.values()) {
			if (!symbol.public || symbol.span.fileId !== module.source.id || !isAutoImportable(symbol.kind)) continue;
			const key = `${modulePath}\0${symbol.kind}\0${symbol.name}`;
			if (seen.has(key)) continue;
			seen.add(key);
			items.push({ name: symbol.name, kind: symbol.kind, modulePath });
		}
	}
	return items.sort((left, right) => left.name.localeCompare(right.name)
		|| left.modulePath.localeCompare(right.modulePath)
		|| left.kind.localeCompare(right.kind));
}

export function autoImportItems(
	workspaceExports: readonly WorkspaceExport[],
	module: BuiltModule,
	source: SourceFile,
	existingNames: ReadonlySet<string>,
): readonly CompletionItem[] {
	const items: CompletionItem[] = [];
	for (const symbol of workspaceExports) {
		if (symbol.modulePath === source.path || existingNames.has(symbol.name)) continue;
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

function isAutoImportable(kind: string): kind is WorkspaceExportKind {
	return kind === 'function' || kind === 'extern' || kind === 'type' || kind === 'variable' || kind === 'variant';
}

function completionKind(kind: WorkspaceExportKind): CompletionItemKind {
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
