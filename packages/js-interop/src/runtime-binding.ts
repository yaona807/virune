import ts from 'typescript';

export type RuntimeModuleFormat = 'esm' | 'commonjs' | 'builtin' | 'bundler' | 'unknown';
export type RuntimeBindingKind = 'named' | 'default' | 'namespace' | 'side-effect' | 'type-only';
export type RuntimeBindingStatus = 'verified-static' | 'absent' | 'unknown' | 'not-applicable';

export interface RuntimeBindingRequest {
	readonly sourceText?: string;
	readonly sourcePath?: string;
	readonly runtimeFormat: RuntimeModuleFormat;
	readonly kind: RuntimeBindingKind;
	readonly importedName?: string;
}

export interface RuntimeBindingEvidence {
	readonly status: RuntimeBindingStatus;
	readonly reason:
		| 'TYPE_ONLY'
		| 'BUILTIN_MODULE'
		| 'MODULE_ENTRY_PRESENT'
		| 'ESM_DECLARATION_EXPORT'
		| 'ESM_EXPORT_LIST'
		| 'ESM_DEFAULT_EXPORT'
		| 'ESM_REEXPORT_UNKNOWN'
		| 'ESM_EXPORT_STAR_UNKNOWN'
		| 'CJS_NAMED_ASSIGNMENT'
		| 'CJS_OBJECT_EXPORT'
		| 'CJS_MODULE_EXPORT'
		| 'DYNAMIC_CJS_EXPORT'
		| 'BINDING_ABSENT'
		| 'SOURCE_UNAVAILABLE'
		| 'FORMAT_UNSUPPORTED';
	readonly exportName?: string;
}

/**
 * Proves only static export/binding presence. It never executes the module and
 * never claims that top-level evaluation succeeds or that the declaration
 * contract matches runtime values.
 */
export function verifyStaticRuntimeBinding(request: RuntimeBindingRequest): RuntimeBindingEvidence {
	if (request.kind === 'type-only') return { status: 'not-applicable', reason: 'TYPE_ONLY' };
	if (request.runtimeFormat === 'builtin') return bindingIndependent(request, 'BUILTIN_MODULE');
	if (request.kind === 'side-effect' || request.kind === 'namespace') {
		if (request.sourceText !== undefined || request.sourcePath !== undefined) return { status: 'verified-static', reason: 'MODULE_ENTRY_PRESENT' };
		return { status: 'unknown', reason: 'SOURCE_UNAVAILABLE' };
	}
	if (request.sourceText === undefined) return { status: 'unknown', reason: 'SOURCE_UNAVAILABLE' };
	if (request.runtimeFormat === 'esm') return verifyEsm(request);
	if (request.runtimeFormat === 'commonjs') return verifyCommonJs(request);
	return { status: 'unknown', reason: 'FORMAT_UNSUPPORTED' };
}

function bindingIndependent(request: RuntimeBindingRequest, reason: RuntimeBindingEvidence['reason']): RuntimeBindingEvidence {
	if (request.kind === 'named' && !request.importedName) return { status: 'unknown', reason: 'BINDING_ABSENT' };
	return { status: 'verified-static', reason, ...(request.importedName === undefined ? {} : { exportName: request.importedName }) };
}

function verifyEsm(request: RuntimeBindingRequest): RuntimeBindingEvidence {
	const source = ts.createSourceFile(request.sourcePath ?? 'module.mjs', request.sourceText ?? '', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	if (request.kind === 'default') {
		for (const statement of source.statements) {
			if (ts.isExportAssignment(statement) && !statement.isExportEquals) return { status: 'verified-static', reason: 'ESM_DEFAULT_EXPORT', exportName: 'default' };
			if (hasDefaultModifier(statement)) return { status: 'verified-static', reason: 'ESM_DEFAULT_EXPORT', exportName: 'default' };
			if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
				for (const element of statement.exportClause.elements) {
					if (element.name.text !== 'default') continue;
					if (statement.moduleSpecifier !== undefined) return { status: 'unknown', reason: 'ESM_REEXPORT_UNKNOWN', exportName: 'default' };
					return { status: 'verified-static', reason: 'ESM_EXPORT_LIST', exportName: 'default' };
				}
			}
		}
		return { status: 'absent', reason: 'BINDING_ABSENT', exportName: 'default' };
	}
	const name = request.importedName;
	if (request.kind !== 'named' || !name) return { status: 'unknown', reason: 'BINDING_ABSENT' };
	let starReexport = false;
	for (const statement of source.statements) {
		if (statementExportsName(statement, name)) return { status: 'verified-static', reason: 'ESM_DECLARATION_EXPORT', exportName: name };
		if (!ts.isExportDeclaration(statement)) continue;
		if (statement.exportClause === undefined) {
			starReexport = true;
			continue;
		}
		if (!ts.isNamedExports(statement.exportClause)) continue;
		for (const element of statement.exportClause.elements) {
			if (element.name.text !== name) continue;
			if (statement.moduleSpecifier !== undefined) return { status: 'unknown', reason: 'ESM_REEXPORT_UNKNOWN', exportName: name };
			return { status: 'verified-static', reason: 'ESM_EXPORT_LIST', exportName: name };
		}
	}
	if (starReexport) return { status: 'unknown', reason: 'ESM_EXPORT_STAR_UNKNOWN', exportName: name };
	return { status: 'absent', reason: 'BINDING_ABSENT', exportName: name };
}

function statementExportsName(statement: ts.Statement, name: string): boolean {
	if (!hasExportModifier(statement)) return false;
	if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) return statement.name?.text === name;
	if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(item => ts.isIdentifier(item.name) && item.name.text === name);
	return false;
}

function hasExportModifier(node: ts.Node): boolean {
	return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(item => item.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function hasDefaultModifier(node: ts.Node): boolean {
	if (!hasExportModifier(node) || !ts.canHaveModifiers(node)) return false;
	return ts.getModifiers(node)?.some(item => item.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function verifyCommonJs(request: RuntimeBindingRequest): RuntimeBindingEvidence {
	const source = ts.createSourceFile(request.sourcePath ?? 'module.cjs', request.sourceText ?? '', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	if (request.kind === 'default') {
		for (const statement of source.statements) {
			if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression) || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
			if (isModuleExports(statement.expression.left)) return { status: 'verified-static', reason: 'CJS_MODULE_EXPORT', exportName: 'default' };
		}
		return { status: 'unknown', reason: 'DYNAMIC_CJS_EXPORT', exportName: 'default' };
	}
	const name = request.importedName;
	if (request.kind !== 'named' || !name) return { status: 'unknown', reason: 'BINDING_ABSENT' };
	let dynamicModuleExports = false;
	for (const statement of source.statements) {
		if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression) || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
		const { left, right } = statement.expression;
		if (isNamedExportsAssignment(left, name)) return { status: 'verified-static', reason: 'CJS_NAMED_ASSIGNMENT', exportName: name };
		if (!isModuleExports(left)) continue;
		if (ts.isObjectLiteralExpression(right)) {
			for (const property of right.properties) {
				if (objectPropertyName(property) === name) return { status: 'verified-static', reason: 'CJS_OBJECT_EXPORT', exportName: name };
			}
			return { status: 'absent', reason: 'BINDING_ABSENT', exportName: name };
		}
		dynamicModuleExports = true;
	}
	return dynamicModuleExports
		? { status: 'unknown', reason: 'DYNAMIC_CJS_EXPORT', exportName: name }
		: { status: 'absent', reason: 'BINDING_ABSENT', exportName: name };
}

function isModuleExports(node: ts.Expression): boolean {
	return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'module' && node.name.text === 'exports';
}

function isNamedExportsAssignment(node: ts.Expression, name: string): boolean {
	if (ts.isPropertyAccessExpression(node)) {
		if (ts.isIdentifier(node.expression) && node.expression.text === 'exports' && node.name.text === name) return true;
		return isModuleExports(node.expression) && node.name.text === name;
	}
	if (ts.isElementAccessExpression(node) && node.argumentExpression !== undefined && ts.isStringLiteralLike(node.argumentExpression)) {
		if (ts.isIdentifier(node.expression) && node.expression.text === 'exports') return node.argumentExpression.text === name;
		return isModuleExports(node.expression) && node.argumentExpression.text === name;
	}
	return false;
}

function objectPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
	if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
	if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property) && !ts.isGetAccessorDeclaration(property) && !ts.isSetAccessorDeclaration(property)) return undefined;
	const name = property.name;
	if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
	return undefined;
}
