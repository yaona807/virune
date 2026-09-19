import type * as A from '../ast/nodes.js';
import type { SourceSpan } from '../source.js';

export interface RepetitionHostSourceModule {
	readonly path: string;
	readonly ast: A.ModuleNode;
}

export interface RepetitionHostLocator {
	readonly module: string;
	readonly exportName: string;
	readonly protocolVersion: 1;
	readonly declarationFile: string;
	readonly span: SourceSpan;
}

export type RepetitionHostLocatorResolution =
	| { readonly status: 'none' }
	| { readonly status: 'ready'; readonly locator: RepetitionHostLocator }
	| { readonly status: 'ambiguous'; readonly locators: readonly RepetitionHostLocator[] };

function locatorFromDeclaration(declaration: A.Declaration, declarationFile: string): RepetitionHostLocator | undefined {
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
		declarationFile,
		span: attribute.span,
	};
}

export function discoverRepetitionHostLocator(modules: readonly RepetitionHostSourceModule[]): RepetitionHostLocatorResolution {
	const locators: RepetitionHostLocator[] = [];
	for (const module of modules) {
		for (const declaration of module.ast.declarations) {
			const locator = locatorFromDeclaration(declaration, module.path);
			if (locator !== undefined) locators.push(locator);
		}
	}
	if (locators.length === 0) return { status: 'none' };
	if (locators.length === 1) return { status: 'ready', locator: locators[0]! };
	return { status: 'ambiguous', locators };
}

export function collectIdentityViewRepetitions(module: A.ModuleNode): readonly A.ViewRepetition[] {
	const repetitions: A.ViewRepetition[] = [];
	collectIdentityViewRepetitionsFromValue(module, repetitions);
	return repetitions;
}

function collectIdentityViewRepetitionsFromValue(value: unknown, repetitions: A.ViewRepetition[]): void {
	if (Array.isArray(value)) {
		for (const item of value) collectIdentityViewRepetitionsFromValue(item, repetitions);
		return;
	}
	if (value === null || typeof value !== 'object') return;
	const node = value as Record<string, unknown>;
	if (node.kind === 'ViewRepetition' && node.identity !== undefined) repetitions.push(node as unknown as A.ViewRepetition);
	for (const [key, child] of Object.entries(node)) {
		if (key === 'span' || key === 'checkedEvidence' || key === 'documentation') continue;
		collectIdentityViewRepetitionsFromValue(child, repetitions);
	}
}
