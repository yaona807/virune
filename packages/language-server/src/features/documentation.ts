import type { BuiltModule, DocumentationNode, RecordDeclaration, RecordFieldNode, TypeId } from '@virune/compiler/experimental';

interface HasDocumentation {
	readonly documentation?: DocumentationNode;
}

interface SymbolLike {
	readonly kind: string;
	readonly name: string;
	readonly declaration?: unknown;
}

export function symbolDocumentationText(symbol: SymbolLike): string | undefined {
	return documentationText(symbolDocumentationTarget(symbol));
}

export function symbolDocumentationSummary(symbol: SymbolLike): string | undefined {
	return documentationSummary(symbolDocumentationTarget(symbol));
}

function symbolDocumentationTarget(symbol: SymbolLike): unknown {
	const declaration = symbol.declaration;
	if (symbol.kind !== 'variant' || declaration === null || typeof declaration !== 'object') return declaration;
	const candidate = declaration as { readonly kind?: string; readonly variants?: readonly { readonly name: string }[] };
	return candidate.kind === 'EnumDeclaration'
		? candidate.variants?.find(variant => variant.name === symbol.name) ?? declaration
		: declaration;
}

export function recordFieldDocumentation(
	module: BuiltModule,
	receiverTypeId: TypeId,
	fieldName: string,
): RecordFieldNode | undefined {
	if (module.semantic === undefined) return undefined;
	const receiverType = module.semantic.arena.get(receiverTypeId);
	if (receiverType.kind !== 'named' || receiverType.declarationKind !== 'record') return undefined;
	for (const symbol of module.semantic.symbols.values()) {
		const declaration = symbol.declaration;
		if (symbol.kind !== 'type' || !isRecordDeclaration(declaration)) continue;
		const symbolType = module.semantic.arena.get(symbol.typeId);
		if (symbolType.kind !== 'named' || symbolType.definitionId !== receiverType.definitionId) continue;
		return declaration.fields.find(field => field.name === fieldName);
	}
	return undefined;
}

function isRecordDeclaration(value: unknown): value is RecordDeclaration {
	return value !== null
		&& typeof value === 'object'
		&& (value as { readonly kind?: unknown }).kind === 'RecordDeclaration'
		&& Array.isArray((value as { readonly fields?: unknown }).fields);
}

export function documentationText(value: unknown): string | undefined {
	if (value === null || typeof value !== 'object') return undefined;
	const documentation = (value as HasDocumentation).documentation;
	if (documentation === undefined || documentation.text.trim().length === 0) return undefined;
	return safeMarkdown(documentation.text.trim());
}

export function documentationSummary(value: unknown): string | undefined {
	const text = documentationText(value);
	if (text === undefined) return undefined;
	const paragraph = text.split(/\r?\n\s*\r?\n/u, 1)[0]?.trim();
	return paragraph === undefined || paragraph.length === 0 ? undefined : paragraph;
}

/** VS Code renders Markdown; raw HTML is escaped outside fenced code blocks. */
export function safeMarkdown(value: string): string {
	let fence: '`' | '~' | undefined;
	return value.split('\n').map(line => {
		const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]?.[0];
		if (marker === '`' || marker === '~') {
			if (fence === undefined) fence = marker;
			else if (fence === marker) fence = undefined;
			return line;
		}
		return fence === undefined
			? line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
			: line;
	}).join('\n');
}
