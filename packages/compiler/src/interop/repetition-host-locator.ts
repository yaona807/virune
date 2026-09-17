import type * as A from '../ast/nodes.js';
import type { SourceSpan } from '../source.js';

export interface RepetitionHostLocator {
	readonly module: string;
	readonly exportName: string;
	readonly protocolVersion: 1;
	readonly span: SourceSpan;
}

export type RepetitionHostLocatorResolution =
	| { readonly status: 'none' }
	| { readonly status: 'ready'; readonly locator: RepetitionHostLocator }
	| { readonly status: 'ambiguous'; readonly locators: readonly RepetitionHostLocator[] };

function locatorFromDeclaration(declaration: A.Declaration): RepetitionHostLocator | undefined {
	if (declaration.kind !== 'ExternDeclaration' || declaration.unsafe) return undefined;
	const attribute = declaration.attributes.find(item => item.name === 'repetitionHost');
	if (attribute === undefined || attribute.arguments.length !== 2) return undefined;
	const exportName = attribute.arguments[0];
	const version = attribute.arguments[1];
	if (exportName?.kind !== 'LiteralExpression' || exportName.literalKind !== 'String') return undefined;
	if (version?.kind !== 'LiteralExpression' || version.literalKind !== 'Int' || version.value !== 1) return undefined;
	return {
		module: declaration.module,
		exportName: String(exportName.value),
		protocolVersion: 1,
		span: attribute.span,
	};
}

export function discoverRepetitionHostLocator(modules: readonly A.ModuleNode[]): RepetitionHostLocatorResolution {
	const locators: RepetitionHostLocator[] = [];
	for (const module of modules) {
		for (const declaration of module.declarations) {
			const locator = locatorFromDeclaration(declaration);
			if (locator !== undefined) locators.push(locator);
		}
	}
	if (locators.length === 0) return { status: 'none' };
	if (locators.length === 1) return { status: 'ready', locator: locators[0]! };
	return { status: 'ambiguous', locators };
}
