import type * as A from '../ast/nodes.js';
import type { SemanticModel } from '../checker/checker.js';
import type { DiagnosticBag } from '../diagnostics/diagnostic.js';
import type { SourceSpan, TypeId } from '../source.js';

export type FrontendHostPrimitiveName = 'Bool' | 'Int' | 'Float' | 'BigInt' | 'String';

function directFrontendHostPrimitiveName(typeId: TypeId, semantic: SemanticModel): FrontendHostPrimitiveName | undefined {
	const type = semantic.arena.get(typeId);
	if (type.kind !== 'primitive') return undefined;
	switch (type.name) {
		case 'Bool':
		case 'Int':
		case 'Float':
		case 'BigInt':
		case 'String':
			return type.name;
		default:
			return undefined;
	}
}

export function frontendHostPrimitiveName(typeId: TypeId, semantic: SemanticModel): FrontendHostPrimitiveName | undefined {
	const direct = directFrontendHostPrimitiveName(typeId, semantic);
	if (direct !== undefined) return direct;
	const type = semantic.arena.get(typeId);
	if (type.kind !== 'named' || type.declarationKind !== 'newtype' || type.underlying === undefined || type.mustUse === true) return undefined;
	const symbol = semantic.globalScope.lookup(type.name);
	if (symbol?.kind !== 'type' || symbol.declaration?.kind !== 'NewtypeDeclaration') return undefined;
	const declaration = symbol.declaration as A.NewtypeDeclaration;
	const primitive = directFrontendHostPrimitiveName(type.underlying, semantic);
	return primitive !== undefined && declaration.underlying.name === primitive ? primitive : undefined;
}

export function frontendScalarRecordFields(
	typeId: TypeId,
	semantic: SemanticModel,
	directTypeName?: string,
): readonly { readonly name: string; readonly primitive: FrontendHostPrimitiveName }[] | undefined {
	const type = semantic.arena.get(typeId);
	if (type.kind !== 'named' || type.declarationKind !== 'record' || type.fields === undefined || type.mustUse === true) return undefined;
	if (directTypeName !== undefined && directTypeName !== type.name) return undefined;
	const symbol = semantic.globalScope.lookup(type.name);
	if (symbol?.kind !== 'type' || symbol.declaration?.kind !== 'RecordDeclaration') return undefined;
	const declaration = symbol.declaration as A.RecordDeclaration;
	if (declaration.typeParameters.length > 0 || declaration.attributes.length > 0 || declaration.fields.some(field => field.attributes.length > 0)) return undefined;
	if (type.fields.size !== declaration.fields.length) return undefined;
	const fields: { name: string; primitive: FrontendHostPrimitiveName }[] = [];
	for (const field of declaration.fields) {
		const fieldType = type.fields.get(field.name);
		if (fieldType === undefined) return undefined;
		const primitive = frontendHostPrimitiveName(fieldType, semantic);
		if (primitive === undefined) return undefined;
		fields.push({ name: field.name, primitive });
	}
	return fields;
}

/**
 * Keep host-facing component values within the frontend boundary currently
 * supported by preserved JSX emission. This check is shared by single-file and
 * Project Build paths so one path cannot silently accept a wider boundary.
 */
export function validateFrontendComponentEmissionBoundary(
	module: A.ModuleNode,
	semantic: SemanticModel,
	diagnostics: DiagnosticBag,
): void {
	for (const declaration of module.declarations) {
		if (declaration.kind !== 'ComponentDeclaration') continue;
		const parameterNames = new Set(declaration.parameters.map(parameter => parameter.name));
		for (const parameter of declaration.parameters) {
			const symbol = parameter.symbolId === undefined ? undefined : semantic.symbols.get(parameter.symbolId);
			if (symbol !== undefined && (frontendHostPrimitiveName(symbol.typeId, semantic) !== undefined || frontendScalarRecordFields(symbol.typeId, semantic, parameter.type.name) !== undefined)) continue;
			const display = symbol === undefined ? '<unresolved>' : semantic.arena.display(symbol.typeId);
			diagnostics.error('L4309', `Component parameter ${parameter.name} has type ${display}; frontend JSX emission currently supports Bool, Int, Float, BigInt, String, direct non-mustUse source newtypes backed by those primitives, and non-generic unattributed source records containing only those scalar fields`, parameter.span);
		}
		const interpolation = findUnsupportedComponentInterpolation(declaration.body, parameterNames);
		if (interpolation?.kind === 'view-text') {
			diagnostics.error('L4309', 'Interpolated View text children are not available in frontend JSX emission; use an explicit View expression child instead', interpolation.span);
		} else if (interpolation !== undefined) {
			diagnostics.error('L4309', `Component parameter ${interpolation.name} cannot be referenced directly through string interpolation because component parameters remain host-backed at each use site; bind it to an explicit local value first`, interpolation.span);
		}
	}
}

function findUnsupportedComponentInterpolation(
	value: unknown,
	parameterNames: ReadonlySet<string>,
): { readonly kind: 'view-text'; readonly span: SourceSpan } | { readonly kind: 'host-parameter'; readonly name: string; readonly span: SourceSpan } | undefined {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findUnsupportedComponentInterpolation(item, parameterNames);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	if (value === null || typeof value !== 'object') return undefined;
	const node = value as Record<string, unknown>;
	if (node.kind === 'ViewTextChild' && typeof node.value === 'string' && /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\}(?!\})/u.test(node.value)) {
		return { kind: 'view-text', span: node.span as SourceSpan };
	}
	if (node.kind === 'LiteralExpression' && node.literalKind === 'String' && typeof node.value === 'string') {
		for (const match of node.value.matchAll(/(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}(?!\})/gu)) {
			const path = match[1];
			if (path === undefined) continue;
			const name = path.split('.')[0]!;
			if (parameterNames.has(name)) return { kind: 'host-parameter', name, span: node.span as SourceSpan };
		}
	}
	for (const [key, child] of Object.entries(node)) {
		if (key === 'span') continue;
		const found = findUnsupportedComponentInterpolation(child, parameterNames);
		if (found !== undefined) return found;
	}
	return undefined;
}
