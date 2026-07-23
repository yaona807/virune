import type { AnalysisSnapshot } from '../analysis/project-manager.js';
import type { IndexedSymbol, SymbolOccurrence } from '../analysis/semantic-index.js';
import {
	DocumentHighlightKind,
	SymbolKind,
	TextEdit,
	WorkspaceEdit,
	type CallHierarchyIncomingCall,
	type CallHierarchyItem,
	type CallHierarchyOutgoingCall,
	type DocumentHighlight,
	type Location,
	type LocationLink,
	type Position,
	type PrepareRenameResult,
	type Range,
} from 'vscode-languageserver/node';
import { basename } from 'node:path';

export function definitionAt(snapshot: AnalysisSnapshot, uri: string, position: Position): LocationLink | undefined {
	const hit = snapshot.index.symbolAt(uri, position);
	if (hit === undefined) return undefined;
	return symbolLocationLink(hit.symbol, hit.occurrence.range);
}

export function declarationAt(snapshot: AnalysisSnapshot, uri: string, position: Position): LocationLink | undefined {
	const hit = snapshot.index.symbolAt(uri, position);
	if (hit === undefined) return undefined;
	const localOccurrences = snapshot.index.references(hit.symbol.key, true).filter(occurrence => occurrence.uri === uri);
	const localDeclaration = localOccurrences.find(occurrence => occurrence.role === 'declaration' && occurrence.name === hit.occurrence.name)
		?? localOccurrences.find(occurrence => occurrence.name === hit.occurrence.name
			&& (occurrence.role === 'import' || occurrence.role === 'declaration' || occurrence.role === 'export'))
		?? localOccurrences.find(occurrence => occurrence.role === 'import' || occurrence.role === 'declaration' || occurrence.role === 'export');
	if (localDeclaration === undefined) return symbolLocationLink(hit.symbol, hit.occurrence.range);
	return {
		originSelectionRange: hit.occurrence.range,
		targetUri: localDeclaration.uri,
		targetRange: localDeclaration.range,
		targetSelectionRange: localDeclaration.range,
	};
}

export function typeDefinitionAt(snapshot: AnalysisSnapshot, uri: string, position: Position): LocationLink | undefined {
	const hit = snapshot.index.symbolAt(uri, position);
	if (hit === undefined) return undefined;
	const target = snapshot.index.typeDefinitionFor(hit.symbol) ?? (hit.symbol.kind === 'type' ? hit.symbol : undefined);
	return target === undefined ? undefined : symbolLocationLink(target, hit.occurrence.range);
}

export function referencesAt(
	snapshot: AnalysisSnapshot,
	uri: string,
	position: Position,
	includeDeclaration: boolean,
): readonly Location[] {
	const hit = snapshot.index.symbolAt(uri, position);
	return hit === undefined ? [] : snapshot.index.locations(hit.symbol.key, includeDeclaration);
}

export function documentHighlightsAt(snapshot: AnalysisSnapshot, uri: string, position: Position): readonly DocumentHighlight[] {
	const hit = snapshot.index.symbolAt(uri, position);
	if (hit === undefined) return [];
	return snapshot.index.references(hit.symbol.key, true)
		.filter(occurrence => occurrence.uri === uri)
		.map(occurrence => ({ range: occurrence.range, kind: highlightKind(occurrence.role) }));
}

export function prepareRenameAt(snapshot: AnalysisSnapshot, uri: string, position: Position): PrepareRenameResult | undefined {
	const hit = snapshot.index.symbolAt(uri, position);
	if (hit === undefined || hit.symbol.external || hit.symbol.kind === 'builtin') return undefined;
	return { range: hit.occurrence.range, placeholder: hit.occurrence.name };
}

export function renameAt(snapshot: AnalysisSnapshot, uri: string, position: Position, newName: string): WorkspaceEdit | undefined {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(newName)) return undefined;
	const hit = snapshot.index.symbolAt(uri, position);
	if (hit === undefined || hit.symbol.external || hit.symbol.kind === 'builtin') return undefined;
	if (hit.symbol.kind === 'field') {
		const collision = [...snapshot.index.symbols.values()].some(symbol => symbol.kind === 'field'
			&& symbol.containerKey === hit.symbol.containerKey
			&& symbol.name === newName
			&& symbol.key !== hit.symbol.key);
		if (collision) return undefined;
	} else if (hit.symbol.kind === 'variable' || hit.symbol.kind === 'parameter') {
		if (hasLocalCollision(snapshot, hit.symbol.key, newName)) return undefined;
	} else {
		const existing = snapshot.index.moduleForUri(uri)?.semantic?.globalScope.lookup(newName);
		if (existing !== undefined && newName !== hit.occurrence.name) return undefined;
	}
	const aliasRename = hit.occurrence.name !== hit.symbol.name;
	const changes: Record<string, TextEdit[]> = {};
	for (const occurrence of snapshot.index.references(hit.symbol.key, true)) {
		if (aliasRename) {
			if (occurrence.uri !== uri || occurrence.name !== hit.occurrence.name) continue;
		} else if (occurrence.name !== hit.symbol.name) continue;
		const replacement = hit.symbol.kind === 'field' && occurrence.shorthand ? `${newName}: ${occurrence.name}` : newName;
		(changes[occurrence.uri] ??= []).push(TextEdit.replace(occurrence.range, replacement));
	}
	return Object.keys(changes).length === 0 ? undefined : { changes };
}

function hasLocalCollision(snapshot: AnalysisSnapshot, symbolKey: string, newName: string): boolean {
	const owner = snapshot.index.references(symbolKey, true)
		.find(occurrence => occurrence.role === 'declaration' || occurrence.role === 'definition')?.containerKey;
	if (owner === undefined) return false;
	for (const symbol of snapshot.index.symbols.values()) {
		if (symbol.key === symbolKey || symbol.name !== newName) continue;
		const candidateOwner = snapshot.index.references(symbol.key, true)
			.find(occurrence => occurrence.role === 'declaration' || occurrence.role === 'definition')?.containerKey;
		if (candidateOwner === owner) return true;
	}
	return false;
}

export function prepareCallHierarchyAt(snapshot: AnalysisSnapshot, uri: string, position: Position): readonly CallHierarchyItem[] {
	const hit = snapshot.index.symbolAt(uri, position);
	if (hit === undefined || !isCallable(hit.symbol)) return [];
	return [callHierarchyItem(hit.symbol)];
}

export function incomingCalls(snapshot: AnalysisSnapshot, item: CallHierarchyItem): readonly CallHierarchyIncomingCall[] {
	const key = hierarchyKey(item);
	if (key === undefined) return [];
	const grouped = new Map<string, SymbolOccurrence[]>();
	for (const call of snapshot.index.callsTo(key)) {
		if (call.containerKey === undefined) continue;
		const values = grouped.get(call.containerKey) ?? [];
		values.push(call);
		grouped.set(call.containerKey, values);
	}
	const result: CallHierarchyIncomingCall[] = [];
	for (const [containerKey, calls] of grouped) {
		const caller = snapshot.index.symbols.get(containerKey);
		if (caller === undefined) continue;
		result.push({ from: callHierarchyItem(caller), fromRanges: calls.map(call => call.range) });
	}
	return result.sort((left, right) => left.from.name.localeCompare(right.from.name));
}

export function outgoingCalls(snapshot: AnalysisSnapshot, item: CallHierarchyItem): readonly CallHierarchyOutgoingCall[] {
	const key = hierarchyKey(item);
	if (key === undefined) return [];
	const grouped = new Map<string, SymbolOccurrence[]>();
	for (const call of snapshot.index.callsFrom(key)) {
		const values = grouped.get(call.symbolKey) ?? [];
		values.push(call);
		grouped.set(call.symbolKey, values);
	}
	const result: CallHierarchyOutgoingCall[] = [];
	for (const [calleeKey, calls] of grouped) {
		const callee = snapshot.index.symbols.get(calleeKey);
		if (callee === undefined || !isCallable(callee)) continue;
		result.push({ to: callHierarchyItem(callee), fromRanges: calls.map(call => call.range) });
	}
	return result.sort((left, right) => left.to.name.localeCompare(right.to.name));
}

function symbolLocationLink(symbol: IndexedSymbol, originSelectionRange: Range): LocationLink {
	return {
		originSelectionRange,
		targetUri: symbol.uri,
		targetRange: symbol.range,
		targetSelectionRange: symbol.selectionRange,
	};
}

function highlightKind(role: SymbolOccurrence['role']): DocumentHighlightKind {
	return role === 'write' || role === 'definition' || role === 'declaration'
		? DocumentHighlightKind.Write
		: DocumentHighlightKind.Read;
}

function isCallable(symbol: IndexedSymbol): boolean {
	return symbol.kind === 'function' || symbol.kind === 'extern' || symbol.kind === 'import';
}

function callHierarchyItem(symbol: IndexedSymbol): CallHierarchyItem {
	return {
		name: symbol.name,
		kind: symbol.kind === 'extern' ? SymbolKind.Method : SymbolKind.Function,
		uri: symbol.uri,
		range: symbol.range,
		selectionRange: symbol.selectionRange,
		detail: basename(symbol.modulePath),
		data: { symbolKey: symbol.key },
	};
}

function hierarchyKey(item: CallHierarchyItem): string | undefined {
	if (item.data === null || typeof item.data !== 'object') return undefined;
	const value = item.data as { readonly symbolKey?: unknown };
	return typeof value.symbolKey === 'string' ? value.symbolKey : undefined;
}
