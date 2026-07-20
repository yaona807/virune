import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import type {
	ForeignCallResolution,
	ForeignPrimitiveKind,
	ForeignTypeRef,
	ForeignTypeSnapshot,
	InteropArgumentType,
	JsImportRequest,
	JsImportResolution,
	JsInteropProvider,
	ModuleResolutionWitness,
} from '@virune/compiler/experimental';

export interface TypeScriptInteropProviderOptions {
	readonly projectRoot: string;
	readonly compilerOptions?: ts.CompilerOptions;
	readonly providerId?: string;
	readonly generation?: number;
}

interface StoredType {
	readonly type: ts.Type;
	readonly checker: ts.TypeChecker;
	readonly location: ts.Node;
	readonly origin: ForeignTypeSnapshot['origin'];
}

interface Probe {
	readonly program: ts.Program;
	readonly checker: ts.TypeChecker;
	readonly sourceFile: ts.SourceFile;
	readonly valueNode?: ts.Node;
	readonly typeNode?: ts.TypeNode;
	readonly resolvedModule?: ts.ResolvedModuleFull;
}

/**
 * Conservative provider: complex overloads, callbacks, and contextual typing
 * deliberately return undefined so the compiler can request an interop adapter.
 */
export class TypeScriptInteropProvider implements JsInteropProvider {
	readonly id: string;
	readonly version = `typescript-${ts.version}`;
	readonly generation: number;
	readonly #projectRoot: string;
	readonly #compilerOptions: ts.CompilerOptions;
	readonly #types = new Map<string, StoredType>();
	#nextTypeId = 1;

	public constructor(options: TypeScriptInteropProviderOptions) {
		this.id = options.providerId ?? 'typescript';
		this.generation = options.generation ?? 1;
		this.#projectRoot = resolve(options.projectRoot);
		this.#compilerOptions = {
			target: ts.ScriptTarget.ES2022,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			strict: true,
			strictNullChecks: true,
			exactOptionalPropertyTypes: true,
			noUncheckedIndexedAccess: true,
			skipLibCheck: false,
			allowJs: true,
			checkJs: true,
			allowImportingTsExtensions: true,
			noEmit: true,
			types: [],
			...options.compilerOptions,
		};
	}

	public resolveImport(request: JsImportRequest): JsImportResolution {
		const probe = this.createProbe(request);
		const witness = this.moduleWitness(request, probe.resolvedModule);
		const runtime = request.kind === 'named'
			? { kind: 'named' as const, importedName: request.importedName ?? '' }
			: request.kind === 'default' ? { kind: 'default' as const }
				: request.kind === 'namespace' ? { kind: 'namespace' as const }
					: request.kind === 'side-effect' ? { kind: 'side-effect' as const }
						: { kind: 'type-only' as const };
		if (request.kind === 'side-effect') return { runtime, witness };
		const node = probe.valueNode ?? probe.typeNode;
		if (node === undefined) return { runtime, witness };
		const type = probe.typeNode === undefined ? probe.checker.getTypeAtLocation(node) : probe.checker.getTypeFromTypeNode(probe.typeNode);
		return { type: this.store(type, probe.checker, node, { moduleSpecifier: request.moduleSpecifier, ...(request.importedName === undefined ? {} : { exportName: request.importedName }), ...(probe.resolvedModule?.resolvedFileName === undefined ? {} : { declarationPath: probe.resolvedModule.resolvedFileName }) }), runtime, witness };
	}

	public getProperty(reference: ForeignTypeRef, name: string): ForeignTypeSnapshot | undefined {
		const stored = this.requireType(reference);
		const property = stored.checker.getPropertyOfType(stored.type, name);
		if (property === undefined) return undefined;
		const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? stored.location;
		return this.store(stored.checker.getTypeOfSymbolAtLocation(property, declaration), stored.checker, declaration, stored.origin);
	}

	public resolveCall(reference: ForeignTypeRef, argumentsList: readonly InteropArgumentType[]): ForeignCallResolution | undefined {
		return this.resolveSignature(reference, argumentsList, false);
	}

	public resolveConstruct(reference: ForeignTypeRef, argumentsList: readonly InteropArgumentType[]): ForeignCallResolution | undefined {
		return this.resolveSignature(reference, argumentsList, true);
	}

	public getAwaitedType(reference: ForeignTypeRef): ForeignTypeSnapshot | undefined {
		const stored = this.requireType(reference);
		const awaited = stored.checker.getAwaitedType(stored.type);
		if (awaited === undefined || awaited === stored.type) return undefined;
		return this.store(awaited, stored.checker, stored.location, stored.origin);
	}

	public display(reference: ForeignTypeRef): string {
		const stored = this.requireType(reference);
		return stored.checker.typeToString(stored.type, stored.location, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
	}

	private resolveSignature(reference: ForeignTypeRef, argumentsList: readonly InteropArgumentType[], construct: boolean): ForeignCallResolution | undefined {
		const stored = this.requireType(reference);
		const signatures = stored.type.getCallSignatures ? (construct ? stored.type.getConstructSignatures() : stored.type.getCallSignatures()) : [];
		const compatible = signatures.filter(signature => this.signatureAccepts(signature, argumentsList, stored.checker));
		if (compatible.length !== 1) return undefined;
		const signature = compatible[0]!;
		const rawResult = stored.checker.getReturnTypeOfSignature(signature);
		const result = this.conservativeGenericResult(signature, rawResult, stored.checker);
		if (result === undefined) return undefined;
		const parameters = signature.getParameters();
		const optional = parameters.filter(parameter => (parameter.flags & ts.SymbolFlags.Optional) !== 0 || parameter.valueDeclaration !== undefined && ts.isParameter(parameter.valueDeclaration) && (parameter.valueDeclaration.questionToken !== undefined || parameter.valueDeclaration.initializer !== undefined)).length;
		const lastDeclaration = parameters.at(-1)?.valueDeclaration;
		const rest = lastDeclaration !== undefined && ts.isParameter(lastDeclaration) && lastDeclaration.dotDotDotToken !== undefined;
		const resultSnapshot = this.store(result, stored.checker, signature.declaration ?? stored.location, stored.origin);
		return { result: resultSnapshot, parameterCount: parameters.length, optionalParameterCount: optional, rest, mayReject: resultSnapshot.category === 'promise', receiverMode: construct ? 'none' : 'preserve-this' };
	}


	private conservativeGenericResult(signature: ts.Signature, result: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
		const parameters = signature.getTypeParameters() ?? [];
		if (parameters.length === 0) return result;
		// Tier 1 only accepts generic calls whose result can be resolved without
		// Virune's expected return type. This covers return-only generic brands
		// such as nanoid's `<Type extends string>() => Type` while avoiding
		// bidirectional inference with TypeScript.
		if ((result.getFlags() & ts.TypeFlags.TypeParameter) === 0) return undefined;
		const parameter = parameters.find(item => item === result);
		if (parameter === undefined) return undefined;
		for (const symbol of signature.getParameters()) {
			const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
			if (declaration === undefined) continue;
			const parameterType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
			if (typeContainsTypeParameter(parameterType, parameter, new Set())) return undefined;
		}
		const defaultType = checker.getDefaultFromTypeParameter(parameter);
		if (defaultType !== undefined) return defaultType;
		return checker.getBaseConstraintOfType(parameter);
	}

	private signatureAccepts(signature: ts.Signature, argumentsList: readonly InteropArgumentType[], checker: ts.TypeChecker): boolean {
		const parameters = signature.getParameters();
		const required = parameters.filter(parameter => (parameter.flags & ts.SymbolFlags.Optional) === 0 && !(parameter.valueDeclaration !== undefined && ts.isParameter(parameter.valueDeclaration) && (parameter.valueDeclaration.questionToken !== undefined || parameter.valueDeclaration.initializer !== undefined || parameter.valueDeclaration.dotDotDotToken !== undefined))).length;
		const lastDeclaration = parameters.at(-1)?.valueDeclaration;
		const hasRest = lastDeclaration !== undefined && ts.isParameter(lastDeclaration) && lastDeclaration.dotDotDotToken !== undefined;
		if (argumentsList.length < required || (!hasRest && argumentsList.length > parameters.length)) return false;
		for (let index = 0; index < Math.min(argumentsList.length, parameters.length); index++) {
			const parameter = parameters[Math.min(index, parameters.length - 1)]!;
			const location = parameter.valueDeclaration ?? parameter.declarations?.[0];
			if (location === undefined) continue;
			const parameterType = checker.getTypeOfSymbolAtLocation(parameter, location);
			if (!this.argumentCompatible(argumentsList[index]!, parameterType, checker)) return false;
		}
		return true;
	}

	private argumentCompatible(argument: InteropArgumentType, parameter: ts.Type, checker: ts.TypeChecker): boolean {
		const parameterFlags = parameter.getFlags();
		if ((parameterFlags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
		if (parameter.isUnion()) return parameter.types.some(item => this.argumentCompatible(argument, item, checker));
		if (argument.kind === 'unknown') return false;
		if (argument.kind === 'foreign') {
			const source = this.requireType(argument.type);
			if (source.checker === checker) return checker.isTypeAssignableTo(source.type, parameter);
			// Different TypeScript Programs do not share type identity. Preserve safety by
			// accepting only exact primitive views or broad JS boundary types.
			const sourcePrimitive = primitiveKind(source.type);
			const parameterPrimitive = primitiveKind(parameter);
			if (sourcePrimitive !== undefined || parameterPrimitive !== undefined) return sourcePrimitive === parameterPrimitive;
			const flags = parameter.getFlags();
			return (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.NonPrimitive)) !== 0;
		}
		const flags = parameter.getFlags();
		switch (argument.primitive) {
			case 'Bool': return (flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0;
			case 'String': return (flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0;
			case 'Int': case 'Float': return (flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0;
			case 'BigInt': return (flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) !== 0;
			case 'Unit': return (flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0;
		}
	}

	private createProbe(request: JsImportRequest): Probe {
		const compilerOptions: ts.CompilerOptions = { ...this.#compilerOptions, types: request.platform === 'node' ? ['node'] : [] };
		const virtualPath = join(dirname(request.containingFile), `.virune-interop-${hash(`${request.moduleSpecifier}:${request.kind}:${request.importedName ?? ''}`)}.ts`);
		const moduleText = JSON.stringify(request.moduleSpecifier);
		const sourceText = request.kind === 'named'
			? `import { ${safeTsName(request.importedName ?? '')} as __viruneValue } from ${moduleText};\n__viruneValue;`
			: request.kind === 'default' ? `import __viruneValue from ${moduleText};\n__viruneValue;`
				: request.kind === 'namespace' ? `import * as __viruneValue from ${moduleText};\n__viruneValue;`
					: request.kind === 'type-only' ? `import type { ${safeTsName(request.importedName ?? '')} as __ViruneType } from ${moduleText};\ntype __ViruneAlias = __ViruneType;`
						: `import ${moduleText};`;
		const host = ts.createCompilerHost(compilerOptions, true);
		const virtualFileKey = canonicalFilePath(virtualPath);
		const isVirtualFile = (fileName: string): boolean => canonicalFilePath(fileName) === virtualFileKey;
		const originalFileExists = host.fileExists.bind(host);
		const originalReadFile = host.readFile.bind(host);
		const originalGetSourceFile = host.getSourceFile.bind(host);
		host.fileExists = fileName => isVirtualFile(fileName) || originalFileExists(fileName);
		host.readFile = fileName => isVirtualFile(fileName) ? sourceText : originalReadFile(fileName);
		host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => isVirtualFile(fileName)
			? ts.createSourceFile(fileName, sourceText, languageVersion, true, ts.ScriptKind.TS)
			: originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
		const program = ts.createProgram({ rootNames: [virtualPath], options: compilerOptions, host });
		const diagnostics = ts.getPreEmitDiagnostics(program);
		const errors = diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error);
		if (errors.length > 0) throw new Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('; '));
		const sourceFile = program.getSourceFiles().find(item => isVirtualFile(item.fileName));
		if (sourceFile === undefined) throw new Error('TypeScript interop probe was not created');
		const checker = program.getTypeChecker();
		const expression = sourceFile.statements.find(ts.isExpressionStatement)?.expression;
		const alias = sourceFile.statements.find(ts.isTypeAliasDeclaration)?.type;
		const resolved = ts.resolveModuleName(request.moduleSpecifier, virtualPath, compilerOptions, ts.sys).resolvedModule;
		return { program, checker, sourceFile, ...(expression === undefined ? {} : { valueNode: expression }), ...(alias === undefined ? {} : { typeNode: alias }), ...(resolved === undefined ? {} : { resolvedModule: resolved }) };
	}

	private store(type: ts.Type, checker: ts.TypeChecker, location: ts.Node, origin: ForeignTypeSnapshot['origin']): ForeignTypeSnapshot {
		const id = String(this.#nextTypeId++);
		const ref: ForeignTypeRef = { providerId: this.id, generation: this.generation, id };
		this.#types.set(id, { type, checker, location, origin });
		const display = checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
		const primitive = primitiveKind(type);
		const awaited = checker.getAwaitedType(type);
		const category = primitive !== undefined ? 'primitive'
			: type.getCallSignatures().length > 0 ? 'function'
				: type.getConstructSignatures().length > 0 ? 'constructor'
					: awaited !== undefined && awaited !== type ? 'promise'
						: checker.isArrayType(type) ? 'array'
							: checker.isTupleType(type) ? 'tuple'
								: type.isUnion() ? 'union'
									: (type.flags & ts.TypeFlags.Any) !== 0 ? 'any'
										: (type.flags & ts.TypeFlags.Unknown) !== 0 ? 'unknown'
											: 'object';
		return { ref, display, category, ...(primitive === undefined ? {} : { primitive }), ...(category === 'promise' ? { mustUse: true } : {}), ...(origin === undefined ? {} : { origin }) };
	}

	private requireType(reference: ForeignTypeRef): StoredType {
		if (reference.providerId !== this.id || reference.generation !== this.generation) throw new Error('Stale or foreign JavaScript type handle');
		const type = this.#types.get(reference.id);
		if (type === undefined) throw new Error('Unknown JavaScript type handle');
		return type;
	}

	private moduleWitness(request: JsImportRequest, resolved: ts.ResolvedModuleFull | undefined): ModuleResolutionWitness {
		const declarationInfo = findPackageInfo(resolved?.resolvedFileName);
		const runtime = resolveRuntimeModule(request);
		const runtimeInfo = runtime.path === undefined ? {} : findPackageInfo(runtime.path);
		return {
			moduleSpecifier: request.moduleSpecifier,
			...(runtimeInfo.name === undefined ? {} : { packageName: runtimeInfo.name }),
			...(runtimeInfo.version === undefined ? {} : { packageVersion: runtimeInfo.version }),
			...(declarationInfo.name === undefined ? {} : { declarationPackageName: declarationInfo.name }),
			...(declarationInfo.version === undefined ? {} : { declarationPackageVersion: declarationInfo.version }),
			...(resolved?.resolvedFileName === undefined ? {} : { declarationEntry: resolved.resolvedFileName }),
			...(runtime.entry === undefined ? {} : { runtimeEntry: runtime.entry }),
			...(runtime.format === undefined ? {} : { runtimeFormat: runtime.format }),
			conditions: request.platform === 'browser' ? ['types', 'import', 'browser'] : ['types', 'import', 'node'],
			platform: request.platform,
			providerVersion: this.version,
			...(resolved?.resolvedFileName === undefined || !existsSync(resolved.resolvedFileName) ? {} : { declarationGraphHash: hash(readFileSync(resolved.resolvedFileName)) }),
			...(runtimeInfo.packageJsonPath === undefined ? {} : { packageJsonHash: hash(readFileSync(runtimeInfo.packageJsonPath)) }),
			...(declarationInfo.packageJsonPath === undefined ? {} : { declarationPackageJsonHash: hash(readFileSync(declarationInfo.packageJsonPath)) }),
		};
	}
}


function canonicalFilePath(fileName: string): string {
	const normalized = resolve(fileName).replaceAll('\\', '/');
	return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

function primitiveKind(type: ts.Type): ForeignPrimitiveKind | undefined {
	const flags = type.getFlags();
	if ((flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) !== 0) return 'string';
	if ((flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0) return 'boolean';
	if ((flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) !== 0) return 'number';
	if ((flags & (ts.TypeFlags.BigInt | ts.TypeFlags.BigIntLiteral)) !== 0) return 'bigint';
	if ((flags & ts.TypeFlags.Void) !== 0) return 'void';
	if ((flags & ts.TypeFlags.Undefined) !== 0) return 'undefined';
	if ((flags & ts.TypeFlags.Null) !== 0) return 'null';
	return undefined;
}

function safeTsName(value: string): string {
	if (!/^[$A-Z_a-z][$\w]*$/u.test(value)) throw new Error(`Unsupported JavaScript export name ${value}`);
	return value;
}

function hash(value: string | NodeJS.ArrayBufferView): string {
	return createHash('sha256').update(value).digest('hex');
}

function findPackageInfo(resolvedFile: string | undefined): { readonly name?: string; readonly version?: string; readonly packageJsonPath?: string; readonly type?: string } {
	if (resolvedFile === undefined || resolvedFile.startsWith('node:')) return {};
	let current = dirname(resolvedFile);
	while (true) {
		const packageJsonPath = join(current, 'package.json');
		if (existsSync(packageJsonPath)) {
			try {
				const value = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown; version?: unknown; type?: unknown };
				return {
					...(typeof value.name === 'string' ? { name: value.name } : {}),
					...(typeof value.version === 'string' ? { version: value.version } : {}),
					...(typeof value.type === 'string' ? { type: value.type } : {}),
					packageJsonPath,
				};
			} catch { return {}; }
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return {};
}

function resolveRuntimeModule(request: JsImportRequest): { readonly entry?: string; readonly path?: string; readonly format?: ModuleResolutionWitness['runtimeFormat'] } {
	if (request.moduleSpecifier.startsWith('node:')) return { entry: request.moduleSpecifier, format: 'builtin' };
	if (request.platform === 'browser') return { format: 'bundler' };
	if (request.platform !== 'node') return { format: 'unknown' };
	let entry: string | undefined;
	try {
		const resolveImport = import.meta.resolve as (specifier: string, parent?: string) => string;
		entry = resolveImport(request.moduleSpecifier, pathToFileURL(request.containingFile).href);
	} catch {
		try { entry = pathToFileURL(createRequire(request.containingFile).resolve(request.moduleSpecifier)).href; } catch { return { format: 'unknown' }; }
	}
	if (entry.startsWith('node:')) return { entry, format: 'builtin' };
	if (!entry.startsWith('file:')) return { entry, format: 'unknown' };
	const path = fileURLToPath(entry);
	const extension = extname(path);
	if (extension === '.mjs' || extension === '.mts') return { entry: path, path, format: 'esm' };
	if (extension === '.cjs' || extension === '.cts') return { entry: path, path, format: 'commonjs' };
	const packageInfo = findPackageInfo(path);
	return { entry: path, path, format: packageInfo.type === 'module' ? 'esm' : 'commonjs' };
}

function typeContainsTypeParameter(type: ts.Type, target: ts.Type, seen: Set<ts.Type>): boolean {
	if (type === target) return true;
	if (seen.has(type)) return false;
	seen.add(type);
	if (type.isUnionOrIntersection()) return type.types.some(item => typeContainsTypeParameter(item, target, seen));
	if ((type.flags & ts.TypeFlags.Object) !== 0) {
		const reference = type as ts.TypeReference;
		if (reference.typeArguments?.some(item => typeContainsTypeParameter(item, target, seen)) === true) return true;
	}
	return false;
}

export {
	INTEROP_ABI_VERSION,
	buildInteropAdapters,
	copyInteropRuntimeAssets,
	createInteropAdapterTemplate,
	type InteropAdapterArtifact,
	type InteropAdapterBuildOptions,
	type InteropAdapterBuildResult,
	type InteropAdapterExport,
	type InteropRuntimeAssetCopyResult,
} from './adapter.js';
