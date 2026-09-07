import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { JsInteropProvider } from './types.js';
import type { SourceSpan } from '../source.js';

interface FrontendJsxValidationOptions {
	readonly containingFile: string;
	readonly platform: 'node' | 'browser' | 'neutral';
	readonly jsInteropProvider?: JsInteropProvider;
}

interface RenderFailure {
	readonly span: SourceSpan;
	readonly message: string;
}

interface RenderContext {
	readonly semantic: SemanticModel;
	readonly declarations: string[];
	nextValueId: number;
	failure?: RenderFailure;
}

const jsxAttributeName = /^[A-Za-z_$][A-Za-z0-9_$-]*$/u;

/**
 * Validate checked View structure against the project's real TypeScript JSX
 * environment. This pass produces proof-only TSX and does not define emission
 * or native component transport semantics.
 */
export function validateFrontendJsxUsage(module: A.ModuleNode, semantic: SemanticModel, options: FrontendJsxValidationOptions): void {
	const components = module.declarations.filter((declaration): declaration is A.ComponentDeclaration => declaration.kind === 'ComponentDeclaration');
	if (components.length === 0 || semantic.diagnostics.hasErrors || options.jsInteropProvider === undefined) return;
	const resolver = options.jsInteropProvider.resolveJsxUsage;
	if (resolver === undefined) {
		for (const component of components) semantic.diagnostics.error('L4308', `Cannot validate JSX usage for component ${component.name}: the JavaScript interop provider does not support JSX whole-usage validation`, component.span);
		return;
	}
	const imports = module.imports.filter(item => item.sourceKind === 'javascript').map(renderJavaScriptImport);
	for (const component of components) {
		const views: A.ViewExpression[] = [];
		collectViewReturns(component.body, views);
		const context: RenderContext = { semantic, declarations: [], nextValueId: 0 };
		const renderedViews: string[] = [];
		for (const view of views) {
			const rendered = renderViewBlock(view.body, context);
			if (rendered === undefined) break;
			renderedViews.push(rendered);
		}
		if (context.failure !== undefined) {
			semantic.diagnostics.error('L4308', `Cannot validate JSX usage for component ${component.name}: ${context.failure.message}`, context.failure.span);
			continue;
		}
		const sourceText = [
			...imports,
			...context.declarations,
			...renderedViews.map((view, index) => `const __viruneView${index} = ${view};`),
		].join('\n');
		let resolution: { readonly accepted: true } | undefined;
		try {
			resolution = resolver.call(options.jsInteropProvider, {
				containingFile: options.containingFile,
				platform: options.platform,
				sourceText,
			});
		} catch {
			resolution = undefined;
		}
		if (resolution?.accepted !== true) semantic.diagnostics.error('L4308', `TypeScript JSX whole-usage validation rejected component ${component.name}`, component.span);
	}
}

function renderJavaScriptImport(declaration: A.ImportDeclaration): string {
	const source = JSON.stringify(declaration.source);
	if (declaration.typeOnly && declaration.items.length > 0) return `import type { ${renderImportItems(declaration.items)} } from ${source};`;
	if (declaration.defaultImport !== undefined) return `import ${declaration.defaultImport} from ${source};`;
	if (declaration.namespaceImport !== undefined) return `import * as ${declaration.namespaceImport} from ${source};`;
	if (declaration.items.length > 0) return `import { ${renderImportItems(declaration.items)} } from ${source};`;
	return `import ${source};`;
}

function renderImportItems(items: readonly A.ImportItem[]): string {
	return items.map(item => item.imported === item.local ? item.imported : `${item.imported} as ${item.local}`).join(', ');
}

function collectViewReturns(block: A.BlockStatement, views: A.ViewExpression[]): void {
	for (const statement of block.statements) {
		switch (statement.kind) {
			case 'ReturnStatement':
				if (statement.value?.kind === 'ViewExpression') views.push(statement.value);
				break;
			case 'IfStatement':
				collectViewReturns(statement.thenBlock, views);
				if (statement.elseBranch?.kind === 'BlockStatement') collectViewReturns(statement.elseBranch, views);
				else if (statement.elseBranch !== undefined) collectIfViews(statement.elseBranch, views);
				break;
			case 'ForStatement':
			case 'WhileStatement':
				collectViewReturns(statement.body, views);
				break;
		}
	}
}

function collectIfViews(statement: A.IfStatement, views: A.ViewExpression[]): void {
	collectViewReturns(statement.thenBlock, views);
	if (statement.elseBranch?.kind === 'BlockStatement') collectViewReturns(statement.elseBranch, views);
	else if (statement.elseBranch !== undefined) collectIfViews(statement.elseBranch, views);
}

function renderViewBlock(block: A.ViewBlock, context: RenderContext): string | undefined {
	const children: string[] = [];
	for (const child of block.children) {
		const rendered = renderViewChild(child, context);
		if (rendered === undefined) return undefined;
		children.push(rendered);
	}
	return `<>${children.join('')}</>`;
}

function renderViewBlockExpression(block: A.ViewBlock, context: RenderContext): string | undefined {
	if (block.children.length !== 1) return renderViewBlock(block, context);
	const child = block.children[0]!;
	switch (child.kind) {
		case 'ViewTextChild': return JSON.stringify(child.value);
		case 'ViewExpressionChild': return renderViewValue(child.expression, context);
		case 'ViewChildrenSlot': return fail(context, child.span, 'compiler-managed children slots require the native component boundary and are not part of this validation slice');
		case 'ViewElement': return renderViewElement(child, context);
		case 'ViewConditional': return renderConditionalExpression(child, context);
	}
}

function renderViewChild(child: A.ViewChild, context: RenderContext): string | undefined {
	switch (child.kind) {
		case 'ViewTextChild': return `{${JSON.stringify(child.value)}}`;
		case 'ViewExpressionChild': {
			const value = renderViewValue(child.expression, context);
			return value === undefined ? undefined : `{${value}}`;
		}
		case 'ViewChildrenSlot': return fail(context, child.span, 'compiler-managed children slots require the native component boundary and are not part of this validation slice');
		case 'ViewElement': return renderViewElement(child, context);
		case 'ViewConditional': return renderViewConditional(child, context);
	}
}

function renderViewElement(element: A.ViewElement, context: RenderContext): string | undefined {
	const properties: string[] = [];
	for (const property of element.properties) {
		if (!jsxAttributeName.test(property.name)) return fail(context, property.span, `property ${JSON.stringify(property.name)} cannot be represented as a preserved JSX attribute without speculative lowering`);
		const value = renderViewValue(property.value, context);
		if (value === undefined) return undefined;
		properties.push(`${property.name}={${value}}`);
	}
	const tag = element.tag.join('.');
	const attributes = properties.length === 0 ? '' : ` ${properties.join(' ')}`;
	if (element.children === undefined) return `<${tag}${attributes} />`;
	const children = renderViewBlockContents(element.children, context);
	return children === undefined ? undefined : `<${tag}${attributes}>${children}</${tag}>`;
}

function renderViewBlockContents(block: A.ViewBlock, context: RenderContext): string | undefined {
	const children: string[] = [];
	for (const child of block.children) {
		const rendered = renderViewChild(child, context);
		if (rendered === undefined) return undefined;
		children.push(rendered);
	}
	return children.join('');
}

function renderViewConditional(conditional: A.ViewConditional, context: RenderContext): string | undefined {
	if (conditional.elseBranch === undefined) return fail(context, conditional.span, 'View if without else is deferred until preserved JSX absence semantics are implemented');
	const condition = renderViewValue(conditional.condition, context);
	if (condition === undefined) return undefined;
	const thenBranch = renderViewBlockExpression(conditional.thenBlock, context);
	if (thenBranch === undefined) return undefined;
	const elseBranch = conditional.elseBranch.kind === 'ViewBlock'
		? renderViewBlockExpression(conditional.elseBranch, context)
		: renderConditionalExpression(conditional.elseBranch, context);
	return elseBranch === undefined ? undefined : `{${condition} ? ${thenBranch} : ${elseBranch}}`;
}

function renderConditionalExpression(conditional: A.ViewConditional, context: RenderContext): string | undefined {
	if (conditional.elseBranch === undefined) return fail(context, conditional.span, 'View if without else is deferred until preserved JSX absence semantics are implemented');
	const condition = renderViewValue(conditional.condition, context);
	if (condition === undefined) return undefined;
	const thenBranch = renderViewBlockExpression(conditional.thenBlock, context);
	if (thenBranch === undefined) return undefined;
	const elseBranch = conditional.elseBranch.kind === 'ViewBlock'
		? renderViewBlockExpression(conditional.elseBranch, context)
		: renderConditionalExpression(conditional.elseBranch, context);
	return elseBranch === undefined ? undefined : `(${condition} ? ${thenBranch} : ${elseBranch})`;
}

function renderViewValue(expression: A.Expression, context: RenderContext): string | undefined {
	if (expression.kind === 'LiteralExpression') return renderLiteral(expression, context);
	const typeId = expression.inferredTypeId;
	if (typeId === undefined) return fail(context, expression.span, 'a View expression value has no checked type');
	const type = context.semantic.arena.get(typeId);
	if (type.kind === 'primitive') {
		const typeName = type.name === 'Bool' ? 'boolean'
			: type.name === 'Int' || type.name === 'Float' ? 'number'
				: type.name === 'BigInt' ? 'bigint'
					: type.name === 'String' ? 'string'
						: undefined;
		if (typeName === undefined) return fail(context, expression.span, `View value type ${context.semantic.arena.display(typeId)} is not safely projectable in this validation slice`);
		const name = `__viruneValue${context.nextValueId++}`;
		context.declarations.push(`declare const ${name}: ${typeName};`);
		return name;
	}
	if (type.kind === 'foreign' && expression.kind === 'IdentifierExpression' && expression.symbolId !== undefined) {
		const symbol = context.semantic.symbols.get(expression.symbolId);
		if (symbol?.kind === 'import' && !symbol.typeOnly) return expression.name;
	}
	return fail(context, expression.span, `View value type ${context.semantic.arena.display(typeId)} requires a boundary not implemented by this validation slice`);
}

function renderLiteral(expression: A.LiteralExpression, context: RenderContext): string | undefined {
	switch (expression.literalKind) {
		case 'String': return JSON.stringify(expression.value);
		case 'Bool': return expression.value === true ? 'true' : 'false';
		case 'Int':
		case 'Float':
			return typeof expression.value === 'number' && Number.isFinite(expression.value)
				? String(expression.value)
				: fail(context, expression.span, 'non-finite numeric literals cannot be represented in JSX validation');
		case 'BigInt':
			return typeof expression.value === 'bigint'
				? `${expression.value}n`
				: fail(context, expression.span, 'invalid bigint literal cannot be represented in JSX validation');
	}
}

function fail(context: RenderContext, span: SourceSpan, message: string): undefined {
	context.failure ??= { span, message };
	return undefined;
}
