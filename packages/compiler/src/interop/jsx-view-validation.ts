import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import { TypeOperations } from '../checker/type-operations.js';
import type { JsInteropProvider } from './types.js';
import { frontendHostPrimitiveName, frontendScalarRecordFields, type FrontendHostPrimitiveName } from './frontend-component-emission.js';
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
	readonly types: TypeOperations;
	readonly externalTagRoots: ReadonlySet<string>;
	readonly usedNativeProofs: Set<string>;
	readonly repetitionValues: Map<number, string>;
	failure?: RenderFailure;
}

const jsxAttributeName = /^[A-Za-z_$][A-Za-z0-9_$-]*(?::[A-Za-z_$][A-Za-z0-9_$-]*)?$/u;
const stringInterpolationPlaceholder = /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\}(?!\})/u;
const nativeChildrenProperty = '$viruneChildren';

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
	const types = new TypeOperations({ arena: semantic.arena, diagnostics: semantic.diagnostics });
	for (const component of components) {
		const views: A.ViewExpression[] = [];
		collectViewReturns(component.body, views);
		const context: RenderContext = { semantic, types, externalTagRoots, usedNativeProofs: new Set(), repetitionValues: new Map() };
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
			...context.usedNativeProofs,
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

function renderFrontendHostPrimitiveName(name: FrontendHostPrimitiveName): string {
	switch (name) {
		case 'Bool': return 'boolean';
		case 'Int':
		case 'Float': return 'number';
		case 'BigInt': return 'bigint';
		case 'String': return 'string';
	}
}

function renderFrontendHostPrimitiveValue(name: FrontendHostPrimitiveName): string {
	switch (name) {
		case 'Bool': return '(false as boolean)';
		case 'Int':
		case 'Float': return '(0 as number)';
		case 'BigInt': return '(0n as bigint)';
		case 'String': return '("" as string)';
	}
}

function renderFrontendHostType(typeId: number, semantic: SemanticModel, directTypeName?: string): string | undefined {
	const primitive = frontendHostPrimitiveName(typeId, semantic);
	if (primitive !== undefined) return renderFrontendHostPrimitiveName(primitive);
	const fields = frontendScalarRecordFields(typeId, semantic, directTypeName);
	if (fields === undefined) return undefined;
	return `{ ${fields.map(field => `${JSON.stringify(field.name)}: ${renderFrontendHostPrimitiveName(field.primitive)};`).join(' ')} }`;
}

function renderFrontendHostValue(typeId: number, semantic: SemanticModel): string | undefined {
	const primitive = frontendHostPrimitiveName(typeId, semantic);
	if (primitive !== undefined) return renderFrontendHostPrimitiveValue(primitive);
	const fields = frontendScalarRecordFields(typeId, semantic);
	if (fields === undefined) return undefined;
	return `({ ${fields.map(field => `${JSON.stringify(field.name)}: ${renderFrontendHostPrimitiveValue(field.primitive)}`).join(', ')} })`;
}

function renderNativeComponentProof(component: A.ComponentDeclaration, semantic: SemanticModel): string | undefined {
	if (/^[a-z]/u.test(component.name) || component.symbolId === undefined) return undefined;
	const componentSymbol = semantic.symbols.get(component.symbolId);
	if (componentSymbol?.kind !== 'component') return undefined;
	const componentType = semantic.arena.get(componentSymbol.typeId);
	if (componentType.kind !== 'function' || componentType.parameters.length !== component.parameters.length) return undefined;
	const properties: string[] = [];
	for (let index = 0; index < component.parameters.length; index += 1) {
		const parameter = component.parameters[index]!;
		const typeId = componentType.parameters[index];
		if (typeId === undefined) return undefined;
		const rendered = renderFrontendHostType(typeId, semantic, parameter.type.name);
		if (rendered === undefined) return undefined;
		properties.push(`${JSON.stringify(parameter.name)}: ${rendered};`);
	}
	properties.push(`${JSON.stringify(nativeChildrenProperty)}?: () => unknown;`);
	return `declare function ${component.name}(props: { ${properties.join(' ')} }): never;`;
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
		case 'ViewChildrenSlot': return '<></>';
		case 'ViewElement': return renderViewElement(child, context);
		case 'ViewConditional': return renderConditionalExpression(child, context);
		case 'ViewRepetition': return renderViewRepetition(child, context);
	}
}

function renderViewChild(child: A.ViewChild, context: RenderContext): string | undefined {
	switch (child.kind) {
		case 'ViewTextChild': return `{${renderStringValue(child.value)}}`;
		case 'ViewExpressionChild': {
			const value = renderViewValue(child.expression, context);
			return value === undefined ? undefined : `{${value}}`;
		}
		case 'ViewChildrenSlot': return '{<></>}';
		case 'ViewElement': return renderViewElement(child, context);
		case 'ViewConditional': return renderViewConditional(child, context);
		case 'ViewRepetition': {
			const value = renderViewRepetition(child, context);
			return value === undefined ? undefined : `{${value}}`;
		}
	}
}

function renderViewRepetition(repetition: A.ViewRepetition, context: RenderContext): string | undefined {
	const evidence = repetition.checkedEvidence;
	if (evidence === undefined) return fail(context, repetition.span, 'View repetition reached JSX validation without checked repetition evidence');
	if ((repetition.indexName === undefined) !== (evidence.indexSymbolId === undefined)) return fail(context, repetition.span, 'View repetition checked evidence does not match its source index binding');
	const source = evidence.sourceKind === 'external-array'
		? renderExternalRepetitionSource(repetition.source, context)
		: renderNativeRepetitionSource(repetition, evidence, context);
	if (source === undefined) return undefined;
	const sourceName = `$viruneViewSource${repetition.id}`;
	const lengthName = `$viruneViewLength${repetition.id}`;
	const indexName = `$viruneViewIndex${repetition.id}`;
	const itemName = `$viruneViewItem${repetition.id}`;
	const childrenName = `$viruneViewChildren${repetition.id}`;
	const previousItem = context.repetitionValues.get(evidence.itemSymbolId);
	const hadItem = context.repetitionValues.has(evidence.itemSymbolId);
	context.repetitionValues.set(evidence.itemSymbolId, itemName);
	let previousIndex: string | undefined;
	let hadIndex = false;
	if (evidence.indexSymbolId !== undefined) {
		previousIndex = context.repetitionValues.get(evidence.indexSymbolId);
		hadIndex = context.repetitionValues.has(evidence.indexSymbolId);
		context.repetitionValues.set(evidence.indexSymbolId, indexName);
	}
	const body = renderRepetitionBlock(repetition.body, childrenName, context, 2);
	if (hadItem) context.repetitionValues.set(evidence.itemSymbolId, previousItem!);
	else context.repetitionValues.delete(evidence.itemSymbolId);
	if (evidence.indexSymbolId !== undefined) {
		if (hadIndex) context.repetitionValues.set(evidence.indexSymbolId, previousIndex!);
		else context.repetitionValues.delete(evidence.indexSymbolId);
	}
	if (body === undefined) return undefined;
	const holeGuard = evidence.sourceKind === 'external-array' ? `\n\t\tif (!Object.prototype.hasOwnProperty.call(${sourceName}, ${indexName})) continue;` : '';
	const bodyText = body.length === 0 ? '' : `\n${body}`;
	return `(() => {\n\tconst ${sourceName} = ${source};\n\tconst ${lengthName} = ${sourceName}.length;\n\tconst ${childrenName} = [];\n\tfor (let ${indexName} = 0; ${indexName} < ${lengthName}; ${indexName}++) {${holeGuard}\n\t\tconst ${itemName} = ${sourceName}[${indexName}] as (typeof ${sourceName})[number];${bodyText}\n\t}\n\treturn ${childrenName};\n})()`;
}

function renderExternalRepetitionSource(expression: A.Expression, context: RenderContext): string | undefined {
	if (expression.kind === 'IdentifierExpression' && expression.symbolId !== undefined) {
		const symbol = context.semantic.symbols.get(expression.symbolId);
		if (symbol?.kind === 'import' && !symbol.typeOnly) return expression.name;
		if (symbol?.kind === 'variable' && !symbol.mutable) {
			const declaration = symbol.declaration;
			if (declaration?.kind === 'LetStatement') {
				const letStatement = declaration as A.LetStatement;
				if (letStatement.annotation === undefined) return renderExternalRepetitionSource(letStatement.value, context);
			}
		}
	}
	if (expression.kind === 'FieldExpression') {
		const target = renderExternalRepetitionSource(expression.target, context);
		return target === undefined ? undefined : `${target}.${expression.field}`;
	}
	if (expression.kind === 'CallExpression' && expression.foreignCall === true && expression.typeArguments.length === 0 && expression.arguments.length === 0) {
		const callee = renderExternalRepetitionSource(expression.callee, context);
		return callee === undefined ? undefined : `${callee}()`;
	}
	return fail(context, expression.span, 'External Array repetition source cannot be represented in the current JSX validation slice without guessing its TypeScript type');
}

function renderNativeRepetitionSource(repetition: A.ViewRepetition, evidence: A.ViewRepetitionEvidence, context: RenderContext): string | undefined {
	if (repetition.source.kind === 'ListExpression' && repetition.source.items.length > 0) {
		const items: string[] = [];
		for (const item of repetition.source.items) {
			const rendered = renderViewValue(item, context);
			if (rendered === undefined) return undefined;
			items.push(rendered);
		}
		return `[${items.join(', ')}]`;
	}
	const symbol = context.semantic.symbols.get(evidence.itemSymbolId);
	if (symbol === undefined) return fail(context, repetition.span, 'native View repetition item binding is unavailable to JSX validation');
	const probe = renderTypeProbe(symbol.typeId, context, repetition.span);
	return probe === undefined ? undefined : `[${probe}]`;
}

function renderTypeProbe(typeId: number, context: RenderContext, span: SourceSpan): string | undefined {
	const type = context.semantic.arena.get(typeId);
	if (type.kind === 'primitive') {
		switch (type.name) {
			case 'Bool': return '(false as boolean)';
			case 'Int':
			case 'Float': return '(0 as number)';
			case 'BigInt': return '(0n as bigint)';
			case 'String': return '("" as string)';
		}
	}
	return fail(context, span, `native View repetition item type ${context.semantic.arena.display(typeId)} is not safely projectable in this validation slice`);
}

function renderRepetitionBlock(block: A.ViewBlock, target: string, context: RenderContext, indent: number): string | undefined {
	const lines: string[] = [];
	for (const child of block.children) {
		const rendered = renderRepetitionChild(child, target, context, indent);
		if (rendered === undefined) return undefined;
		if (rendered.length > 0) lines.push(rendered);
	}
	return lines.join('\n');
}

function renderRepetitionChild(child: A.ViewChild, target: string, context: RenderContext, indent: number): string | undefined {
	const prefix = '\t'.repeat(indent);
	switch (child.kind) {
		case 'ViewTextChild': return `${prefix}${target}.push(${renderStringValue(child.value)});`;
		case 'ViewExpressionChild': {
			const value = renderViewValue(child.expression, context);
			return value === undefined ? undefined : `${prefix}${target}.push(${value});`;
		}
		case 'ViewChildrenSlot': return fail(context, child.span, 'compiler-managed children slots cannot appear inside View repetition');
		case 'ViewElement': {
			const value = renderViewElement(child, context);
			return value === undefined ? undefined : `${prefix}${target}.push(${value});`;
		}
		case 'ViewConditional': return renderRepetitionConditional(child, target, context, indent);
		case 'ViewRepetition': {
			const value = renderViewRepetition(child, context);
			return value === undefined ? undefined : `${prefix}${target}.push(...${value});`;
		}
	}
}

function renderRepetitionConditional(conditional: A.ViewConditional, target: string, context: RenderContext, indent: number): string | undefined {
	const condition = renderViewValue(conditional.condition, context);
	if (condition === undefined) return undefined;
	const prefix = '\t'.repeat(indent);
	const thenBranch = renderRepetitionBlock(conditional.thenBlock, target, context, indent + 1);
	if (thenBranch === undefined) return undefined;
	const thenText = thenBranch.length === 0 ? '' : `\n${thenBranch}`;
	let text = `${prefix}if (${condition}) {${thenText}\n${prefix}}`;
	if (conditional.elseBranch === undefined) return text;
	if (conditional.elseBranch.kind === 'ViewBlock') {
		const elseBranch = renderRepetitionBlock(conditional.elseBranch, target, context, indent + 1);
		if (elseBranch === undefined) return undefined;
		const elseText = elseBranch.length === 0 ? '' : `\n${elseBranch}`;
		return `${text} else {${elseText}\n${prefix}}`;
	}
	const nested = renderRepetitionConditional(conditional.elseBranch, target, context, indent);
	return nested === undefined ? undefined : `${text} else ${nested.slice(prefix.length)}`;
}

function renderViewElement(element: A.ViewElement, context: RenderContext): string | undefined {
	const root = element.tag[0]!;
	const symbol = context.semantic.globalScope.lookup(root);
	let nativeComponent: A.ComponentDeclaration | undefined;
	if (element.tag.length === 1 && symbol?.kind === 'component' && symbol.declaration?.kind === 'ComponentDeclaration') nativeComponent = symbol.declaration as A.ComponentDeclaration;
	const nativeProof = nativeComponent === undefined ? undefined : renderNativeComponentProof(nativeComponent, context.semantic);
	const native = nativeProof !== undefined;
	if (symbol?.kind === 'component' && !native) {
		if (element.tag.length === 1 && /^[a-z]/u.test(root)) return fail(context, element.span, `lowercase Virune-native component tag ${root} would be interpreted as a JSX intrinsic tag`);
		return fail(context, element.span, `Virune-native component tag ${element.tag.join('.')} requires a native component boundary that is not implemented in this validation slice`);
	}
	const intrinsic = element.tag.length === 1 && /^[a-z]/u.test(root);
	const external = context.externalTagRoots.has(root);
	if (intrinsic && external) return fail(context, element.span, `lowercase JavaScript-imported View tag ${root} is ambiguous with JSX intrinsic syntax`);
	if (!native && !intrinsic && !external) {
		return fail(context, element.span, `View tag ${element.tag.join('.')} is neither intrinsic nor rooted in a JavaScript-imported External binding`);
	}
	if (nativeProof !== undefined && nativeComponent !== undefined) {
		if (!validateNativeComponentProperties(element, nativeComponent, context)) return undefined;
		context.usedNativeProofs.add(nativeProof);
	}
	const properties: string[] = [];
	for (let propertyIndex = 0; propertyIndex < element.properties.length; propertyIndex += 1) {
		const property = element.properties[propertyIndex]!;
		if (!jsxAttributeName.test(property.name)) return fail(context, property.span, `property ${JSON.stringify(property.name)} cannot be represented as a preserved JSX attribute without speculative lowering`);
		let value: string | undefined;
		if (native) value = renderNativeComponentPropertyValue(property.value, context);
		else {
			const projection = context.semantic.frontendCallableProjections.find(item => item.viewElementNodeId === element.id && item.propertyIndex === propertyIndex && item.property === property.name);
			if (projection === undefined) value = renderViewValue(property.value, context);
			else {
				value = renderFrontendCallableValue(projection.descriptor);
				if (value === undefined) return fail(context, property.span, `native callable property ${property.name} has unsupported frontend projection evidence`);
			}
		}
		if (value === undefined) return undefined;
		properties.push(`${property.name}={${value}}`);
	}
	const tag = element.tag.join('.');
	if (native && element.children !== undefined) {
		const children = renderViewBlockExpression(element.children, context);
		if (children === undefined) return undefined;
		properties.push(`${nativeChildrenProperty}={() => ${children}}`);
	}
	const attributes = properties.length === 0 ? '' : ` ${properties.join(' ')}`;
	if (element.children === undefined || native) return `<${tag}${attributes} />`;
	if (external && containsDirectChildrenSlot(element.children)) {
		return fail(context, element.span, `compiler-managed children slot beneath JavaScript-imported External component ${tag} cannot preserve zero-or-more child contribution without changing the downstream children shape`);
	}
	if (external && containsDirectConditionalAbsence(element.children)) {
		return fail(context, element.span, `View if without else beneath JavaScript-imported External component ${tag} cannot preserve zero-child absence without making the empty fragment observable as a child`);
	}
	if (external && containsDirectRepetition(element.children)) {
		return fail(context, element.span, `View repetition beneath JavaScript-imported External component ${tag} cannot preserve flat child expansion without making the generated collection observable as a child`);
	}
	const children = renderViewBlockContents(element.children, context);
	return children === undefined ? undefined : `<${tag}${attributes}>${children}</${tag}>`;
}

function renderFrontendCallablePrimitiveType(primitive: string, parameter: boolean): string | undefined {
	switch (primitive) {
		case 'Bool': return 'boolean';
		case 'Int': return parameter ? undefined : 'number';
		case 'Float': return 'number';
		case 'BigInt': return 'bigint';
		case 'String': return 'string';
		case 'Unit': return 'undefined';
		default: return undefined;
	}
}

function renderFrontendCallablePrimitiveValue(primitive: string): string | undefined {
	switch (primitive) {
		case 'Bool': return 'false';
		case 'Int':
		case 'Float': return '0';
		case 'BigInt': return '0n';
		case 'String': return '""';
		case 'Unit': return 'undefined';
		default: return undefined;
	}
}

function renderFrontendCallableValue(descriptor: SemanticModel['frontendCallableProjections'][number]['descriptor']): string | undefined {
	const parameters: string[] = [];
	for (let index = 0; index < descriptor.parameters.length; index += 1) {
		const type = renderFrontendCallablePrimitiveType(descriptor.parameters[index]!, true);
		if (type === undefined) return undefined;
		parameters.push(`$p${index}: ${type}`);
	}
	const resultType = renderFrontendCallablePrimitiveType(descriptor.result, false);
	const resultValue = renderFrontendCallablePrimitiveValue(descriptor.result);
	if (resultType === undefined || resultValue === undefined) return undefined;
	return descriptor.async
		? `(async (${parameters.join(', ')}): Promise<${resultType}> => ${resultValue})`
		: `((${parameters.join(', ')}): ${resultType} => ${resultValue})`;
}

function renderNativeComponentPropertyValue(expression: A.Expression, context: RenderContext): string | undefined {
	const typeId = expression.inferredTypeId;
	if (typeId !== undefined) {
		const type = context.semantic.arena.get(typeId);
		if (type.kind === 'named' && (type.declarationKind === 'newtype' || type.declarationKind === 'record')) {
			const rendered = renderFrontendHostValue(typeId, context.semantic);
			if (rendered !== undefined) return rendered;
		}
	}
	return renderViewValue(expression, context);
}

function validateNativeComponentProperties(element: A.ViewElement, component: A.ComponentDeclaration, context: RenderContext): boolean {
	if (component.symbolId === undefined) {
		fail(context, element.span, `Virune-native component ${component.name} lacks checked signature evidence`);
		return false;
	}
	const componentSymbol = context.semantic.symbols.get(component.symbolId);
	const componentType = componentSymbol?.kind === 'component' ? context.semantic.arena.get(componentSymbol.typeId) : undefined;
	if (componentType?.kind !== 'function' || componentType.parameters.length !== component.parameters.length) {
		fail(context, element.span, `Virune-native component ${component.name} lacks checked signature evidence`);
		return false;
	}
	const parameters = new Map(component.parameters.map((parameter, index) => [parameter.name, componentType.parameters[index]!]));
	const seen = new Set<string>();
	for (const property of element.properties) {
		if (seen.has(property.name)) {
			fail(context, property.span, `Virune-native component ${component.name} property ${property.name} is duplicated`);
			return false;
		}
		seen.add(property.name);
		const expected = parameters.get(property.name);
		if (expected === undefined) {
			fail(context, property.span, `Virune-native component ${component.name} has no property ${property.name}`);
			return false;
		}
		const actual = property.value.inferredTypeId;
		if (actual === undefined) {
			fail(context, property.span, `Virune-native component ${component.name} property ${property.name} lacks checked type evidence`);
			return false;
		}
		if (!context.types.isAssignable(actual, expected)) {
			fail(context, property.span, `Virune-native component ${component.name} property ${property.name} has type ${context.semantic.arena.display(actual)}; expected ${context.semantic.arena.display(expected)}`);
			return false;
		}
	}
	for (const parameter of component.parameters) {
		if (seen.has(parameter.name)) continue;
		fail(context, element.span, `Virune-native component ${component.name} requires property ${parameter.name}`);
		return false;
	}
	return true;
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

function containsDirectChildrenSlot(block: A.ViewBlock): boolean {
	return block.children.some(child => child.kind === 'ViewChildrenSlot' || (child.kind === 'ViewConditional' && conditionalContainsDirectChildrenSlot(child)));
}

function conditionalContainsDirectChildrenSlot(conditional: A.ViewConditional): boolean {
	if (containsDirectChildrenSlot(conditional.thenBlock)) return true;
	if (conditional.elseBranch === undefined) return false;
	return conditional.elseBranch.kind === 'ViewBlock'
		? containsDirectChildrenSlot(conditional.elseBranch)
		: conditionalContainsDirectChildrenSlot(conditional.elseBranch);
}

function containsDirectConditionalAbsence(block: A.ViewBlock): boolean {
	return block.children.some(child => child.kind === 'ViewConditional' && conditionalContainsAbsence(child));
}

function conditionalContainsAbsence(conditional: A.ViewConditional): boolean {
	if (conditional.elseBranch === undefined) return true;
	if (containsDirectConditionalAbsence(conditional.thenBlock)) return true;
	return conditional.elseBranch.kind === 'ViewBlock'
		? containsDirectConditionalAbsence(conditional.elseBranch)
		: conditionalContainsAbsence(conditional.elseBranch);
}

function containsDirectRepetition(block: A.ViewBlock): boolean {
	return block.children.some(child => child.kind === 'ViewRepetition' || (child.kind === 'ViewConditional' && conditionalContainsDirectRepetition(child)));
}

function conditionalContainsDirectRepetition(conditional: A.ViewConditional): boolean {
	if (containsDirectRepetition(conditional.thenBlock)) return true;
	if (conditional.elseBranch === undefined) return false;
	return conditional.elseBranch.kind === 'ViewBlock'
		? containsDirectRepetition(conditional.elseBranch)
		: conditionalContainsDirectRepetition(conditional.elseBranch);
}

function renderViewConditional(conditional: A.ViewConditional, context: RenderContext): string | undefined {
	const condition = renderViewValue(conditional.condition, context);
	if (condition === undefined) return undefined;
	const thenBranch = renderViewBlockExpression(conditional.thenBlock, context);
	if (thenBranch === undefined) return undefined;
	const elseBranch = conditional.elseBranch === undefined
		? '<></>'
		: conditional.elseBranch.kind === 'ViewBlock'
			? renderViewBlockExpression(conditional.elseBranch, context)
			: renderConditionalExpression(conditional.elseBranch, context);
	return elseBranch === undefined ? undefined : `{${condition} ? ${thenBranch} : ${elseBranch}}`;
}

function renderConditionalExpression(conditional: A.ViewConditional, context: RenderContext): string | undefined {
	const condition = renderViewValue(conditional.condition, context);
	if (condition === undefined) return undefined;
	const thenBranch = renderViewBlockExpression(conditional.thenBlock, context);
	if (thenBranch === undefined) return undefined;
	const elseBranch = conditional.elseBranch === undefined
		? '<></>'
		: conditional.elseBranch.kind === 'ViewBlock'
			? renderViewBlockExpression(conditional.elseBranch, context)
			: renderConditionalExpression(conditional.elseBranch, context);
	return elseBranch === undefined ? undefined : `(${condition} ? ${thenBranch} : ${elseBranch})`;
}

function renderViewValue(expression: A.Expression, context: RenderContext): string | undefined {
	if (expression.kind === 'IdentifierExpression' && expression.symbolId !== undefined) {
		const repetitionValue = context.repetitionValues.get(expression.symbolId);
		if (repetitionValue !== undefined) return repetitionValue;
	}
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
	if (type.kind === 'foreign' && type.snapshot.category === 'primitive' && type.snapshot.primitive === 'string') return '("" as string)';
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
