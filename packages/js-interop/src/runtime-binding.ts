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
		| 'BUILTIN_NAMED_UNVERIFIED'
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
		| 'SOURCE_PARSE_ERROR'
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
	if (request.runtimeFormat === 'builtin') {
		if (request.kind === 'named') return { status: 'unknown', reason: 'BUILTIN_NAMED_UNVERIFIED', ...(request.importedName === undefined ? {} : { exportName: request.importedName }) };
		return { status: 'verified-static', reason: 'BUILTIN_MODULE' };
	}
	if (request.kind === 'side-effect' || request.kind === 'namespace') {
		if (request.sourceText !== undefined || request.sourcePath !== undefined) return { status: 'verified-static', reason: 'MODULE_ENTRY_PRESENT' };
		return { status: 'unknown', reason: 'SOURCE_UNAVAILABLE' };
	}
	if (request.sourceText === undefined) return { status: 'unknown', reason: 'SOURCE_UNAVAILABLE' };
	if (request.runtimeFormat === 'esm') return verifyEsm(request);
	if (request.runtimeFormat === 'commonjs') return verifyCommonJs(request);
	return { status: 'unknown', reason: 'FORMAT_UNSUPPORTED' };
}

function verifyEsm(request: RuntimeBindingRequest): RuntimeBindingEvidence {
	const source = parseSource(request, 'module.mjs');
	if (hasParseErrors(source)) return withName(request, 'unknown', 'SOURCE_PARSE_ERROR');
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
		if (ts.isNamespaceExport(statement.exportClause) && statement.exportClause.name.text === name) {
			return { status: 'unknown', reason: 'ESM_REEXPORT_UNKNOWN', exportName: name };
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

function verifyCommonJs(request: RuntimeBindingRequest): RuntimeBindingEvidence {
	const source = parseSource(request, 'module.cjs');
	if (hasParseErrors(source)) return withName(request, 'unknown', 'SOURCE_PARSE_ERROR');
	if (request.kind === 'default') {
		if (containsDynamicCode(source)) return { status: 'unknown', reason: 'DYNAMIC_CJS_EXPORT', exportName: 'default' };
		return { status: 'verified-static', reason: 'CJS_MODULE_EXPORT', exportName: 'default' };
	}
	const name = request.importedName;
	if (request.kind !== 'named' || !name) return { status: 'unknown', reason: 'BINDING_ABSENT' };

	let state: RuntimeBindingStatus = 'absent';
	let reason: RuntimeBindingEvidence['reason'] = 'BINDING_ABSENT';
	let exportsAliasIntact = true;
	let moduleExportsKnownObject = true;

	for (const statement of source.statements) {
		if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
			const expression = statement.expression;
			const left = expression.left;
			if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
				if (ts.isIdentifier(left) && left.text === 'exports') {
					exportsAliasIntact = false;
					continue;
				}
				if (isModuleExports(left)) {
					exportsAliasIntact = false;
					if (ts.isObjectLiteralExpression(expression.right)) {
						moduleExportsKnownObject = true;
						state = objectHasProperty(expression.right, name) ? 'verified-static' : 'absent';
						reason = state === 'verified-static' ? 'CJS_OBJECT_EXPORT' : 'BINDING_ABSENT';
					} else {
						moduleExportsKnownObject = false;
						state = 'unknown';
						reason = 'DYNAMIC_CJS_EXPORT';
					}
					continue;
				}
				const target = namedExportTarget(left, name);
				if (target === 'exports') {
					if (exportsAliasIntact) {
						state = 'verified-static';
						reason = 'CJS_NAMED_ASSIGNMENT';
					}
					continue;
				}
				if (target === 'module.exports') {
					state = moduleExportsKnownObject ? 'verified-static' : 'unknown';
					reason = state === 'verified-static' ? 'CJS_NAMED_ASSIGNMENT' : 'DYNAMIC_CJS_EXPORT';
					continue;
				}
			}
			if (referencesExportsTarget(left)) {
				state = 'unknown';
				reason = 'DYNAMIC_CJS_EXPORT';
				continue;
			}
		}
		if (containsPotentialExportMutation(statement)) {
			state = 'unknown';
			reason = 'DYNAMIC_CJS_EXPORT';
		}
	}
	return { status: state, reason, exportName: name };
}

function parseSource(request: RuntimeBindingRequest, fallback: string): ts.SourceFile {
	return ts.createSourceFile(request.sourcePath ?? fallback, request.sourceText ?? '', ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function hasParseErrors(source: ts.SourceFile): boolean {
	const parsed = source as ts.SourceFile & { readonly parseDiagnostics?: readonly unknown[] };
	return (parsed.parseDiagnostics?.length ?? 0) > 0;
}

function withName(request: RuntimeBindingRequest, status: RuntimeBindingStatus, reason: RuntimeBindingEvidence['reason']): RuntimeBindingEvidence {
	return { status, reason, ...(request.kind === 'default' ? { exportName: 'default' } : request.importedName === undefined ? {} : { exportName: request.importedName }) };
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

function isModuleExports(node: ts.Expression): boolean {
	return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'module' && node.name.text === 'exports';
}

type ExportTarget = 'exports' | 'module.exports' | undefined;

function namedExportTarget(node: ts.Expression, name: string): ExportTarget {
	if (ts.isPropertyAccessExpression(node)) {
		if (ts.isIdentifier(node.expression) && node.expression.text === 'exports' && node.name.text === name) return 'exports';
		if (isModuleExports(node.expression) && node.name.text === name) return 'module.exports';
	}
	if (ts.isElementAccessExpression(node) && node.argumentExpression !== undefined && ts.isStringLiteralLike(node.argumentExpression)) {
		if (node.argumentExpression.text !== name) return undefined;
		if (ts.isIdentifier(node.expression) && node.expression.text === 'exports') return 'exports';
		if (isModuleExports(node.expression)) return 'module.exports';
	}
	return undefined;
}

function referencesExportsTarget(node: ts.Node): boolean {
	if (isExportsObject(node)) return true;
	let found = false;
	node.forEachChild(child => {
		if (!found && referencesExportsTarget(child)) found = true;
	});
	return found;
}

function isExportsObject(node: ts.Node): boolean {
	if (ts.isIdentifier(node) && node.text === 'exports') return true;
	return ts.isPropertyAccessExpression(node) && isModuleExports(node);
}

function containsPotentialExportMutation(node: ts.Node): boolean {
	if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval') return true;
	if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Function') return true;
	if (ts.isBinaryExpression(node) && referencesExportsTarget(node.left)) return true;
	if (ts.isCallExpression(node) && node.arguments.some(argument => referencesExportsTarget(argument))) return true;
	let found = false;
	node.forEachChild(child => {
		if (!found && containsPotentialExportMutation(child)) found = true;
	});
	return found;
}

function containsDynamicCode(source: ts.SourceFile): boolean {
	return source.statements.some(statement => containsPotentialExportMutation(statement) && !isSimpleTopLevelModuleExportAssignment(statement));
}

function isSimpleTopLevelModuleExportAssignment(statement: ts.Statement): boolean {
	return ts.isExpressionStatement(statement)
		&& ts.isBinaryExpression(statement.expression)
		&& statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
		&& isModuleExports(statement.expression.left);
}

function objectHasProperty(object: ts.ObjectLiteralExpression, name: string): boolean {
	return object.properties.some(property => objectPropertyName(property) === name);
}

function objectPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
	if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
	if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property) && !ts.isGetAccessorDeclaration(property) && !ts.isSetAccessorDeclaration(property)) return undefined;
	const name = property.name;
	if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
	return undefined;
}
