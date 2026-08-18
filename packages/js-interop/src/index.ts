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
	InteropCallUsage,
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
	readonly createLanguageService?: (host: ts.LanguageServiceHost) => ts.LanguageService;
}

interface UsageProjection {
	readonly directory: string;
	readonly moduleSpecifier: string;
	readonly exportName: '__viruneValue' | '__viruneResult' | '__viruneAwaited';
	readonly accessPath: readonly string[];
}

interface StoredType {
	readonly type: ts.Type;
	readonly checker: ts.TypeChecker;
	readonly location: ts.Node;
	readonly origin: ForeignTypeSnapshot['origin'];
	readonly workspace: ProbeWorkspace;
	readonly usageProjection?: UsageProjection;
}

interface Probe {
	readonly program: ts.Program;
	readonly checker: ts.TypeChecker;
	readonly sourceFile: ts.SourceFile;
	readonly workspace: ProbeWorkspace;
	readonly valueNode?: ts.Node;
	readonly typeNode?: ts.TypeNode;
	readonly resolvedModule?: ts.ResolvedModuleFull;
}

interface VirtualProbeFile {
	readonly path: string;
	readonly text: string;
	readonly version: number;
}

interface ProbeWorkspace {
	readonly platform: JsImportRequest['platform'];
	readonly compilerOptions: ts.CompilerOptions;
	readonly virtualFiles: Map<string, VirtualProbeFile>;
	readonly languageService: ts.LanguageService;
	projectVersion: number;
}

/**
 * Conservative provider. Whole call usages are resolved by TypeScript itself
 * inside one fixed Program session; the legacy per-parameter resolver remains
 * only for providers/callers that have not adopted the usage contract yet.
 */
export class TypeScriptInteropProvider implements JsInteropProvider {
	readonly id: string;
	readonly version = `typescript-${ts.version}`;
	readonly generation: number;
	readonly #projectRoot: string;
	readonly #compilerOptions: ts.CompilerOptions;
	readonly #createLanguageService: (host: ts.LanguageServiceHost) => ts.LanguageService;
	readonly #workspaces = new Map<JsImportRequest['platform'], ProbeWorkspace>();
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
		this.#createLanguageService = options.createLanguageService ?? (host => ts.createLanguageService(host));
		Object.defineProperty(this, 'resolveCallUsage', {
			value: (reference: ForeignTypeRef, usage: InteropCallUsage): ForeignCallResolution | undefined => this.resolveCallUsageInternal(reference, usage),
			enumerable: false,
			configurable: false,
			writable: false,
		});
	}

	public dispose(): void {
		this.#types.clear();
		for (const workspace of this.#workspaces.values()) workspace.languageService.dispose();
		this.#workspaces.clear();
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
		return {
			type: this.store(
				type,
				probe.checker,
				node,
				{
					moduleSpecifier: request.moduleSpecifier,
					...(request.importedName === undefined ? {} : { exportName: request.importedName }),
					...(probe.resolvedModule?.resolvedFileName === undefined ? {} : { declarationPath: probe.resolvedModule.resolvedFileName }),
				},
				probe.workspace,
				usageProjectionForImport(request),
			),
			runtime,
			witness,
		};
	}

	public getProperty(reference: ForeignTypeRef, name: string): ForeignTypeSnapshot | undefined {
		const stored = this.requireType(reference);
		const property = stored.checker.getPropertyOfType(stored.type, name);
		if (property === undefined) return undefined;
		const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? stored.location;
		const usageProjection = stored.usageProjection === undefined ? undefined : {
			...stored.usageProjection,
			accessPath: [...stored.usageProjection.accessPath, name],
		};
		return this.store(
			stored.checker.getTypeOfSymbolAtLocation(property, declaration),
			stored.checker,
			declaration,
			stored.origin,
			stored.workspace,
			usageProjection,
		);
	}

	private resolveCallUsageInternal(reference: ForeignTypeRef, usage: InteropCallUsage): ForeignCallResolution | undefined {
		const callee = this.lookupType(reference);
		if (callee === undefined) return undefined;
		const workspace = callee.workspace;
		const calleeFlags = callee.type.getFlags();
		if ((calleeFlags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 || callee.type.getCallSignatures().length === 0) return undefined;
		if (callee.usageProjection === undefined) return undefined;

		const imports: string[] = [];
		let usageDirectory: string;
		let callTarget: string;
		if (usage.target.kind === 'member') {
			const receiver = this.lookupType(usage.target.receiver);
			if (
				receiver === undefined
				|| receiver.workspace !== workspace
				|| receiver.usageProjection === undefined
				|| receiver.usageProjection.directory !== callee.usageProjection.directory
				|| (receiver.type.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0
			) return undefined;
			const expectedCalleeProjection: UsageProjection = {
				...receiver.usageProjection,
				accessPath: [...receiver.usageProjection.accessPath, usage.target.property],
			};
			if (!sameProjection(callee.usageProjection, expectedCalleeProjection)) return undefined;
			usageDirectory = receiver.usageProjection.directory;
			imports.push(renderProjectionImport(receiver.usageProjection, '__viruneReceiver'));
			callTarget = `${renderProjectionAccess('__viruneReceiver', receiver.usageProjection.accessPath)}[${JSON.stringify(usage.target.property)}]`;
		} else {
			usageDirectory = callee.usageProjection.directory;
			imports.push(renderProjectionImport(callee.usageProjection, '__viruneCallee'));
			callTarget = renderProjectionAccess('__viruneCallee', callee.usageProjection.accessPath);
		}

		const argumentDeclarations: string[] = [];
		const argumentExpressions: string[] = [];
		for (let index = 0; index < usage.arguments.length; index++) {
			const argument = usage.arguments[index]!;
			if (argument.kind === 'unknown') return undefined;
			if (argument.kind === 'foreign') {
				const source = this.lookupType(argument.type);
				if (
					source === undefined
					|| source.workspace !== workspace
					|| source.usageProjection === undefined
					|| source.usageProjection.directory !== usageDirectory
				) return undefined;
				const name = `__viruneArg${index}`;
				if ((source.type.getFlags() & ts.TypeFlags.Any) !== 0) {
					argumentDeclarations.push(`declare const ${name}: unknown;`);
					argumentExpressions.push(name);
					continue;
				}
				const rawName = `__viruneRawArg${index}`;
				imports.push(renderProjectionImport(source.usageProjection, rawName));
				argumentExpressions.push(renderProjectionAccess(rawName, source.usageProjection.accessPath));
				continue;
			}
			const literal = argument.literal === undefined ? undefined : renderInteropLiteral(argument.primitive, argument.literal);
			if (argument.literal !== undefined && literal === undefined) return undefined;
			if (literal !== undefined) {
				argumentExpressions.push(literal);
				continue;
			}
			if (argument.primitive === 'Unit') {
				argumentExpressions.push('undefined');
				continue;
			}
			const name = `__viruneArg${index}`;
			argumentDeclarations.push(`declare const ${name}: ${typescriptPrimitiveName(argument.primitive)};`);
			argumentExpressions.push(name);
		}

		const callText = `${callTarget}(${argumentExpressions.join(', ')})`;
		const sourceText = `${imports.join('\n')}\n${argumentDeclarations.join('\n')}\nexport const __viruneResult = ${callText};\n`;
		const virtualFileName = `.virune-interop-usage-${workspace.platform}-${hash(sourceText)}.ts`;
		const virtualPath = join(usageDirectory, virtualFileName);
		if (!this.ensureVirtualFile(workspace, virtualPath, sourceText)) return undefined;
		const program = workspace.languageService.getProgram();
		if (program === undefined) return undefined;
		const diagnostics = [
			...workspace.languageService.getCompilerOptionsDiagnostics(),
			...workspace.languageService.getSyntacticDiagnostics(virtualPath),
			...workspace.languageService.getSemanticDiagnostics(virtualPath),
		];
		if (diagnostics.some(item => item.category === ts.DiagnosticCategory.Error)) return undefined;
		const virtualKey = canonicalFilePath(virtualPath);
		const sourceFile = program.getSourceFile(virtualPath)
			?? program.getSourceFiles().find(item => canonicalFilePath(item.fileName) === virtualKey);
		const resultDeclaration = sourceFile?.statements
			.filter(ts.isVariableStatement)
			.flatMap(statement => [...statement.declarationList.declarations])
			.find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === '__viruneResult');
		const call = resultDeclaration?.initializer;
		if (call === undefined || !ts.isCallExpression(call)) return undefined;
		const checker = program.getTypeChecker();
		const signature = checker.getResolvedSignature(call);
		if (signature === undefined) return undefined;
		const result = checker.getReturnTypeOfSignature(signature);
		if ((result.getFlags() & ts.TypeFlags.Any) !== 0) return undefined;
		const selectedGeneric = (signature.declaration?.typeParameters?.length ?? 0) > 0;
		if (selectedGeneric && (result.getFlags() & ts.TypeFlags.Unknown) !== 0) return undefined;
		const parameters = signature.getParameters();
		const { minimum, optional, rest } = signatureArity(parameters);
		const resultProjection: UsageProjection = {
			directory: usageDirectory,
			moduleSpecifier: `./${virtualFileName}`,
			exportName: '__viruneResult',
			accessPath: [],
		};
		const resultSnapshot = this.store(result, checker, call, callee.origin, workspace, resultProjection);
		return {
			result: resultSnapshot,
			parameterCount: parameters.length,
			optionalParameterCount: optional,
			minimumArgumentCount: minimum,
			rest,
			mayReject: resultSnapshot.category === 'promise',
			receiverMode: usage.target.kind === 'member' ? 'preserve-this' : 'none',
		};
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
		const usageProjection = stored.usageProjection === undefined ? undefined : this.createAwaitedProjection(stored);
		if (stored.usageProjection !== undefined && usageProjection === undefined) return undefined;
		return this.store(awaited, stored.checker, stored.location, stored.origin, stored.workspace, usageProjection);
	}

	public display(reference: ForeignTypeRef): string {
		const stored = this.requireType(reference);
		return stored.checker.typeToString(stored.type, stored.location, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
	}

	private createAwaitedProjection(stored: StoredType): UsageProjection | undefined {
		const source = stored.usageProjection;
		if (source === undefined) return undefined;
		const rawName = '__viruneAwaitSource';
		const sourceType = renderProjectionType(rawName, source.accessPath);
		const sourceText = `${renderProjectionImport(source, rawName)}\nexport declare const __viruneAwaited: Awaited<${sourceType}>;\n`;
		const virtualFileName = `.virune-interop-awaited-${stored.workspace.platform}-${hash(sourceText)}.ts`;
		const virtualPath = join(source.directory, virtualFileName);
		if (!this.ensureVirtualFile(stored.workspace, virtualPath, sourceText)) return undefined;
		return {
			directory: source.directory,
			moduleSpecifier: `./${virtualFileName}`,
			exportName: '__viruneAwaited',
			accessPath: [],
		};
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
		const resultSnapshot = this.store(result, stored.checker, signature.declaration ?? stored.location, stored.origin, stored.workspace);
		return { result: resultSnapshot, parameterCount: parameters.length, optionalParameterCount: optional, rest, mayReject: resultSnapshot.category === 'promise', receiverMode: construct ? 'none' : 'preserve-this' };
	}

	private conservativeGenericResult(signature: ts.Signature, result: ts.Type, checker: ts.TypeChecker): ts.Type | undefined {
		const parameters = signature.getTypeParameters() ?? [];
		if (parameters.length === 0) return result;
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
		const locations = parameters.map(parameter => parameter.valueDeclaration ?? parameter.declarations?.[0]);
		if (locations.some(location => location === undefined)) return false;
		const lastDeclaration = locations.at(-1)!;
		const hasRest = lastDeclaration !== undefined && ts.isParameter(lastDeclaration) && lastDeclaration.dotDotDotToken !== undefined;
		if (hasRest) return false;
		let minimum = 0;
		for (let index = 0; index < parameters.length; index++) {
			const parameter = parameters[index]!;
			const location = locations[index]!;
			const optional = (parameter.flags & ts.SymbolFlags.Optional) !== 0 || ts.isParameter(location) && (location.questionToken !== undefined || location.initializer !== undefined);
			if (!optional) minimum = index + 1;
		}
		if (argumentsList.length < minimum || argumentsList.length > parameters.length) return false;
		for (let index = 0; index < argumentsList.length; index++) {
			const parameter = parameters[index]!;
			const location = locations[index]!;
			const parameterType = checker.getTypeOfSymbolAtLocation(parameter, location);
			if (!this.argumentCompatible(argumentsList[index]!, parameterType, checker)) return false;
		}
		return true;
	}

	private argumentCompatible(argument: InteropArgumentType, parameter: ts.Type, checker: ts.TypeChecker): boolean {
		if (argument.kind === 'unknown') return false;
		const parameterFlags = parameter.getFlags();
		if (argument.kind === 'foreign') {
			const source = this.requireType(argument.type);
			const sourceFlags = source.type.getFlags();
			if ((sourceFlags & ts.TypeFlags.Any) !== 0) return (parameterFlags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
			if (source.checker === checker) return checker.isTypeAssignableTo(source.type, parameter);
			return crossProgramForeignCompatible(source, parameter, checker);
		}
		return nativePrimitiveCompatible(argument, parameter, checker);
	}

	private lookupType(reference: ForeignTypeRef): StoredType | undefined {
		if (reference.providerId !== this.id || reference.generation !== this.generation) return undefined;
		return this.#types.get(reference.id);
	}

	private createProbe(request: JsImportRequest): Probe {
		const workspace = this.probeWorkspace(request.platform);
		const virtualFileName = interopProbeFileName(request);
		const virtualPath = join(dirname(request.containingFile), virtualFileName);
		const moduleText = JSON.stringify(request.moduleSpecifier);
		const sourceText = request.kind === 'named'
			? `import { ${safeTsName(request.importedName ?? '')} as __viruneValue } from ${moduleText};\nexport { __viruneValue };\n__viruneValue;`
			: request.kind === 'default' ? `import __viruneValue from ${moduleText};\nexport { __viruneValue };\n__viruneValue;`
				: request.kind === 'namespace' ? `import * as __viruneValue from ${moduleText};\nexport { __viruneValue };\n__viruneValue;`
					: request.kind === 'type-only' ? `import type { ${safeTsName(request.importedName ?? '')} as __ViruneType } from ${moduleText};\ntype __ViruneAlias = __ViruneType;`
						: `import ${moduleText};`;
		if (!this.ensureVirtualFile(workspace, virtualPath, sourceText)) throw new Error('TypeScript interop probe path collides with provider-owned state');
		const program = workspace.languageService.getProgram();
		if (program === undefined) throw new Error('TypeScript interop language service did not create a program');
		const diagnostics = [
			...workspace.languageService.getCompilerOptionsDiagnostics(),
			...workspace.languageService.getSyntacticDiagnostics(virtualPath),
			...workspace.languageService.getSemanticDiagnostics(virtualPath),
		];
		const errors = diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error);
		if (errors.length > 0) throw new Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('; '));
		const virtualFileKey = canonicalFilePath(virtualPath);
		const sourceFile = program.getSourceFile(virtualPath)
			?? program.getSourceFiles().find(item => canonicalFilePath(item.fileName) === virtualFileKey);
		if (sourceFile === undefined) throw new Error('TypeScript interop probe was not created');
		const checker = program.getTypeChecker();
		const expression = sourceFile.statements.find(ts.isExpressionStatement)?.expression;
		const alias = sourceFile.statements.find(ts.isTypeAliasDeclaration)?.type;
		const resolved = ts.resolveModuleName(request.moduleSpecifier, virtualPath, workspace.compilerOptions, ts.sys).resolvedModule;
		return { program, checker, sourceFile, workspace, ...(expression === undefined ? {} : { valueNode: expression }), ...(alias === undefined ? {} : { typeNode: alias }), ...(resolved === undefined ? {} : { resolvedModule: resolved }) };
	}

	private probeWorkspace(platform: JsImportRequest['platform']): ProbeWorkspace {
		const existing = this.#workspaces.get(platform);
		if (existing !== undefined) return existing;
		const typeRoots = platform === 'node' ? nodeTypeRoots(this.#compilerOptions.typeRoots) : this.#compilerOptions.typeRoots;
		const compilerOptions: ts.CompilerOptions = {
			...this.#compilerOptions,
			types: platform === 'node' ? ['node'] : [],
			...(typeRoots === undefined ? {} : { typeRoots }),
		};
		const virtualFiles = new Map<string, VirtualProbeFile>();
		let workspace!: ProbeWorkspace;
		const host: ts.LanguageServiceHost = {
			getCompilationSettings: () => compilerOptions,
			getScriptFileNames: () => [...virtualFiles.values()].map(file => file.path),
			getScriptVersion: fileName => String(virtualFiles.get(canonicalFilePath(fileName))?.version ?? 0),
			getScriptSnapshot: fileName => {
				const text = virtualFiles.get(canonicalFilePath(fileName))?.text ?? ts.sys.readFile(fileName);
				return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
			},
			getProjectVersion: () => String(workspace.projectVersion),
			getCurrentDirectory: () => this.#projectRoot,
			getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
			fileExists: fileName => virtualFiles.has(canonicalFilePath(fileName)) || ts.sys.fileExists(fileName),
			readFile: fileName => virtualFiles.get(canonicalFilePath(fileName))?.text ?? ts.sys.readFile(fileName),
			readDirectory: ts.sys.readDirectory,
			useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
			getNewLine: () => ts.sys.newLine,
			...(ts.sys.directoryExists === undefined ? {} : { directoryExists: ts.sys.directoryExists }),
			...(ts.sys.getDirectories === undefined ? {} : { getDirectories: ts.sys.getDirectories }),
			...(ts.sys.realpath === undefined ? {} : { realpath: ts.sys.realpath }),
		};
		const languageService = this.#createLanguageService(host);
		workspace = { platform, compilerOptions, virtualFiles, languageService, projectVersion: 0 };
		this.#workspaces.set(platform, workspace);
		return workspace;
	}

	private ensureVirtualFile(workspace: ProbeWorkspace, path: string, text: string): boolean {
		const key = canonicalFilePath(path);
		const existing = workspace.virtualFiles.get(key);
		if (existing !== undefined) return existing.text === text;
		if (ts.sys.fileExists(path)) return false;
		workspace.virtualFiles.set(key, { path, text, version: 1 });
		workspace.projectVersion++;
		return true;
	}

	private store(
		type: ts.Type,
		checker: ts.TypeChecker,
		location: ts.Node,
		origin: ForeignTypeSnapshot['origin'],
		workspace: ProbeWorkspace,
		usageProjection?: UsageProjection,
	): ForeignTypeSnapshot {
		const id = String(this.#nextTypeId++);
		const ref: ForeignTypeRef = { providerId: this.id, generation: this.generation, id };
		this.#types.set(id, { type, checker, location, origin, workspace, ...(usageProjection === undefined ? {} : { usageProjection }) });
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
		const type = this.lookupType(reference);
		if (type === undefined) throw new Error(reference.providerId !== this.id || reference.generation !== this.generation ? 'Stale or foreign JavaScript type handle' : 'Unknown JavaScript type handle');
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

function nativePrimitiveCompatible(argument: Extract<InteropArgumentType, { readonly kind: 'native-primitive' }>, parameter: ts.Type, checker: ts.TypeChecker): boolean {
	const flags = parameter.getFlags();
	if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
	if (argument.primitive === 'Unit') {
		if (parameter.isUnion()) return parameter.types.some(item => nativePrimitiveCompatible(argument, item, checker));
		return (flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0;
	}
	const expected: ForeignPrimitiveKind = argument.primitive === 'Bool' ? 'boolean'
		: argument.primitive === 'String' ? 'string'
			: argument.primitive === 'BigInt' ? 'bigint'
				: 'number';
	const broadType = broadPrimitiveTypeFromParameter(parameter, expected, checker);
	return broadType !== undefined && checker.isTypeAssignableTo(broadType, parameter);
}

function broadPrimitiveTypeFromParameter(parameter: ts.Type, expected: ForeignPrimitiveKind, checker: ts.TypeChecker): ts.Type | undefined {
	const candidates = parameter.isUnion() ? parameter.types : [parameter];
	for (const candidate of candidates) {
		const broadType = checker.getBaseTypeOfLiteralType(candidate);
		if (primitiveKind(broadType) === expected) return broadType;
	}
	return undefined;
}

function crossProgramForeignCompatible(source: StoredType, parameter: ts.Type, checker: ts.TypeChecker): boolean {
	const parameterFlags = parameter.getFlags();
	if ((parameterFlags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
	const sourcePrimitive = primitiveKind(source.type);
	if (sourcePrimitive !== undefined) {
		const broadType = broadPrimitiveTypeFromParameter(parameter, sourcePrimitive, checker);
		return broadType !== undefined && checker.isTypeAssignableTo(broadType, parameter);
	}
	if (parameter.isUnion()) return parameter.types.some(item => crossProgramForeignCompatible(source, item, checker));
	if ((parameterFlags & ts.TypeFlags.NonPrimitive) !== 0) return isDefinitelyNonPrimitive(source.type, source.checker);
	return false;
}

function isDefinitelyNonPrimitive(type: ts.Type, checker: ts.TypeChecker): boolean {
	if (type.isUnionOrIntersection()) return type.types.every(item => isDefinitelyNonPrimitive(item, checker));
	const flags = type.getFlags();
	if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0) return false;
	if (primitiveKind(type) !== undefined) return false;
	if ((flags & (ts.TypeFlags.Object | ts.TypeFlags.NonPrimitive)) === 0) return false;
	const primitiveRuntimeTypes = [
		checker.getStringType(),
		checker.getNumberType(),
		checker.getBooleanType(),
		checker.getBigIntType(),
		checker.getESSymbolType(),
	];
	return primitiveRuntimeTypes.every(primitive => !checker.isTypeAssignableTo(primitive, type));
}

function signatureArity(parameters: readonly ts.Symbol[]): { readonly minimum: number; readonly optional: number; readonly rest: boolean } {
	let minimum = 0;
	let optional = 0;
	let rest = false;
	for (let index = 0; index < parameters.length; index++) {
		const parameter = parameters[index]!;
		const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
		const isRest = declaration !== undefined && ts.isParameter(declaration) && declaration.dotDotDotToken !== undefined;
		const isOptional = isRest || (parameter.flags & ts.SymbolFlags.Optional) !== 0 || declaration !== undefined && ts.isParameter(declaration) && (declaration.questionToken !== undefined || declaration.initializer !== undefined);
		if (isRest) rest = true;
		if (isOptional) optional++;
		else minimum = index + 1;
	}
	return { minimum, optional, rest };
}

function interopProbeFileName(request: JsImportRequest): string {
	return `.virune-interop-${hash(`${request.moduleSpecifier}:${request.kind}:${request.importedName ?? ''}`)}.ts`;
}

function usageProjectionForImport(request: JsImportRequest): UsageProjection | undefined {
	if (request.kind === 'side-effect' || request.kind === 'type-only') return undefined;
	return {
		directory: dirname(request.containingFile),
		moduleSpecifier: `./${interopProbeFileName(request)}`,
		exportName: '__viruneValue',
		accessPath: [],
	};
}

function renderProjectionImport(projection: UsageProjection, localName: string): string {
	return `import { ${projection.exportName} as ${localName} } from ${JSON.stringify(projection.moduleSpecifier)};`;
}

function renderProjectionAccess(baseName: string, accessPath: readonly string[]): string {
	return accessPath.reduce((value, property) => `${value}[${JSON.stringify(property)}]`, baseName);
}

function renderProjectionType(baseName: string, accessPath: readonly string[]): string {
	return accessPath.reduce((value, property) => `(${value})[${JSON.stringify(property)}]`, `typeof ${baseName}`);
}

function sameProjection(left: UsageProjection, right: UsageProjection): boolean {
	return left.directory === right.directory
		&& left.moduleSpecifier === right.moduleSpecifier
		&& left.exportName === right.exportName
		&& left.accessPath.length === right.accessPath.length
		&& left.accessPath.every((value, index) => value === right.accessPath[index]);
}

function typescriptPrimitiveName(primitive: Extract<InteropArgumentType, { readonly kind: 'native-primitive' }>['primitive']): string {
	return primitive === 'Bool' ? 'boolean'
		: primitive === 'String' ? 'string'
			: primitive === 'BigInt' ? 'bigint'
				: primitive === 'Unit' ? 'undefined'
					: 'number';
}

function renderInteropLiteral(primitive: Extract<InteropArgumentType, { readonly kind: 'native-primitive' }>['primitive'], literal: NonNullable<Extract<InteropArgumentType, { readonly kind: 'native-primitive' }>['literal']>): string | undefined {
	if (primitive !== literal.kind && !((primitive === 'Int' || primitive === 'Float') && (literal.kind === 'Int' || literal.kind === 'Float'))) return undefined;
	if (literal.kind === 'String') return JSON.stringify(literal.value);
	if (literal.kind === 'Bool') return literal.value ? 'true' : 'false';
	if (literal.kind === 'BigInt') return /^-?\d+$/u.test(literal.value) ? `${literal.value}n` : undefined;
	if (!Number.isFinite(literal.value)) return undefined;
	return Object.is(literal.value, -0) ? '-0' : String(literal.value);
}

function safeTsName(value: string): string {
	if (!/^[$A-Z_a-z][$\w]*$/u.test(value)) throw new Error(`Unsupported JavaScript export name ${value}`);
	return value;
}

function hash(value: string | NodeJS.ArrayBufferView): string {
	return createHash('sha256').update(value).digest('hex');
}

function nodeTypeRoots(configured: readonly string[] | undefined): string[] | undefined {
	const roots = new Set(configured ?? []);
	try {
		const packageJson = createRequire(import.meta.url).resolve('@types/node/package.json');
		roots.add(dirname(dirname(packageJson)));
	} catch { /* Node declarations may be supplied by the project instead. */ }
	return roots.size === 0 ? undefined : [...roots];
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
