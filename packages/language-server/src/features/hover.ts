import type {
	AstNode,
	BuiltModule,
	EnumDeclaration,
	ExternFunctionNode,
	FunctionDeclaration,
	LambdaExpression,
	LetStatement,
	NewtypeDeclaration,
	RecordDeclaration,
	SourceFile,
	SymbolId,
	TopLevelLetDeclaration,
	TypeAliasDeclaration,
	TypeId,
	TypeReferenceNode,
} from '@virune/compiler/experimental';
import { MarkupKind, type Hover } from 'vscode-languageserver/node';
import { findNodePathAtOffset, walkAst } from '../analysis/ast.js';
import { nameRange, positionToOffset, sourceSpanToRange } from '../analysis/position.js';
import { defaultEditorInformationSettings, type EditorInformationSettings } from '../editor-information.js';

interface SymbolNode extends AstNode {
	readonly symbolId?: SymbolId;
	readonly inferredTypeId?: TypeId;
	readonly resolvedTypeId?: TypeId;
}

interface HoverOptions {
	readonly settings?: EditorInformationSettings;
	readonly sourcesById?: ReadonlyMap<number, SourceFile>;
}

interface SymbolDetails {
	readonly name: string;
	readonly kind: string;
	readonly span: AstNode['span'];
	readonly declaration?: AstNode;
	readonly typeId: TypeId;
	readonly mutable: boolean;
	readonly public: boolean;
	readonly constant: boolean;
}

export function hoverAt(
	module: BuiltModule,
	source: SourceFile,
	offset: number,
	options: HoverOptions = {},
): Hover | undefined {
	if (module.ast === undefined || module.semantic === undefined) return undefined;
	const settings = options.settings ?? defaultEditorInformationSettings;
	const namedSymbol = namedSymbolAtOffset(module, source, offset);
	if (namedSymbol !== undefined) {
		const symbol = module.semantic.symbols.get(namedSymbol.symbolId) as SymbolDetails | undefined;
		if (symbol !== undefined) return symbolHover(module, symbol, namedSymbol.range, settings, options.sourcesById);
	}
	const path = findNodePathAtOffset(module.ast, source, offset);
	for (const node of [...path].reverse() as SymbolNode[]) {
		if (node.symbolId !== undefined) {
			const symbol = module.semantic.symbols.get(node.symbolId) as SymbolDetails | undefined;
			if (symbol !== undefined) {
				return symbolHover(module, symbol, sourceSpanToRange(node.span), settings, options.sourcesById);
			}
		}
		const typeId = node.inferredTypeId ?? node.resolvedTypeId;
		if (typeId !== undefined) {
			const type = module.semantic.arena.display(typeId);
			if (type === '<invalid>') continue;
			return {
				range: sourceSpanToRange(node.span),
				contents: {
					kind: MarkupKind.Markdown,
					value: markdownHover(type, ['Inferred expression type']),
				},
			};
		}
	}
	return undefined;
}

interface NamedSymbolLocation {
	readonly symbolId: SymbolId;
	readonly range: ReturnType<typeof nameRange>;
}

function namedSymbolAtOffset(
	module: BuiltModule,
	source: SourceFile,
	offset: number,
): NamedSymbolLocation | undefined {
	if (module.ast === undefined) return undefined;
	let match: NamedSymbolLocation | undefined;
	walkAst(module.ast, node => {
		if (match !== undefined || node.span.fileId !== source.id) return;
		const candidate = node as AstNode & { readonly name?: string; readonly symbolId?: SymbolId };
		if (typeof candidate.name !== 'string' || candidate.symbolId === undefined) return;
		const range = nameRange(source, candidate.span, candidate.name);
		const start = positionToOffset(source, range.start);
		const end = positionToOffset(source, range.end);
		if (offset >= start && offset <= end) match = { symbolId: candidate.symbolId, range };
	});
	return match;
}

function symbolHover(
	module: BuiltModule,
	symbol: SymbolDetails,
	range: ReturnType<typeof sourceSpanToRange>,
	settings: EditorInformationSettings,
	sourcesById: ReadonlyMap<number, SourceFile> | undefined,
): Hover {
	const label = symbolLabel(module, symbol, settings);
	const details = symbolDetails(module, symbol, settings, sourcesById);
	return {
		range,
		contents: {
			kind: MarkupKind.Markdown,
			value: markdownHover(label, details),
		},
	};
}

function symbolLabel(module: BuiltModule, symbol: SymbolDetails, settings: EditorInformationSettings): string {
	const declaration = symbol.declaration;
	if (declaration?.kind === 'FunctionDeclaration') return functionLabel(module, symbol, declaration as FunctionDeclaration, settings);
	if (declaration?.kind === 'ExternFunction') return functionLabel(module, symbol, declaration as ExternFunctionNode, settings);
	if (declaration?.kind === 'LambdaExpression') return functionLabel(module, symbol, declaration as LambdaExpression, settings);
	if (declaration?.kind === 'RecordDeclaration') return recordLabel(module, declaration as RecordDeclaration);
	if (declaration?.kind === 'EnumDeclaration') return enumLabel(module, declaration as EnumDeclaration);
	if (declaration?.kind === 'NewtypeDeclaration') return newtypeLabel(module, declaration as NewtypeDeclaration);
	if (declaration?.kind === 'TypeAliasDeclaration') return typeAliasLabel(module, declaration as TypeAliasDeclaration);
	if (symbol.kind === 'function' || symbol.kind === 'extern' || symbol.kind === 'builtin' || symbol.kind === 'import') {
		return functionLabel(module, symbol, undefined, settings);
	}
	const type = module.semantic?.arena.display(symbol.typeId) ?? '<invalid>';
	if (symbol.kind === 'type') return `type ${symbol.name}`;
	if (symbol.kind === 'variant') return `${symbol.name}: ${type}`;
	if (symbol.kind === 'parameter') return `${symbol.name}: ${type}`;
	if (symbol.kind === 'import') return `${symbol.name}: ${type}`;
	return `${symbol.constant ? 'const' : 'let'}${symbol.mutable ? ' mut' : ''} ${symbol.name}: ${type}`;
}

function functionLabel(
	module: BuiltModule,
	symbol: SymbolDetails,
	declaration: FunctionDeclaration | ExternFunctionNode | LambdaExpression | undefined,
	settings: EditorInformationSettings,
): string {
	if (module.semantic === undefined) return `${symbol.name}: <invalid>`;
	const type = module.semantic.arena.get(symbol.typeId);
	if (type.kind !== 'function') return `${symbol.name}: ${module.semantic.arena.display(symbol.typeId)}`;
	const parameters = declaration?.parameters ?? [];
	const parameterLabels = type.parameters.map((typeId, index) => {
		const parameter = parameters[index];
		const name = parameter?.name ?? `arg${index + 1}`;
		const optional = parameter !== undefined && 'optional' in parameter && parameter.optional ? '?' : '';
		return `${name}${optional}: ${module.semantic?.arena.display(typeId) ?? '<invalid>'}`;
	});
	const generic = type.typeParameters.length === 0 ? '' : `<${type.typeParameters.join(', ')}>`;
	const effects = settings.hover.showEffects && type.effects.length > 0 ? ` uses ${type.effects.join(', ')}` : '';
	const publicPrefix = declaration?.kind === 'FunctionDeclaration' && declaration.public ? 'pub ' : '';
	const externPrefix = declaration?.kind === 'ExternFunction' || symbol.kind === 'extern' ? 'extern ' : '';
	const asyncPrefix = type.async ? 'async ' : '';
	const name = declaration !== undefined && 'name' in declaration && typeof declaration.name === 'string' ? declaration.name : symbol.name;
	return `${publicPrefix}${externPrefix}${asyncPrefix}fn ${name}${generic}(${parameterLabels.join(', ')}) -> ${module.semantic.arena.display(type.result)}${effects}`;
}

function recordLabel(module: BuiltModule, declaration: RecordDeclaration): string {
	const generic = typeParameterLabel(declaration.typeParameters);
	const fields = declaration.fields.map(field => `\t${field.name}: ${typeReferenceLabel(module, field.type)}`);
	return `${declaration.public ? 'pub ' : ''}record ${declaration.name}${generic} {\n${fields.join('\n')}\n}`;
}

function enumLabel(module: BuiltModule, declaration: EnumDeclaration): string {
	const generic = typeParameterLabel(declaration.typeParameters);
	const variants = declaration.variants.map(variant => {
		const values = variant.values.map(value => typeReferenceLabel(module, value));
		return `\t${variant.name}${values.length === 0 ? '' : `(${values.join(', ')})`}`;
	});
	return `${declaration.public ? 'pub ' : ''}enum ${declaration.name}${generic} {\n${variants.join('\n')}\n}`;
}

function newtypeLabel(module: BuiltModule, declaration: NewtypeDeclaration): string {
	return `${declaration.public ? 'pub ' : ''}newtype ${declaration.name} = ${typeReferenceLabel(module, declaration.underlying)}`;
}

function typeAliasLabel(module: BuiltModule, declaration: TypeAliasDeclaration): string {
	return `${declaration.public ? 'pub ' : ''}type ${declaration.name}${typeParameterLabel(declaration.typeParameters)} = ${typeReferenceLabel(module, declaration.target)}`;
}

function typeReferenceLabel(module: BuiltModule, reference: TypeReferenceNode): string {
	if (module.semantic !== undefined && reference.resolvedTypeId !== undefined) {
		const resolved = module.semantic.arena.display(reference.resolvedTypeId);
		if (resolved !== '<invalid>') return resolved;
	}
	if (reference.functionType !== undefined) {
		const signature = reference.functionType;
		const effects = signature.effects.length === 0 ? '' : ` uses ${signature.effects.join(', ')}`;
		return `${signature.async ? 'async ' : ''}fn(${signature.parameters.map(parameter => typeReferenceLabel(module, parameter)).join(', ')}) -> ${typeReferenceLabel(module, signature.result)}${effects}${reference.optional ? '?' : ''}`;
	}
	const argumentsLabel = reference.arguments.length === 0
		? ''
		: `<${reference.arguments.map(argument => typeReferenceLabel(module, argument)).join(', ')}>`;
	return `${reference.name}${argumentsLabel}${reference.optional ? '?' : ''}`;
}

function typeParameterLabel(parameters: readonly { readonly name: string }[]): string {
	return parameters.length === 0 ? '' : `<${parameters.map(parameter => parameter.name).join(', ')}>`;
}

function symbolDetails(
	module: BuiltModule,
	symbol: SymbolDetails,
	settings: EditorInformationSettings,
	sourcesById: ReadonlyMap<number, SourceFile> | undefined,
): string[] {
	const details: string[] = [];
	if (isInferredSymbol(symbol)) details.push(symbol.declaration?.kind === 'FunctionDeclaration' ? 'Return type inferred' : 'Type inferred');
	if (settings.hover.showModule) {
		const path = sourcesById?.get(symbol.span.fileId)?.path ?? (symbol.span.fileId === module.source.id ? module.source.path : undefined);
		if (path !== undefined) details.push(`Defined in \`${escapeInlineCode(path)}\``);
	}
	return details;
}

function isInferredSymbol(symbol: SymbolDetails): boolean {
	const declaration = symbol.declaration;
	if (declaration?.kind === 'FunctionDeclaration') return (declaration as FunctionDeclaration).returnType === undefined;
	if (declaration?.kind === 'TopLevelLetDeclaration') return (declaration as TopLevelLetDeclaration).annotation === undefined;
	if (declaration?.kind === 'LetStatement') return (declaration as LetStatement).annotation === undefined;
	return false;
}

function markdownHover(label: string, details: readonly string[]): string {
	const code = `\`\`\`virune\n${label}\n\`\`\``;
	return details.length === 0 ? code : `${code}\n\n${details.join('  \n')}`;
}

function escapeInlineCode(value: string): string {
	return value.replaceAll('`', '\\`');
}
