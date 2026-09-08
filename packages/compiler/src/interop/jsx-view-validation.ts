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
	readonly externalTagRoots: ReadonlySet<string>;
	failure?: RenderFailure;
}

const jsxAttributeName = /^[A-Za-z_$][A-Za-z0-9_$-]*(?::[A-Za-z_$][A-Za-z0-9_$-]*)?$/u;
const stringInterpolationPlaceholder = /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\}(?!\})/u;

/**
 * Validate checked View structure against the project's real TypeScript JSX
 * environment. This pass produces proof-only TSX and does not define emission
 * or native component transport semantics.
 */
export function validateFrontendJsxUsage(module: A.ModuleNode, semantic: SemanticModel, options: FrontendJsxValidationOptions): void {
	const components = module.declarations.filter((declaration): declaration is A.ComponentDeclaration => declaration.kind === 'ComponentDeclaration');
	if (components.length === 0 || semantic.diagnostics.hasErrors) return;
	if (options.jsInteropProvider === undefined) {
		for (const component of components) semantic.diagnostics.error('L4308', `Cannot validate JSX usage for component ${component.name}: the JavaScript interop provider is unavailable`, component.span);
		return;
	}
	const provider = options.jsInteropProvider;
	const resolver = provider.resolveJsxUsage;
	if (resolver === undefined) {
		for (const component of components) semantic.diagnostics.error('L4308', `Cannot validate JSX usage for component ${component.name}: the JavaScript interop provider does not support JSX whole-usage validation`, component.span);
		return;
	}
	const imports = module.imports.filter(item => item.sourceKind === 'javascript').map(renderJavaScriptImport);
	const externalTagRoots = javaScriptValueImportNames(module);
	for (const component of components) {
		const views: A.ViewExpression[] = [];
		collectViewReturns(component.body, views);
		const context: RenderContext = { semantic, externalTagRoots };
		const renderedViews: string[] = [];
		for (const view of views) {
			const onlyChild = view.body.children.length === 1 ? view.body.children[0] : undefined;
			const rendered = onlyChild?.kind === 'ViewElement' ? renderViewElement(onlyChild, context) : renderViewBlock(view.body, context);
			if (rendered === undefined) break;
			renderedViews.push(rendered);
		}
		if (context.failure !== undefined) {
			semantic.diagnostics.error('L4308', `Cannot validate JSX usage for component ${component.name}: ${context.failure.message}`, context.failure.span);
			continue;
		}
		const sourceText = [
			...imports,
			...[...externalTagRoots].map(name => `void ${name};`),
			...renderedViews.map(view => `${view};`),
		].join('\n');
		let resolution: { readonly accepted: true } | undefined;
		try {
			resolution = resolver.call(provider, {
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
	if (declaration.typeOnly) return `import ${source};`;
	if (declaration.defaultImport !== undefined) return `import ${declaration.defaultImport} from ${source};`;
	if (declaration.namespaceImport !== undefined) return `import * as ${declaration.namespaceImport} from ${source};`;
	if (declaration.items.length > 0) return `import { ${renderImportItems(declaration.items)} } from ${source};`;
	return `import ${source};`;
}

function renderImportItems(items: readonly A.ImportItem[]): string {
	return items.map(item => item.imported === item.local ? item.imported : `${item.imported} as ${item.local}`).join(', ');
}

function javaScriptValueImportNames(module: A.ModuleNode): ReadonlySet<string> {
	const names = new Set<string>();
	for (const declaration of module.imports) {
		if (declaration.sourceKind !== 'javascript' || declaration.typeOnly) continue;
		if (declaration.defaultImport !== undefined) names.add(declaration.defaultImport);
		if (declaration.namespaceImport !== undefined) names.add(declaration.namespaceImport);
		for (const item of declaration.items) names.add(item.local);
	}
	return names;
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
		case 'ViewTextChild': return renderStringValue(child.value);
		case 'ViewExpressionChild': return renderViewValue(child.expression, context);
		case 'ViewChildrenSlot': return fail(context, child.span, 'compiler-managed children slots require the native component boundary and are not part of this validation slice');
		case 'ViewElement': return renderViewElement(child, context);
		case 'ViewConditional': return renderConditionalExpression(child, context);
	}
}

function renderViewChild(child: A.ViewChild, context: RenderContext): string | undefined {
	switch (child.kind) {
		case 'ViewTextChild': return `{${renderStringValue(child.value)}}`;
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
	const root = element.tag[0]!;
	if (context.semantic.globalScope.lookup(root)?.kind === 'component') return fail(context, element.span, `Virune-native component tag ${element.tag.join('.')} requires a native component boundary that is not implemented in this validation slice`);
	const intrinsic = element.tag.length === 1 && /^[a-z]/u.test(root);
	const external = context.externalTagRoots.has(root);
	if (intrinsic && external) return fail(context, element.span, `lowercase JavaScript-imported View tag ${root} is ambiguous with JSX intrinsic syntax`);
	if (!intrinsic && !external) {
		return fail(context, element.span, `View tag ${element.tag.join('.')} is neither intrinsic nor rooted in a JavaScript-imported External binding`);
	}
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
	if (expression.kind === 'UnaryExpression' && expression.operator === '-' && expression.operand.kind === 'LiteralExpression' && ['Int', 'Float', 'BigInt'].includes(expression.operand.literalKind)) {
		const literal = renderLiteral(expression.operand, context);
		return literal === undefined ? undefined : `-${literal}`;
	}
	const typeId = expression.inferredTypeId;
	if (typeId === undefined) return fail(context, expression.span, 'a View expression value has no checked type');
	const type = context.semantic.arena.get(typeId);
	if (type.kind === 'primitive') {
		switch (type.name) {
			case 'Bool': return '(false as boolean)';
			case 'Int':
			case 'Float': return '(0 as number)';
			case 'BigInt': return '(0n as bigint)';
			case 'String': return '("" as string)';
			default: return fail(context, expression.span, `View value type ${context.semantic.arena.display(typeId)} is not safely projectable in this validation slice`);
		}
	}
	if (type.kind === 'foreign' && expression.kind === 'IdentifierExpression' && expression.symbolId !== undefined) {
		const symbol = context.semantic.symbols.get(expression.symbolId);
		if (symbol?.kind === 'import' && !symbol.typeOnly) {
			if (type.snapshot.category === 'unknown' || type.snapshot.category === 'any') return fail(context, expression.span, `View value type ${context.semantic.arena.display(typeId)} is not safely projectable in this validation slice`);
			return expression.name;
		}
	}
	return fail(context, expression.span, `View value type ${context.semantic.arena.display(typeId)} requires a boundary not implemented by this validation slice`);
}

function renderLiteral(expression: A.LiteralExpression, context: RenderContext): string | undefined {
	switch (expression.literalKind) {
		case 'String': return renderStringValue(String(expression.value));
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

function renderStringValue(value: string): string {
	if (stringInterpolationPlaceholder.test(value)) return '("" as string)';
	return JSON.stringify(value.replaceAll('{{', '{').replaceAll('}}', '}'));
}

function fail(context: RenderContext, span: SourceSpan, message: string): undefined {
	context.failure ??= { span, message };
	return undefined;
}
