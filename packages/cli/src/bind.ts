import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { formatSource } from '@virune/formatter';
import ts from 'typescript';

export interface BindOptions {
	readonly cwd: string;
	readonly input: string;
	readonly output?: string;
	readonly moduleSpecifier?: string;
}

export interface BindResult {
	readonly declarationPath: string;
	readonly outputPath: string;
	readonly moduleSpecifier: string;
	readonly generatedFunctions: number;
	readonly generatedRecords: number;
	readonly warnings: readonly string[];
	readonly unknownMappings: number;
}

interface ExportedDeclaration {
	readonly declaration: ts.Node;
	readonly exportName: string;
}

interface FunctionBinding {
	readonly name: string;
	readonly jsName: string;
	readonly parameters: readonly { readonly name: string; readonly type: string; readonly optional: boolean }[];
	readonly result: string;
	readonly async: boolean;
}

const reserved = new Set([
	'as', 'async', 'await', 'break', 'const', 'continue', 'defer', 'derives', 'discard', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'from', 'if', 'import', 'in', 'js', 'let', 'match', 'module', 'mut', 'newtype', 'parallel', 'pub', 'record', 'return', 'test', 'then', 'true', 'try', 'type', 'unsafe', 'uses', 'while', 'with',
	'Bool', 'Int', 'Float', 'BigInt', 'String', 'Unit', 'Unknown', 'Never', 'List', 'Map', 'Set', 'Option', 'Result', 'Validation', 'Stream', 'Json', 'Console', 'Debug', 'Task', 'Duration', 'Queue', 'Stack', 'File', 'Path', 'Process', 'Http', 'Fetch', 'Timer', 'Storage', 'Dom', 'Crypto', 'Bytes', 'MutableBytes', 'Some', 'None', 'Ok', 'Err', 'panic', 'expect',
]);

export async function generateBindings(options: BindOptions): Promise<BindResult> {
	const resolved = await resolveDeclaration(options.cwd, options.input, options.moduleSpecifier);
	const text = await readFile(resolved.path, 'utf8');
	const source = ts.createSourceFile(resolved.path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const warnings: string[] = [];
	const exportedDeclarations = collectExportedDeclarations(resolved.path, source, warnings);
	const records: string[] = [];
	const functions: FunctionBinding[] = [];
	const usedNames = new Map<string, number>();
	const usedTypeNames = new Set<string>();

	const emittedInterfaces = new Set<string>();
	for (const exported of exportedDeclarations) {
		const statement = exported.declaration;
		const exportName = exported.exportName;
		if (ts.isInterfaceDeclaration(statement)) {
			if (emittedInterfaces.has(exportName)) {
				warnings.push(`Declaration merging for interface ${exportName} is not yet representable; later declarations were skipped`);
				continue;
			}
			emittedInterfaces.add(exportName);
			const typeParameters = new Set((statement.typeParameters ?? []).map(parameter => parameter.name.text));
			const fields: string[] = [];
			for (const member of statement.members) {
				if (ts.isIndexSignatureDeclaration(member)) {
					warnings.push(`Index signature in ${exportName} was skipped; use a TypeScript adapter to convert the plain object explicitly`);
					continue;
				}
				if (ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member) || ts.isMethodSignature(member)) {
					warnings.push(`Callable or method member in ${exportName} was skipped`);
					continue;
				}
				if (!ts.isPropertySignature(member) || member.name === undefined) continue;
				const name = propertyName(member.name);
				if (name === undefined) { warnings.push(`Skipped computed property in ${exportName}`); continue; }
				let type = mapType(member.type, warnings, typeParameters);
				const optional = member.questionToken !== undefined;
				if (optional && !type.endsWith('?')) type += '?';
				fields.push(`${optional ? '\t@jsOptional\n' : ''}\t${safeIdentifier(name)}: ${type}`);
			}
			const parameters = renderTypeParameters(statement.typeParameters);
			if (fields.length > 0) {
				const typeName = safeTypeName(exportName);
				if (usedTypeNames.has(typeName)) warnings.push(`Duplicate exported type name ${typeName} was skipped`);
				else { usedTypeNames.add(typeName); records.push(`pub record ${typeName}${parameters} {\n${fields.join('\n')}\n}`); }
			}
			continue;
		}
		if (ts.isTypeAliasDeclaration(statement)) {
			const typeParameters = new Set((statement.typeParameters ?? []).map(parameter => parameter.name.text));
			const mapped = mapType(statement.type, warnings, typeParameters);
			if (mapped !== 'Unknown') {
				const typeName = safeTypeName(exportName);
				if (usedTypeNames.has(typeName)) warnings.push(`Duplicate exported type name ${typeName} was skipped`);
				else { usedTypeNames.add(typeName); records.push(`pub type ${typeName}${renderTypeParameters(statement.typeParameters)} = ${mapped}`); }
			}
			else warnings.push(`Skipped unsupported type alias ${exportName}`);
			continue;
		}
		if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
			if ((statement.typeParameters?.length ?? 0) > 0) warnings.push(`Generic function ${exportName} uses Unknown for unresolved type parameters`);
			functions.push(bindingFromSignature(exportName, exportName, statement.parameters, statement.type, usedNames, warnings, new Set((statement.typeParameters ?? []).map(parameter => parameter.name.text))));
			continue;
		}
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name) || declaration.type === undefined || !ts.isFunctionTypeNode(declaration.type)) continue;
				const parameters = new Set((declaration.type.typeParameters ?? []).map(parameter => parameter.name.text));
				if (parameters.size > 0) warnings.push(`Generic function ${exportName} uses Unknown for unresolved type parameters`);
				functions.push(bindingFromSignature(exportName, exportName, declaration.type.parameters, declaration.type.type, usedNames, warnings, parameters));
			}
			continue;
		}
		if (ts.isVariableDeclaration(statement) && ts.isIdentifier(statement.name) && statement.type !== undefined && ts.isFunctionTypeNode(statement.type)) {
			const parameters = new Set((statement.type.typeParameters ?? []).map(parameter => parameter.name.text));
			if (parameters.size > 0) warnings.push(`Generic function ${exportName} uses Unknown for unresolved type parameters`);
			functions.push(bindingFromSignature(exportName, exportName, statement.type.parameters, statement.type.type, usedNames, warnings, parameters));
			continue;
		}
		if (ts.isClassDeclaration(statement) && statement.name !== undefined) warnings.push(`Class ${exportName} requires a manual lifecycle-aware binding`);
		else if (ts.isModuleDeclaration(statement)) warnings.push(`Namespace ${statement.name.getText()} requires a manual nested-module binding`);
	}

	const validRecords = records.filter(record => {
		const errors = formatSource(`${record}\n`).errors;
		if (errors.length === 0) return true;
		warnings.push(`Generated type declaration was skipped because Virune could not parse it: ${singleLine(errors[0] ?? 'unknown formatting error')}`);
		return false;
	});
	const validFunctions = functions.filter(fn => {
		const errors = formatSource(renderBindings(resolved.moduleSpecifier, [], [fn], [])).errors;
		if (errors.length === 0) return true;
		warnings.push(`Generated function ${fn.name} was skipped because Virune could not parse it: ${singleLine(errors[0] ?? 'unknown formatting error')}`);
		return false;
	});
	const outputPath = resolve(options.cwd, options.output ?? `src/ffi/${fileNameFor(resolved.moduleSpecifier)}.virune`);
	const generated = renderBindings(resolved.moduleSpecifier, validRecords, validFunctions, warnings);
	const formatted = formatSource(generated);
	if (formatted.errors.length > 0) throw new Error(`Generated bindings could not be formatted after declaration filtering: ${formatted.errors.join(', ')}`);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, formatted.text, 'utf8');
	return { declarationPath: resolved.path, outputPath, moduleSpecifier: resolved.moduleSpecifier, generatedFunctions: validFunctions.length, generatedRecords: validRecords.length, warnings, unknownMappings: warnings.filter(warning => warning.includes('Unknown')).length };
}

function bindingFromSignature(
	baseName: string,
	jsName: string,
	parameters: readonly ts.ParameterDeclaration[],
	returnNode: ts.TypeNode | undefined,
	usedNames: Map<string, number>,
	warnings: string[],
	typeParameters: ReadonlySet<string> = new Set(),
): FunctionBinding {
	const count = (usedNames.get(baseName) ?? 0) + 1;
	usedNames.set(baseName, count);
	const name = safeIdentifier(count === 1 ? baseName : `${baseName}${count}`);
	const unwrapped = unwrapPromise(returnNode);
	return {
		name,
		jsName,
		parameters: parameters.map((parameter, index) => {
			const rawName = ts.isIdentifier(parameter.name) ? parameter.name.text : `arg${index + 1}`;
			let type = mapType(parameter.type, warnings, typeParameters, false);
			if (parameter.questionToken !== undefined && !type.endsWith('?')) type += '?';
			if (parameter.dotDotDotToken !== undefined) {
				warnings.push(`Rest parameter ${rawName} was mapped to List`);
				type = mapRestType(parameter.type, warnings, typeParameters);
			}
			return { name: safeIdentifier(rawName), type, optional: parameter.questionToken !== undefined };
		}),
		result: mapType(unwrapped.type, warnings, typeParameters, false),
		async: unwrapped.async,
	};
}

function renderBindings(moduleSpecifier: string, records: readonly string[], functions: readonly FunctionBinding[], warnings: readonly string[]): string {
	const lines: string[] = [
		'// Generated by virune bind. Review Unknown mappings before production use.',
		`// Source module: ${moduleSpecifier}`,
	];
	for (const warning of warnings) lines.push(`// WARNING: ${singleLine(warning)}`);
	if (records.length > 0) lines.push('', records.join('\n\n'));
	if (functions.length > 0) {
		lines.push('', `extern js ${JSON.stringify(moduleSpecifier)} {`);
		for (const fn of functions) {
			const parameters = fn.parameters.map(parameter => `${parameter.name}${parameter.optional ? '?' : ''}: ${parameter.type}`).join(', ');
			lines.push(`\t${fn.async ? 'async ' : ''}fn native${upperFirst(fn.name)}(${parameters}) -> Result<${fn.result}, JsError> uses JavaScript = ${JSON.stringify(fn.jsName)}`);
		}
		lines.push('}');
		for (const fn of functions) {
			const parameters = fn.parameters.map(parameter => `${parameter.name}: ${parameter.type}`).join(', ');
			const argumentsList = fn.parameters.map(parameter => parameter.name).join(', ');
			lines.push('', `pub ${fn.async ? 'async ' : ''}fn ${fn.name}(${parameters}) -> Result<${fn.result}, JsError> uses JavaScript {`, `\treturn ${fn.async ? 'await ' : ''}native${upperFirst(fn.name)}(${argumentsList})`, '}');
		}
	}
	if (records.length === 0 && functions.length === 0) lines.push('', '// No supported exported declarations were found.');
	return `${lines.join('\n')}\n`;
}

function mapType(
	node: ts.TypeNode | undefined,
	warnings: string[],
	typeParameters: ReadonlySet<string> = new Set(),
	preserveTypeParameters = true,
): string {
	if (node === undefined) return 'Unknown';
	if (ts.isParenthesizedTypeNode(node)) return mapType(node.type, warnings, typeParameters, preserveTypeParameters);
	if (ts.isArrayTypeNode(node)) return `List<${mapType(node.elementType, warnings, typeParameters, preserveTypeParameters)}>`;
	if (ts.isTupleTypeNode(node)) {
		warnings.push(`Tuple ${node.getText()} was mapped to Unknown because Virune FFI declarations do not expose tuple types`);
		return 'Unknown';
	}
	if (ts.isUnionTypeNode(node)) {
		const hasNull = node.types.some(isNullType);
		const hasUndefined = node.types.some(type => type.kind === ts.SyntaxKind.UndefinedKeyword);
		const nonEmpty = node.types.filter(type => !isNullishType(type));
		if (hasNull) { warnings.push(`Nullable union ${node.getText()} requires explicit null semantics and was mapped to Unknown`); return 'Unknown'; }
		if (hasUndefined && nonEmpty.length === 1) {
			const mapped = mapType(nonEmpty[0], warnings, typeParameters, preserveTypeParameters);
			return !mapped.endsWith('?') ? `${mapped}?` : mapped;
		}
		warnings.push(`Union ${node.getText()} was mapped to Unknown`);
		return 'Unknown';
	}
	if (ts.isIntersectionTypeNode(node)) { warnings.push(`Intersection ${node.getText()} was mapped to Unknown`); return 'Unknown'; }
	if (ts.isFunctionTypeNode(node)) { warnings.push(`Callback type ${node.getText()} requires a manual adapter and was mapped to Unknown`); return 'Unknown'; }
	if (ts.isLiteralTypeNode(node)) return mapType(literalBase(node.literal), warnings, typeParameters, preserveTypeParameters);
	if (ts.isTypeOperatorNode(node)) {
		if (node.operator === ts.SyntaxKind.ReadonlyKeyword) return mapType(node.type, warnings, typeParameters, preserveTypeParameters);
		warnings.push(`Type operator ${node.getText()} was mapped to Unknown`);
		return 'Unknown';
	}
	if (ts.isTypeReferenceNode(node)) {
		const name = node.typeName.getText();
		const argumentsList = node.typeArguments ?? [];
		if (typeParameters.has(name)) {
			if (preserveTypeParameters) return safeTypeName(name);
			warnings.push(`Type parameter ${name} was mapped to Unknown`);
			return 'Unknown';
		}
		if (name === 'Promise') return mapType(argumentsList[0], warnings, typeParameters, preserveTypeParameters);
		if (name === 'Array' || name === 'ReadonlyArray') return `List<${mapType(argumentsList[0], warnings, typeParameters, preserveTypeParameters)}>`;
		if (name === 'Set' || name === 'ReadonlySet') { const item = mapType(argumentsList[0], warnings, typeParameters, preserveTypeParameters); if (!isPrimitiveFfiName(item)) { warnings.push(`${name}<${item}> uses JavaScript identity semantics and was mapped to Unknown`); return 'Unknown'; } return `Set<${item}>`; }
		if (name === 'Map' || name === 'ReadonlyMap') { const key = mapType(argumentsList[0], warnings, typeParameters, preserveTypeParameters); const value = mapType(argumentsList[1], warnings, typeParameters, preserveTypeParameters); if (!isPrimitiveFfiName(key)) { warnings.push(`${name}<${key}, ${value}> uses JavaScript identity semantics and was mapped to Unknown`); return 'Unknown'; } return `Map<${key}, ${value}>`; }
		if (name === 'Record' && argumentsList.length === 2) { warnings.push(`Record ${node.getText()} is a plain JavaScript object and was mapped to Unknown`); return 'Unknown'; }
		if (name === 'AsyncIterable' || name === 'AsyncIterator' || name === 'IterableIterator') { warnings.push(`${name} requires an adapter and was mapped to Unknown`); return 'Unknown'; }
		if (name === 'Uint8Array' || name === 'Buffer') return 'Bytes';
		if (['Date', 'ArrayBuffer', 'object', 'Object'].includes(name)) { warnings.push(`${name} was mapped to Unknown`); return 'Unknown'; }
		return `${safeTypeName(name.split('.').at(-1) ?? name)}${argumentsList.length === 0 ? '' : `<${argumentsList.map(item => mapType(item, warnings, typeParameters, preserveTypeParameters)).join(', ')}>`}`;
	}
	if (ts.isTypeLiteralNode(node) || ts.isMappedTypeNode(node) || ts.isConditionalTypeNode(node) || ts.isIndexedAccessTypeNode(node) || ts.isTypeQueryNode(node)) {
		warnings.push(`Type ${node.getText()} was mapped to Unknown`);
		return 'Unknown';
	}
	switch (node.kind) {
		case ts.SyntaxKind.StringKeyword: return 'String';
		case ts.SyntaxKind.NumberKeyword: return 'Float';
		case ts.SyntaxKind.BooleanKeyword: return 'Bool';
		case ts.SyntaxKind.BigIntKeyword: return 'BigInt';
		case ts.SyntaxKind.VoidKeyword: return 'Unit';
		case ts.SyntaxKind.NeverKeyword: return 'Never';
		case ts.SyntaxKind.UnknownKeyword: case ts.SyntaxKind.AnyKeyword: case ts.SyntaxKind.ObjectKeyword: return 'Unknown';
		default: warnings.push(`Type ${node.getText()} was mapped to Unknown`); return 'Unknown';
	}
}

function mapRestType(node: ts.TypeNode | undefined, warnings: string[], typeParameters: ReadonlySet<string>): string {
	if (node !== undefined && ts.isParenthesizedTypeNode(node)) return mapRestType(node.type, warnings, typeParameters);
	if (node !== undefined && ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) return mapRestType(node.type, warnings, typeParameters);
	if (node !== undefined && ts.isArrayTypeNode(node)) return `List<${mapType(node.elementType, warnings, typeParameters, false)}>`;
	if (node !== undefined && ts.isTypeReferenceNode(node) && ['Array', 'ReadonlyArray'].includes(node.typeName.getText())) {
		return `List<${mapType(node.typeArguments?.[0], warnings, typeParameters, false)}>`;
	}
	return `List<${mapType(node, warnings, typeParameters, false)}>`;
}

function isPrimitiveFfiName(name: string): boolean { return ['String', 'Int', 'BigInt', 'Bool'].includes(name); }

function isNullType(node: ts.TypeNode): boolean { return node.kind === ts.SyntaxKind.NullKeyword || (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword); }

function isNullishType(node: ts.TypeNode): boolean {
	return node.kind === ts.SyntaxKind.UndefinedKeyword
		|| node.kind === ts.SyntaxKind.NullKeyword
		|| (ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword);
}

function renderTypeParameters(parameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined): string {
	if (parameters === undefined || parameters.length === 0) return '';
	return `<${parameters.map(parameter => safeTypeName(parameter.name.text)).join(', ')}>`;
}

function literalBase(node: ts.LiteralTypeNode['literal']): ts.TypeNode {
	if (ts.isStringLiteral(node)) return ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
	if (ts.isNumericLiteral(node)) return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
	if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
	return ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword);
}

function unwrapPromise(node: ts.TypeNode | undefined): { readonly type: ts.TypeNode | undefined; readonly async: boolean } {
	if (node !== undefined && ts.isTypeReferenceNode(node) && node.typeName.getText() === 'Promise') return { type: node.typeArguments?.[0], async: true };
	return { type: node, async: false };
}

function collectExportedDeclarations(path: string, fallbackSource: ts.SourceFile, warnings: string[]): readonly ExportedDeclaration[] {
	const program = ts.createProgram({
		rootNames: [path],
		options: {
			target: ts.ScriptTarget.Latest,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			skipLibCheck: true,
			allowJs: false,
		},
	});
	const source = program.getSourceFile(path) ?? fallbackSource;
	const checker = program.getTypeChecker();
	const moduleSymbol = checker.getSymbolAtLocation(source);
	if (moduleSymbol === undefined) {
		warnings.push('TypeScript could not resolve the declaration module exports; direct declarations were used');
		return source.statements.filter(isExported).map(statement => ({ declaration: statement, exportName: declarationName(statement) ?? 'default' }));
	}
	const result: ExportedDeclaration[] = [];
	const seen = new Set<string>();
	for (const exportedSymbol of checker.getExportsOfModule(moduleSymbol)) {
		let target = exportedSymbol;
		if ((exportedSymbol.flags & ts.SymbolFlags.Alias) !== 0) {
			try { target = checker.getAliasedSymbol(exportedSymbol); }
			catch { target = exportedSymbol; }
		}
		for (const declaration of target.getDeclarations() ?? exportedSymbol.getDeclarations() ?? []) {
			if (!isSupportedExportDeclaration(declaration)) continue;
			const key = `${exportedSymbol.name}:${declaration.getSourceFile().fileName}:${declaration.pos}:${declaration.end}`;
			if (seen.has(key)) continue;
			seen.add(key);
			result.push({ declaration, exportName: exportedSymbol.name });
		}
	}
	return result;
}

function isSupportedExportDeclaration(declaration: ts.Node): boolean {
	return ts.isInterfaceDeclaration(declaration)
		|| ts.isTypeAliasDeclaration(declaration)
		|| ts.isFunctionDeclaration(declaration)
		|| ts.isVariableDeclaration(declaration)
		|| ts.isVariableStatement(declaration)
		|| ts.isClassDeclaration(declaration)
		|| ts.isModuleDeclaration(declaration);
}

function declarationName(declaration: ts.Node): string | undefined {
	if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration) || ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)) return declaration.name?.text;
	if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) return declaration.name.text;
	if (ts.isModuleDeclaration(declaration)) return declaration.name.getText();
	return undefined;
}

async function resolveDeclaration(cwd: string, input: string, explicitModule?: string): Promise<{ readonly path: string; readonly moduleSpecifier: string }> {
	const direct = isAbsolute(input) ? input : resolve(cwd, input);
	if (existsSync(direct)) return { path: direct, moduleSpecifier: explicitModule ?? relative(cwd, direct).replaceAll('\\', '/') };
	const packageName = packageNameFromSpecifier(input);
	const packageDirectory = findPackageDirectory(cwd, packageName);
	if (packageDirectory !== undefined) {
		const packageJson = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as {
			readonly name?: string;
			readonly types?: string;
			readonly typings?: string;
			readonly exports?: unknown;
		};
		const declarationPath = resolveTypesPath(packageDirectory, [packageJson.types, packageJson.typings, exportedTypesEntry(packageJson.exports), 'index.d.ts']);
		if (declarationPath !== undefined) return { path: declarationPath, moduleSpecifier: explicitModule ?? packageJson.name ?? packageName };
	}
	const require = createRequire(join(cwd, 'package.json'));
	const entry = require.resolve(input, { paths: [cwd] });
	let directory = dirname(entry);
	while (dirname(directory) !== directory && !existsSync(join(directory, 'package.json'))) directory = dirname(directory);
	const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { readonly name?: string; readonly types?: string; readonly typings?: string; readonly exports?: unknown };
	const declarationPath = resolveTypesPath(directory, [packageJson.types, packageJson.typings, exportedTypesEntry(packageJson.exports)]);
	if (declarationPath === undefined) {
		const sibling = entry.replace(/\.(?:mjs|cjs|js)$/u, '.d.ts');
		if (!existsSync(sibling)) throw new Error(`Package ${input} does not declare a types entry`);
		return { path: sibling, moduleSpecifier: explicitModule ?? input };
	}
	return { path: declarationPath, moduleSpecifier: explicitModule ?? packageJson.name ?? input };
}

function resolveTypesPath(packageDirectory: string, candidates: readonly (string | undefined)[]): string | undefined {
	for (const candidate of candidates) {
		if (candidate === undefined) continue;
		const path = resolve(packageDirectory, candidate);
		if (existsSync(path)) return path;
		if (existsSync(`${path}.d.ts`)) return `${path}.d.ts`;
	}
	return undefined;
}

function packageNameFromSpecifier(specifier: string): string {
	const segments = specifier.split('/');
	return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0] ?? specifier;
}

function findPackageDirectory(cwd: string, packageName: string): string | undefined {
	let current = resolve(cwd);
	while (true) {
		const candidate = join(current, 'node_modules', packageName);
		if (existsSync(join(candidate, 'package.json'))) return candidate;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function exportedTypesEntry(exportsValue: unknown): string | undefined {
	if (exportsValue === null || typeof exportsValue !== 'object' || Array.isArray(exportsValue)) return undefined;
	const record = exportsValue as Record<string, unknown>;
	const root = Object.hasOwn(record, '.') ? record['.'] : exportsValue;
	if (root === null || typeof root !== 'object' || Array.isArray(root)) return undefined;
	const types = (root as Record<string, unknown>).types;
	return typeof types === 'string' ? types : undefined;
}

function isExported(node: ts.Node): boolean {
	return (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true) || node.getSourceFile().isDeclarationFile;
}

function propertyName(name: ts.PropertyName): string | undefined {
	if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
	return undefined;
}

function singleLine(value: string): string { return value.replace(/\s+/gu, ' ').trim(); }

function safeIdentifier(value: string): string {
	let result = value.replace(/[^A-Za-z0-9_]/gu, '_');
	if (!/^[A-Za-z_]/u.test(result)) result = `value_${result}`;
	if (reserved.has(result)) result = `${result}Value`;
	return result;
}
function safeTypeName(value: string): string { const name = safeIdentifier(value); return upperFirst(name); }
function upperFirst(value: string): string { return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`; }
function fileNameFor(value: string): string { return basename(value).replace(/^@/u, '').replace(/[^A-Za-z0-9_-]/gu, '-'); }
