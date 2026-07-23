import { basename, relative } from 'node:path';
import type { AnalysisSnapshot } from '../analysis/project-manager.js';
import { languageServerSymbolKind } from '../analysis/semantic-index.js';
import type { WorkspaceSymbol } from 'vscode-languageserver/node';

export function workspaceSymbols(snapshots: readonly AnalysisSnapshot[], query: string): readonly WorkspaceSymbol[] {
	const normalized = query.trim().toLocaleLowerCase();
	const values = new Map<string, WorkspaceSymbol>();
	for (const snapshot of snapshots) {
		for (const symbol of snapshot.index.symbols.values()) {
			if (symbol.external || !isWorkspaceVisible(symbol.kind, symbol.public)) continue;
			if (normalized.length > 0 && !fuzzyMatch(symbol.name.toLocaleLowerCase(), normalized)) continue;
			values.set(symbol.key, {
				name: symbol.name,
				kind: languageServerSymbolKind(symbol.kind),
				location: { uri: symbol.uri, range: symbol.selectionRange },
				containerName: relative(snapshot.root, symbol.modulePath).replaceAll('\\', '/') || basename(symbol.modulePath),
			});
		}
	}
	return [...values.values()]
		.sort((left, right) => score(right.name, normalized) - score(left.name, normalized) || left.name.localeCompare(right.name))
		.slice(0, 200);
}

function isWorkspaceVisible(kind: string, isPublic: boolean): boolean {
	if (kind === 'field') return false;
	return isPublic || kind === 'function' || kind === 'type' || kind === 'extern';
}

function fuzzyMatch(value: string, query: string): boolean {
	if (value.includes(query)) return true;
	let index = 0;
	for (const character of value) if (character === query[index]) index++;
	return index === query.length;
}

function score(value: string, query: string): number {
	if (query.length === 0) return 0;
	const normalized = value.toLocaleLowerCase();
	if (normalized === query) return 1000;
	if (normalized.startsWith(query)) return 700 - normalized.length;
	const index = normalized.indexOf(query);
	if (index >= 0) return 500 - index;
	return 100 - normalized.length;
}
