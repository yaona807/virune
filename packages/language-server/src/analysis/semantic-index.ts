import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
	lex,
	type AstNode,
	type BuiltModule,
	type SemanticModel,
	type SourceFile,
	type SourceSpan,
	type SymbolId,
	type Type,
	type TypeId,
} from '@virune/compiler/experimental';
import { SymbolKind, type Location, type Position, type Range } from 'vscode-languageserver/node';
import { filePathToUri, nameRange, offsetToPosition, positionToOffset, sourceSpanToRange } from './position.js';

type CompilerSymbol = SemanticModel['symbols'] extends ReadonlyMap<number, infer Value> ? Value : never;
export type IndexedSymbolKind = CompilerSymbol['kind'] | 'field';

export type OccurrenceRole =
	| 'declaration'
	| 'definition'
	| 'read'
	| 'write'
	| 'call'
	| 'type'
	| 'import'
	| 'export';

export interface IndexedSymbol {
	readonly key: string;
	readonly name: string;
	readonly kind: IndexedSymbolKind;
	readonly uri: string;
	readonly range: Range;
	readonly selectionRange: Range;
	readonly modulePath: string;
	readonly public: boolean;
	readonly typeId?: TypeId;
	readonly typeDefinitionKey?: string;
	readonly external: boolean;
	readonly containerKey?: string;
}

export interface SymbolOccurrence {
	readonly symbolKey: string;
	readonly uri: string;
	readonly range: Range;
	readonly role: OccurrenceRole;
	readonly name: string;
	readonly containerKey?: string;
	readonly shorthand?: boolean;
}

export interface SemanticIndexInput {
	readonly root: string;
	readonly modulesByPath: ReadonlyMap<string, BuiltModule>;
	readonly sourcesById: ReadonlyMap<number, SourceFile>;
}

interface SymbolAtResult {
	readonly symbol: IndexedSymbol;
	readonly occurrence: SymbolOccurrence;
}

export class ProjectSemanticIndex {
	readonly symbols = new Map<string, IndexedSymbol>();
	readonly occurrences: readonly SymbolOccurrence[];
	readonly #occurrencesByUri = new Map<string, readonly SymbolOccurrence[]>();
	readonly #occurrencesBySymbol = new Map<string, readonly SymbolOccurrence[]>();
	readonly #moduleByUri = new Map<string, BuiltModule>();
	readonly #definitionIds = new Map<string, string>();

	public constructor(
		symbols: ReadonlyMap<string, IndexedSymbol>,
		occurrences: readonly SymbolOccurrence[],
		modulesByPath: ReadonlyMap<string, BuiltModule>,
		definitionIds: ReadonlyMap<string, string>,
	) {
		for (const [key, symbol] of symbols) this.symbols.set(key, symbol);
		this.occurrences = occurrences;
		this.#definitionIds = new Map(definitionIds);
		for (const module of modulesByPath.values()) this.#moduleByUri.set(filePathToUri(module.source.path), module);
		this.#occurrencesByUri = groupBy(occurrences, occurrence => occurrence.uri);
		this.#occurrencesBySymbol = groupBy(occurrences, occurrence => occurrence.symbolKey);
	}

	public symbolAt(uri: string, position: Position): SymbolAtResult | undefined {
		const module = this.#moduleByUri.get(uri);
		const source = module?.source;
		if (source === undefined) return undefined;
		const offset = positionToOffset(source, position);
		const occurrence = [...(this.#occurrencesByUri.get(uri) ?? [])]
			.filter(candidate => rangeContainsOffset(source, candidate.range, offset))
			.sort((left, right) => rangeLength(source, left.range) - rangeLength(source, right.range))[0];
		if (occurrence === undefined) return undefined;
		const symbol = this.symbols.get(occurrence.symbolKey);
		return symbol === undefined ? undefined : { symbol, occurrence };
	}

	public references(symbolKey: string, includeDeclaration = true): readonly SymbolOccurrence[] {
		return (this.#occurrencesBySymbol.get(symbolKey) ?? [])
			.filter(occurrence => includeDeclaration || (occurrence.role !== 'declaration' && occurrence.role !== 'definition'))
			.filter(uniqueOccurrenceFilter);
	}

	public locations(symbolKey: string, includeDeclaration = true): readonly Location[] {
		return this.references(symbolKey, includeDeclaration).map(occurrence => ({ uri: occurrence.uri, range: occurrence.range }));
	}

	public callsTo(symbolKey: string): readonly SymbolOccurrence[] {
		return this.references(symbolKey, false).filter(occurrence => occurrence.role === 'call');
	}

	public callsFrom(containerKey: string): readonly SymbolOccurrence[] {
		return this.occurrences.filter(occurrence => occurrence.containerKey === containerKey && occurrence.role === 'call');
	}

	public moduleForUri(uri: string): BuiltModule | undefined {
		return this.#moduleByUri.get(uri);
	}

	public typeDefinitionFor(symbol: IndexedSymbol): IndexedSymbol | undefined {
		return symbol.typeDefinitionKey === undefined ? undefined : this.symbols.get(symbol.typeDefinitionKey);
	}

	public symbolForDefinitionId(definitionId: string): IndexedSymbol | undefined {
		const key = this.#definitionIds.get(definitionId);
		return key === undefined ? undefined : this.symbols.get(key);
	}
}

export async function createProjectSemanticIndex(input: SemanticIndexInput): Promise<ProjectSemanticIndex> {
	const symbols = new Map<string, IndexedSymbol>();
	const occurrences: SymbolOccurrence[] = [];
	const symbolKeysByModule = new Map<BuiltModule, Map<SymbolId, string>>();
	const definitionIds = new Map<string, string>();
	const externalLocations = new Map<string, IndexedSymbol>();
	const memberKeys = new Map<string, string>();
	const symbolTypes = new Map<string, { readonly semantic: SemanticModel; readonly typeId: TypeId }>();
	const declarationTexts = new Map<string, Promise<string | undefined>>();

	for (const module of input.modulesByPath.values()) {
		if (module.semantic === undefined) continue;
		const keys = new Map<SymbolId, string>();
		for (const symbol of module.semantic.symbols.values()) {
			if (symbol.kind === 'builtin') continue;
			const external = await externalSymbol(module, symbol, declarationTexts);
			if (external !== undefined) {
				symbols.set(external.key, external);
				externalLocations.set(external.key, external);
				keys.set(symbol.id, external.key);
				continue;
			}
			const definitionSource = input.sourcesById.get(symbol.span.fileId);
			if (definitionSource === undefined) continue;
			const original = originalSymbol(input.modulesByPath, definitionSource.path, symbol);
			const name = original?.name ?? symbol.name;
			const kind = original?.kind ?? symbol.kind;
			const key = canonicalSymbolKey(definitionSource.path, kind, symbol.span, name, symbol);
			keys.set(symbol.id, key);
			if (!symbolTypes.has(key) || symbol.span.fileId === module.source.id) symbolTypes.set(key, { semantic: module.semantic, typeId: symbol.typeId });
			if (!symbols.has(key)) {
				const range = safeNameRange(definitionSource, symbol.span, name);
				symbols.set(key, {
					key,
					name,
					kind,
					uri: filePathToUri(definitionSource.path),
					range,
					selectionRange: range,
					modulePath: resolve(definitionSource.path),
					public: original?.public ?? symbol.public,
					typeId: symbol.typeId,
					external: false,
				});
			}
			const type = module.semantic.arena.get(symbol.typeId);
			if (symbol.kind === 'type' && type.kind === 'named') definitionIds.set(type.definitionId, key);
		}
		indexDeclaredMembers(module, keys, symbols, occurrences, memberKeys, symbolTypes);
		symbolKeysByModule.set(module, keys);
	}

	for (const module of input.modulesByPath.values()) {
		if (module.ast === undefined || module.semantic === undefined) continue;
		const keys = symbolKeysByModule.get(module) ?? new Map();
		indexImports(module, keys, occurrences);
		walkSemanticAst(module, keys, definitionIds, memberKeys, occurrences);
	}

	for (const [key, symbol] of symbols) {
		if (symbol.external) continue;
		const typeInfo = symbolTypes.get(key);
		if (typeInfo === undefined) continue;
		const typeDefinitionKey = namedTypeDefinitionKey(typeInfo.semantic.arena.get(typeInfo.typeId), typeInfo.semantic, definitionIds);
		if (typeDefinitionKey !== undefined && typeDefinitionKey !== key) symbols.set(key, { ...symbol, typeDefinitionKey });
		else if (symbol.kind === 'type') symbols.set(key, { ...symbol, typeDefinitionKey: key });
	}

	for (const external of externalLocations.values()) {
		if (!occurrences.some(occurrence => occurrence.symbolKey === external.key && occurrence.role === 'definition')) {
			occurrences.push({ symbolKey: external.key, uri: external.uri, range: external.selectionRange, role: 'definition', name: external.name });
		}
	}

	return new ProjectSemanticIndex(symbols, occurrences, input.modulesByPath, definitionIds);
}

function indexDeclaredMembers(
	module: BuiltModule,
	keys: ReadonlyMap<SymbolId, string>,
	symbols: Map<string, IndexedSymbol>,
	occurrences: SymbolOccurrence[],
	memberKeys: Map<string, string>,
	symbolTypes: Map<string, { readonly semantic: SemanticModel; readonly typeId: TypeId }>,
): void {
	if (module.ast === undefined || module.semantic === undefined) return;
	const uri = filePathToUri(module.source.path);
	for (const declaration of module.ast.declarations) {
		if (declaration.kind !== 'RecordDeclaration' && declaration.kind !== 'EnumDeclaration') continue;
		const ownerKey = declaration.symbolId === undefined ? undefined : keys.get(declaration.symbolId);
		const definitionId = declarationDefinitionId(module.semantic, declaration.symbolId);
		if (ownerKey === undefined || definitionId === undefined) continue;
		if (declaration.kind === 'RecordDeclaration') {
			for (const field of declaration.fields) {
				const key = `virune:${resolve(module.source.path)}:field:${field.span.start.offset}:${field.span.end.offset}:${declaration.name}.${field.name}`;
				const range = safeNameRange(module.source, field.span, field.name);
				const typeId = field.type.resolvedTypeId;
				symbols.set(key, {
					key,
					name: field.name,
					kind: 'field',
					uri,
					range,
					selectionRange: range,
					modulePath: resolve(module.source.path),
					public: declaration.public,
					...(typeId === undefined ? {} : { typeId }),
					external: false,
					containerKey: ownerKey,
				});
				memberKeys.set(memberLookupKey(definitionId, field.name), key);
				occurrences.push({ symbolKey: key, uri, range, role: 'definition', name: field.name, containerKey: ownerKey });
				if (typeId !== undefined) symbolTypes.set(key, { semantic: module.semantic, typeId });
			}
			continue;
		}
		for (const variant of declaration.variants) {
			const key = variant.symbolId === undefined ? undefined : keys.get(variant.symbolId);
			if (key === undefined) continue;
			memberKeys.set(memberLookupKey(definitionId, variant.name), key);
			const existing = symbols.get(key);
			const range = enumVariantRange(module.source, declaration.name, declaration.span, variant.name);
			if (existing !== undefined) symbols.set(key, { ...existing, range, selectionRange: range, containerKey: ownerKey });
			occurrences.push({ symbolKey: key, uri, range, role: 'definition', name: variant.name, containerKey: ownerKey });
		}
	}
}

function declarationDefinitionId(semantic: SemanticModel, symbolId: SymbolId | undefined): string | undefined {
	const symbol = symbolId === undefined ? undefined : semantic.symbols.get(symbolId);
	if (symbol === undefined) return undefined;
	const type = semantic.arena.get(symbol.typeId);
	return type.kind === 'named' ? type.definitionId : undefined;
}

function memberLookupKey(definitionId: string, name: string): string {
	return `${definitionId}\0${name}`;
}

function canonicalSymbolKey(
	path: string,
	kind: IndexedSymbolKind,
	span: SourceSpan,
	name: string,
	symbol: CompilerSymbol,
): string {
	if (kind === 'variant') {
		const declaration = symbol.declaration as { readonly kind?: string; readonly name?: string } | undefined;
		if (declaration?.kind === 'EnumDeclaration' && declaration.name !== undefined) {
			return `virune:${resolve(path)}:variant:${declaration.name}.${name}`;
		}
	}
	return symbolKey(path, kind, span, name);
}

export function enumVariantRange(source: SourceFile, enumName: string, declarationSpan: SourceSpan, variantName: string): Range {
	const tokens = lex(source.text).tokens;
	const enumNameIndex = tokens
		.map((token, index) => ({ token, index }))
		.filter(item => item.token.image === enumName)
		.sort((left, right) => Math.abs(left.token.startOffset - declarationSpan.start.offset)
			- Math.abs(right.token.startOffset - declarationSpan.start.offset))[0]?.index;
	if (enumNameIndex === undefined) return safeNameRange(source, declarationSpan, variantName);
	const openIndex = tokens.findIndex((token, index) => index > enumNameIndex && token.tokenType.name === 'LBrace');
	if (openIndex < 0) return safeNameRange(source, declarationSpan, variantName);
	let depth = 0;
	for (let index = openIndex; index < tokens.length; index++) {
		const token = tokens[index]!;
		if (token.tokenType.name === 'LBrace') { depth++; continue; }
		if (token.tokenType.name === 'RBrace') {
			depth--;
			if (depth === 0) break;
			continue;
		}
		if (depth !== 1 || token.image !== variantName) continue;
		const endOffset = (token.endOffset ?? token.startOffset) + 1;
		return { start: offsetToPosition(source, token.startOffset), end: offsetToPosition(source, endOffset) };
	}
	return safeNameRange(source, declarationSpan, variantName);
}

function originalSymbol(
	modulesByPath: ReadonlyMap<string, BuiltModule>,
	path: string,
	symbol: CompilerSymbol,
): CompilerSymbol | undefined {
	const module = modulesByPath.get(resolve(path));
	return [...(module?.semantic?.symbols.values() ?? [])]
		.find(candidate => candidate.kind === symbol.kind
			&& sameSpan(candidate.span, symbol.span)
			&& (symbol.kind !== 'variant' || candidate.name === symbol.name));
}

async function externalSymbol(
	module: BuiltModule,
	symbol: CompilerSymbol,
	declarationTexts: Map<string, Promise<string | undefined>>,
): Promise<IndexedSymbol | undefined> {
	if (module.semantic === undefined) return undefined;
	const type = module.semantic.arena.get(symbol.typeId);
	if (type.kind !== 'foreign') return undefined;
	const origin = type.snapshot.origin;
	if (origin?.declarationPath === undefined) return undefined;
	const path = resolve(origin.declarationPath);
	const pendingText = declarationTexts.get(path) ?? readDeclarationText(path);
	declarationTexts.set(path, pendingText);
	const text = await pendingText;
	if (text === undefined) return undefined;
	const exportName = origin.exportName === undefined || origin.exportName === '*' ? symbol.name : origin.exportName;
	const range = declarationNameRange(text, exportName);
	const name = exportName === 'default' ? symbol.name : exportName;
	const key = `javascript:${path}:${name}`;
	return {
		key,
		name,
		kind: symbol.kind,
		uri: filePathToUri(path),
		range,
		selectionRange: range,
		modulePath: path,
		public: true,
		typeId: symbol.typeId,
		external: true,
	};
}

async function readDeclarationText(path: string): Promise<string | undefined> {
	try { return await readFile(path, 'utf8'); }
	catch { return undefined; }
}

function declarationNameRange(text: string, name: string): Range {
	const escaped = escapeRegExp(name);
	const patterns = name === 'default'
		? [/\bexport\s+default\s+(?:async\s+)?(?:function|class)?\s*([A-Za-z_$][\w$]*)?/gu]
		: [
			new RegExp(`\\b(?:export\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:function|class|interface|type|const|let|var|enum|namespace)\\s+(${escaped})\\b`, 'gu'),
			new RegExp(`\\b(${escaped})\\b`, 'gu'),
		];
	for (const pattern of patterns) {
		const match = pattern.exec(text);
		if (match === null) continue;
		const matchedName = match[1] ?? name;
		const index = match.index + match[0].lastIndexOf(matchedName);
		return { start: offsetToPosition({ id: 0, path: '', text }, index), end: offsetToPosition({ id: 0, path: '', text }, index + matchedName.length) };
	}
	return { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
}

function indexImports(module: BuiltModule, keys: ReadonlyMap<SymbolId, string>, occurrences: SymbolOccurrence[]): void {
	if (module.ast === undefined || module.semantic === undefined) return;
	const uri = filePathToUri(module.source.path);
	for (const declaration of module.ast.imports) {
		for (const item of declaration.items) {
			const symbol = module.semantic.globalScope.lookup(item.local);
			const key = symbol === undefined ? undefined : keys.get(symbol.id);
			if (key === undefined) continue;
			occurrences.push({
				symbolKey: key,
				uri,
				range: safeNameRange(module.source, item.span, item.imported),
				role: declaration.public ? 'export' : 'import',
				name: item.imported,
			});
			if (item.local !== item.imported) {
				occurrences.push({
					symbolKey: key,
					uri,
					range: safeNameRange(module.source, item.span, item.local),
					role: 'declaration',
					name: item.local,
				});
			}
		}
		for (const local of [declaration.defaultImport, declaration.namespaceImport]) {
			if (local === undefined) continue;
			const symbol = module.semantic.globalScope.lookup(local);
			const key = symbol === undefined ? undefined : keys.get(symbol.id);
			if (key === undefined) continue;
			occurrences.push({ symbolKey: key, uri, range: safeNameRange(module.source, declaration.span, local), role: 'import', name: local });
		}
	}
}

function walkSemanticAst(
	module: BuiltModule,
	keys: ReadonlyMap<SymbolId, string>,
	definitionIds: ReadonlyMap<string, string>,
	memberKeys: ReadonlyMap<string, string>,
	occurrences: SymbolOccurrence[],
): void {
	if (module.ast === undefined || module.semantic === undefined) return;
	const uri = filePathToUri(module.source.path);
	const semantic = module.semantic;

	const visit = (value: unknown, parent: Record<string, unknown> | undefined, containerKey: string | undefined): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item, parent, containerKey);
			return;
		}
		if (!isObject(value) || isSourceSpan(value)) return;
		const kind = typeof value.kind === 'string' ? value.kind : undefined;
		let nextContainer = containerKey;

		const symbolId = typeof value.symbolId === 'number' ? value.symbolId : undefined;
		const symbol = symbolId === undefined ? undefined : semantic.symbols.get(symbolId);
		const key = symbolId === undefined ? undefined : keys.get(symbolId);
		if (symbol !== undefined && key !== undefined && isSourceSpan(value.span) && typeof value.name === 'string') {
			if (parent?.kind !== 'EnumDeclaration') {
				const role = occurrenceRole(value, parent);
				occurrences.push({
					symbolKey: key,
					uri,
					range: safeNameRange(module.source, value.span, value.name),
					role,
					name: value.name,
					...(containerKey === undefined ? {} : { containerKey }),
				});
			}
			if (kind === 'FunctionDeclaration' || kind === 'LambdaExpression') nextContainer = key;
		}

		if (kind === 'AssignmentStatement' && typeof value.targetSymbolId === 'number' && typeof value.name === 'string' && isSourceSpan(value.span)) {
			const targetKey = keys.get(value.targetSymbolId);
			if (targetKey !== undefined) occurrences.push({
				symbolKey: targetKey,
				uri,
				range: safeNameRange(module.source, value.span, value.name),
				role: 'write',
				name: value.name,
				...(containerKey === undefined ? {} : { containerKey }),
			});
		}

		if (kind === 'TypeReference' && typeof value.name === 'string' && isSourceSpan(value.span)) {
			const referenced = semantic.globalScope.lookup(value.name);
			const targetKey = referenced === undefined ? typeReferenceKey(value, semantic, definitionIds) : keys.get(referenced.id);
			if (targetKey !== undefined) occurrences.push({
				symbolKey: targetKey,
				uri,
				range: safeNameRange(module.source, value.span, value.name),
				role: 'type',
				name: value.name,
				...(containerKey === undefined ? {} : { containerKey }),
			});
		}

		indexMemberOccurrences(value, parent, module, semantic, keys, memberKeys, occurrences, containerKey);

		for (const [property, child] of Object.entries(value)) {
			if (['span', 'documentation', 'symbolId', 'targetSymbolId', 'inferredTypeId', 'resolvedTypeId'].includes(property)) continue;
			visit(child, value, nextContainer);
		}
	};
	visit(module.ast, undefined, undefined);
}

function indexMemberOccurrences(
	value: Record<string, unknown>,
	parent: Record<string, unknown> | undefined,
	module: BuiltModule,
	semantic: SemanticModel,
	keys: ReadonlyMap<SymbolId, string>,
	memberKeys: ReadonlyMap<string, string>,
	occurrences: SymbolOccurrence[],
	containerKey: string | undefined,
): void {
	const kind = value.kind;
	if (kind === 'FieldExpression' && typeof value.field === 'string' && isSourceSpan(value.span)) {
		const definitionId = fieldOwnerDefinitionId(value.target, semantic);
		const key = definitionId === undefined ? undefined : memberKeys.get(memberLookupKey(definitionId, value.field));
		if (key !== undefined) occurrences.push({
			symbolKey: key,
			uri: filePathToUri(module.source.path),
			range: safeNameRange(module.source, value.span, value.field),
			role: parent?.kind === 'CallExpression' && parent.callee === value ? 'call' : 'read',
			name: value.field,
			...(containerKey === undefined ? {} : { containerKey }),
		});
		return;
	}
	if (kind === 'RecordExpression') {
		indexRecordEntries(value, fieldOwnerDefinitionId(value, semantic), module, memberKeys, occurrences, containerKey);
		return;
	}
	if (kind === 'RecordPattern' && typeof value.symbolId === 'number') {
		indexRecordEntries(value, definitionIdForSymbol(semantic, value.symbolId), module, memberKeys, occurrences, containerKey);
		return;
	}
	if (kind === 'RecordUpdateExpression') {
		const definitionId = fieldOwnerDefinitionId(value.base, semantic);
		indexRecordEntries(value, definitionId, module, memberKeys, occurrences, containerKey);
	}
}

function indexRecordEntries(
	value: Record<string, unknown>,
	definitionId: string | undefined,
	module: BuiltModule,
	memberKeys: ReadonlyMap<string, string>,
	occurrences: SymbolOccurrence[],
	containerKey: string | undefined,
): void {
	if (definitionId === undefined) return;
	const entries = Array.isArray(value.entries) ? value.entries : Array.isArray(value.fields) ? value.fields : [];
	for (const entry of entries) {
		if (!isObject(entry) || typeof entry.name !== 'string') continue;
		const span = recordEntrySpan(entry);
		if (span === undefined) continue;
		const key = memberKeys.get(memberLookupKey(definitionId, entry.name));
		if (key === undefined) continue;
		const range = safeNameRange(module.source, span, entry.name);
		occurrences.push({
			symbolKey: key,
			uri: filePathToUri(module.source.path),
			range,
			role: 'read',
			name: entry.name,
			...(containerKey === undefined ? {} : { containerKey }),
			...(isShorthandMember(module.source, range) ? { shorthand: true } : {}),
		});
	}
}

function recordEntrySpan(entry: Record<string, unknown>): SourceSpan | undefined {
	if (isSourceSpan(entry.span) && entry.span.end.offset > entry.span.start.offset) return entry.span;
	for (const candidate of [entry.value, entry.pattern, entry.target]) {
		if (isObject(candidate) && isSourceSpan(candidate.span)) return candidate.span;
	}
	return isSourceSpan(entry.span) ? entry.span : undefined;
}

function isShorthandMember(source: SourceFile, range: Range): boolean {
	let offset = positionToOffset(source, range.end);
	while (offset < source.text.length && /\s/u.test(source.text[offset]!)) offset++;
	return source.text[offset] !== ':';
}

function fieldOwnerDefinitionId(value: unknown, semantic: SemanticModel): string | undefined {
	if (!isObject(value)) return undefined;
	if (typeof value.symbolId === 'number') {
		const definitionId = definitionIdForSymbol(semantic, value.symbolId);
		if (definitionId !== undefined) return definitionId;
	}
	const typeId = typeof value.inferredTypeId === 'number' ? value.inferredTypeId : undefined;
	if (typeId === undefined) return undefined;
	const type = semantic.arena.get(typeId);
	return type.kind === 'named' ? type.definitionId : undefined;
}

function definitionIdForSymbol(semantic: SemanticModel, symbolId: SymbolId): string | undefined {
	const symbol = semantic.symbols.get(symbolId);
	if (symbol === undefined) return undefined;
	const type = semantic.arena.get(symbol.typeId);
	return type.kind === 'named' ? type.definitionId : undefined;
}

function occurrenceRole(value: Record<string, unknown>, parent: Record<string, unknown> | undefined): OccurrenceRole {
	const kind = value.kind;
	if (kind === undefined && (parent?.kind === 'FunctionDeclaration'
		|| parent?.kind === 'LambdaExpression'
		|| parent?.kind === 'ExternFunction'
		|| parent?.kind === 'EnumDeclaration')) return 'declaration';
	if (isDeclarationKind(kind)) return kind === 'FunctionDeclaration' || kind === 'TopLevelLetDeclaration' ? 'definition' : 'declaration';
	if (parent?.kind === 'CallExpression' && parent.callee === value) return 'call';
	return 'read';
}

function isDeclarationKind(kind: unknown): boolean {
	return kind === 'FunctionDeclaration'
		|| kind === 'RecordDeclaration'
		|| kind === 'EnumDeclaration'
		|| kind === 'NewtypeDeclaration'
		|| kind === 'TypeAliasDeclaration'
		|| kind === 'TopLevelLetDeclaration'
		|| kind === 'ExternFunction'
		|| kind === 'LetStatement'
		|| kind === 'ForStatement'
		|| kind === 'BindingPattern'
		|| kind === 'VariantPattern'
		|| kind === 'RecordPattern';
}

function typeReferenceKey(
	value: Record<string, unknown>,
	semantic: SemanticModel,
	definitionIds: ReadonlyMap<string, string>,
): string | undefined {
	const typeId = typeof value.resolvedTypeId === 'number' ? value.resolvedTypeId : undefined;
	return typeId === undefined ? undefined : namedTypeDefinitionKey(semantic.arena.get(typeId), semantic, definitionIds);
}

function namedTypeDefinitionKey(type: Type, semantic: SemanticModel, definitionIds: ReadonlyMap<string, string>): string | undefined {
	switch (type.kind) {
		case 'named': return definitionIds.get(type.definitionId);
		case 'list': return namedTypeDefinitionKey(semantic.arena.get(type.element), semantic, definitionIds);
		case 'set': return namedTypeDefinitionKey(semantic.arena.get(type.element), semantic, definitionIds);
		case 'map': return namedTypeDefinitionKey(semantic.arena.get(type.value), semantic, definitionIds)
			?? namedTypeDefinitionKey(semantic.arena.get(type.key), semantic, definitionIds);
		case 'option': return namedTypeDefinitionKey(semantic.arena.get(type.value), semantic, definitionIds);
		case 'result': return namedTypeDefinitionKey(semantic.arena.get(type.value), semantic, definitionIds)
			?? namedTypeDefinitionKey(semantic.arena.get(type.error), semantic, definitionIds);
		case 'future': return namedTypeDefinitionKey(semantic.arena.get(type.value), semantic, definitionIds);
		case 'tuple': return type.items.map(item => namedTypeDefinitionKey(semantic.arena.get(item), semantic, definitionIds)).find(Boolean);
		case 'function': return namedTypeDefinitionKey(semantic.arena.get(type.result), semantic, definitionIds);
		default: return undefined;
	}
}

function symbolKey(path: string, kind: IndexedSymbolKind, span: SourceSpan, name: string): string {
	return `virune:${resolve(path)}:${kind}:${span.start.offset}:${span.end.offset}:${name}`;
}

function safeNameRange(source: SourceFile, span: SourceSpan, name: string): Range {
	if (span.fileId !== source.id) return sourceSpanToRange(span);
	return nameRange(source, span, name);
}

function sameSpan(left: SourceSpan, right: SourceSpan): boolean {
	return left.fileId === right.fileId && left.start.offset === right.start.offset && left.end.offset === right.end.offset;
}

function rangeContainsOffset(source: SourceFile, range: Range, offset: number): boolean {
	const start = positionToOffset(source, range.start);
	const end = positionToOffset(source, range.end);
	return offset >= start && offset <= Math.max(start, end);
}

function rangeLength(source: SourceFile, range: Range): number {
	return Math.max(0, positionToOffset(source, range.end) - positionToOffset(source, range.start));
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, readonly T[]> {
	const mutable = new Map<string, T[]>();
	for (const item of items) {
		const key = keyOf(item);
		const values = mutable.get(key) ?? [];
		values.push(item);
		mutable.set(key, values);
	}
	return new Map([...mutable].map(([key, values]) => [key, values]));
}

function uniqueOccurrenceFilter(value: SymbolOccurrence, index: number, values: readonly SymbolOccurrence[]): boolean {
	return values.findIndex(candidate => candidate.uri === value.uri
		&& candidate.role === value.role
		&& candidate.range.start.line === value.range.start.line
		&& candidate.range.start.character === value.range.start.character
		&& candidate.range.end.line === value.range.end.line
		&& candidate.range.end.character === value.range.end.character) === index;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

function isSourceSpan(value: unknown): value is SourceSpan {
	return isObject(value)
		&& typeof value.fileId === 'number'
		&& isObject(value.start)
		&& isObject(value.end)
		&& typeof value.start.offset === 'number'
		&& typeof value.end.offset === 'number';
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function languageServerSymbolKind(kind: IndexedSymbolKind): SymbolKind {
	switch (kind) {
		case 'function': return SymbolKind.Function;
		case 'extern': return SymbolKind.Function;
		case 'type': return SymbolKind.Class;
		case 'variant': return SymbolKind.EnumMember;
		case 'parameter': return SymbolKind.Variable;
		case 'variable': return SymbolKind.Variable;
		case 'import': return SymbolKind.Variable;
		case 'field': return SymbolKind.Field;
		case 'builtin': return SymbolKind.Variable;
	}
}
