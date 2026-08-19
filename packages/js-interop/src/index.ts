import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
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
	readonly typeExpression: string;
	readonly directory: string;
	readonly declaration?: string;
	readonly valueExpression?: string;
}

interface StoredType {
	readonly type: ts.Type;
	readonly checker: ts.TypeChecker;
	readonly location: ts.Node;
	readonly origin: ForeignTypeSnapshot['origin'];
	readonly workspace: ProbeWorkspace;
	readonly display: string;
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

interface RuntimePackageJson {
	readonly name?: string;
	readonly type?: string;
	readonly main?: string;
	readonly exports?: unknown;
}

type PackageTargetResolution = string | null | undefined;

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
		const snapshot = this.store(
			type,
			probe.checker,
			node,
			{
				moduleSpecifier: request.moduleSpecifier,
				...(request.importedName === undefined ? {} : { exportName: request.importedName }),
				...(witness.declarationEntry === undefined ? {} : { declarationPath: witness.declarationEntry }),
			},
			probe.workspace,
			usageProjectionForImport(request),
		);
		if (probe.resolvedModule?.resolvedFileName !== undefined) {
			Object.defineProperty(snapshot, 'navigation', {
				value: { declarationPath: probe.resolvedModule.resolvedFileName },
				enumerable: false,
				configurable: false,
				writable: false,
			});
		}
		return { type: snapshot, runtime, witness };
	}

	public getProperty(reference: ForeignTypeRef, name: string): ForeignTypeSnapshot | undefined {
		const stored = this.requireType(reference);
		const property = stored.checker.getPropertyOfType(stored.type, name);
		if (property === undefined) return undefined;
		const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? stored.location;
		const propertyName = JSON.stringify(name);
		const usageProjection = stored.usageProjection === undefined ? undefined : {
			typeExpression: `(${stored.usageProjection.typeExpression})[${propertyName}]`,
			directory: stored.usageProjection.directory,
			...(stored.usageProjection.declaration === undefined ? {} : { declaration: stored.usageProjection.declaration }),
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

		const imports = new Set<string>();
		const declarations: string[] = ['export {};'];
		const includeProjection = (projection: UsageProjection): void => {
			if (projection.declaration !== undefined) imports.add(projection.declaration);
		};
		let usageDirectory: string;
		let callTarget: string;
		if (usage.target.kind === 'member') {
			const receiver = this.lookupType(usage.target.receiver);
			if (
				receiver === undefined
				|| receiver.workspace !== workspace
				|| receiver.usageProjection === undefined
				|| callee.usageProjection === undefined
				|| receiver.usageProjection.directory !== callee.usageProjection.directory
				|| (receiver.type.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0
			) return undefined;
			const property = JSON.stringify(usage.target.property);
			const expectedCalleeProjection = `(${receiver.usageProjection.typeExpression})[${property}]`;
			if (callee.usageProjection.typeExpression !== expectedCalleeProjection) return undefined;
			const expectedCalleeValue = receiver.usageProjection.valueExpression === undefined ? undefined : `(${receiver.usageProjection.valueExpression})[${property}]`;
			usageDirectory = receiver.usageProjection.directory;
			includeProjection(receiver.usageProjection);
			if (receiver.usageProjection.valueExpression !== undefined) {
				callTarget = expectedCalleeValue!;
			} else {
				declarations.push(`declare const __viruneReceiver: ${receiver.usageProjection.typeExpression};`);
				callTarget = `__viruneReceiver[${property}]`;
			}
		} else {
			if (callee.usageProjection === undefined) return undefined;
			usageDirectory = callee.usageProjection.directory;
			includeProjection(callee.usageProjection);
			if (callee.usageProjection.valueExpression !== undefined) callTarget = callee.usageProjection.valueExpression;
			else {
				declarations.push(`declare const __viruneCallee: ${callee.usageProjection.typeExpression};`);
				callTarget = '__viruneCallee';
			}
		}

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
				includeProjection(source.usageProjection);
				const sourceType = foreignTypeRequiresUnknownProjection(source.type, source.checker, source.location) ? 'unknown' : source.usageProjection.typeExpression;
				const name = `__viruneArg${index}`;
				declarations.push(`declare const ${name}: ${sourceType};`);
				argumentExpressions.push(name);
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
			declarations.push(`declare const ${name}: ${typescriptPrimitiveName(argument.primitive)};`);
			argumentExpressions.push(name);
		}

		const callText = `${callTarget}(${argumentExpressions.join(', ')})`;
		const importText = [...imports].sort().join('\n');
		const sourceText = `${importText.length === 0 ? '' : `${importText}\n`}${declarations.join('\n')}\nexport const __viruneResult = ${callText};\n`;
		const virtualFileName = `.virune-interop-usage-${workspace.platform}-${hash(sourceText)}.ts`;
		const virtualPath = join(usageDirectory, virtualFileName);
		const virtualKey = canonicalFilePath(virtualPath);
		const existing = workspace.virtualFiles.get(virtualKey);
		if (existing === undefined) {
			workspace.virtualFiles.set(virtualKey, { path: virtualPath, text: sourceText, version: 1 });
			workspace.projectVersion++;
		} else if (existing.text !== sourceText) {
			return undefined;
		}
		const program = workspace.languageService.getProgram();
		if (program === undefined) return undefined;
		const diagnostics = [
			...workspace.languageService.getCompilerOptionsDiagnostics(),
			...workspace.languageService.getSyntacticDiagnostics(virtualPath),
			...workspace.languageService.getSemanticDiagnostics(virtualPath),
		];
		if (diagnostics.some(item => item.category === ts.DiagnosticCategory.Error)) return undefined;
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
			typeExpression: `(typeof import(${JSON.stringify(`./${virtualFileName}`)}))["__viruneResult"]`,
			directory: usageDirectory,
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
		const usageProjection = stored.usageProjection === undefined ? undefined : {
			typeExpression: `Awaited<${stored.usageProjection.typeExpression}>`,
			directory: stored.usageProjection.directory,
			...(stored.usageProjection.declaration === undefined ? {} : { declaration: stored.usageProjection.declaration }),
		};
		return this.store(awaited, stored.checker, stored.location, stored.origin, stored.workspace, usageProjection);
	}

	public display(reference: ForeignTypeRef): string {
		return this.requireType(reference).display;
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
		const virtualFileKey = canonicalFilePath(virtualPath);
		const existing = workspace.virtualFiles.get(virtualFileKey);
		if (existing?.text !== sourceText) {
			workspace.virtualFiles.set(virtualFileKey, { path: virtualPath, text: sourceText, version: (existing?.version ?? 0) + 1 });
			workspace.projectVersion++;
		}
		const program = workspace.languageService.getProgram();
		if (program === undefined) throw new Error('TypeScript interop language service did not create a program');
		const diagnostics = [
			...workspace.languageService.getCompilerOptionsDiagnostics(),
			...workspace.languageService.getSyntacticDiagnostics(virtualPath),
			...workspace.languageService.getSemanticDiagnostics(virtualPath),
		];
		const errors = diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error);
		if (errors.length > 0) throw new Error(errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('; '));
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
		const rawDisplay = checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
		const display = stableTypeDisplay(rawDisplay, origin, this.#projectRoot);
		this.#types.set(id, { type, checker, location, origin, workspace, display, ...(usageProjection === undefined ? {} : { usageProjection }) });
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
		const runtimeInfo = runtime.path === undefined ? {} : findRuntimePackageInfo(request, runtime.path);
		const declarationEntry = packageRelativeLocator(resolved?.resolvedFileName, declarationInfo.packageJsonPath);
		const runtimeEntry = runtime.format === 'builtin'
			? runtime.entry
			: packageRelativeLocator(runtime.path, runtimeInfo.packageJsonPath);
		return {
			moduleSpecifier: request.moduleSpecifier,
			...(runtimeInfo.name === undefined ? {} : { packageName: runtimeInfo.name }),
			...(runtimeInfo.version === undefined ? {} : { packageVersion: runtimeInfo.version }),
			...(declarationInfo.name === undefined ? {} : { declarationPackageName: declarationInfo.name }),
			...(declarationInfo.version === undefined ? {} : { declarationPackageVersion: declarationInfo.version }),
			...(declarationEntry === undefined ? {} : { declarationEntry }),
			...(runtimeEntry === undefined ? {} : { runtimeEntry }),
			...(runtime.format === undefined ? {} : { runtimeFormat: runtime.format }),
			conditions: request.platform === 'browser' ? ['types', 'import', 'browser'] : ['types', 'node-addons', 'node', 'import', 'module-sync'],
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

function foreignTypeRequiresUnknownProjection(
	type: ts.Type,
	checker: ts.TypeChecker,
	location: ts.Node,
	seen = new Set<ts.Type>(),
	budget: { remaining: number } = { remaining: 64 },
	depth = 0,
): boolean {
	try {
		if (budget.remaining-- <= 0 || depth > 12) return true;
		const flags = type.getFlags();
		if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) !== 0) return true;
		if ((flags & ts.TypeFlags.Unknown) !== 0) return false;
		if (primitiveKind(type) !== undefined || (flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) !== 0) return false;
		if (seen.has(type)) return false;
		seen.add(type);
		if (type.isUnionOrIntersection()) return type.types.some(item => foreignTypeRequiresUnknownProjection(item, checker, location, seen, budget, depth + 1));
		if ((flags & ts.TypeFlags.Object) === 0) return true;

		if (checker.isArrayType(type) || checker.isTupleType(type)) {
			const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
			if (typeArguments.length === 0) return true;
			return typeArguments.some(item => foreignTypeRequiresUnknownProjection(item, checker, location, seen, budget, depth + 1));
		}
		for (const signature of [
			...checker.getSignaturesOfType(type, ts.SignatureKind.Call),
			...checker.getSignaturesOfType(type, ts.SignatureKind.Construct),
		]) {
			const signatureLocation = signature.declaration ?? location;
			const thisParameter = signature.thisParameter;
			if (thisParameter !== undefined) {
				const declaration = thisParameter.valueDeclaration ?? thisParameter.declarations?.[0] ?? signatureLocation;
				const thisType = checker.getTypeOfSymbolAtLocation(thisParameter, declaration);
				if (foreignTypeRequiresUnknownProjection(thisType, checker, declaration, seen, budget, depth + 1)) return true;
			}
			for (const parameter of signature.getParameters()) {
				const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
				if (declaration === undefined) return true;
				const parameterType = checker.getTypeOfSymbolAtLocation(parameter, declaration);
				if (foreignTypeRequiresUnknownProjection(parameterType, checker, declaration, seen, budget, depth + 1)) return true;
			}
			const returnType = checker.getReturnTypeOfSignature(signature);
			if (foreignTypeRequiresUnknownProjection(returnType, checker, signatureLocation, seen, budget, depth + 1)) return true;
		}

		const objectType = type as ts.ObjectType;
		if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
			const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
			if (typeArguments.some(item => foreignTypeRequiresUnknownProjection(item, checker, location, seen, budget, depth + 1))) return true;
		}
		for (const indexInfo of checker.getIndexInfosOfType(type)) {
			if (foreignTypeRequiresUnknownProjection(indexInfo.type, checker, location, seen, budget, depth + 1)) return true;
		}
		for (const property of checker.getPropertiesOfType(type)) {
			const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? location;
			const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
			if (foreignTypeRequiresUnknownProjection(propertyType, checker, declaration, seen, budget, depth + 1)) return true;
		}
		return false;
	} catch {
		return true;
	}
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
	const moduleText = JSON.stringify(request.moduleSpecifier);
	const binding = `__viruneImport_${hash(`${request.moduleSpecifier}:${request.kind}:${request.importedName ?? ''}`).slice(0, 16)}`;
	const declaration = request.kind === 'named'
		? `import { ${safeTsName(request.importedName ?? '')} as ${binding} } from ${moduleText};`
		: request.kind === 'default'
			? `import ${binding} from ${moduleText};`
			: `import * as ${binding} from ${moduleText};`;
	return {
		typeExpression: `typeof ${binding}`,
		directory: dirname(request.containingFile),
		declaration,
		valueExpression: binding,
	};
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

function findRuntimePackageInfo(request: JsImportRequest, runtimePath: string): ReturnType<typeof findPackageInfo> {
	if (request.platform === 'node') {
		const parsed = parsePackageSpecifier(request.moduleSpecifier);
		if (parsed !== undefined) {
			const packageRoot = findNodePackageRoot(parsed.packageName, request.containingFile);
			if (packageRoot !== undefined) return findPackageInfo(join(packageRoot, '__virune_runtime__'));
		}
	}
	return findPackageInfo(runtimePath);
}

function packageRelativeLocator(filePath: string | undefined, packageJsonPath: string | undefined): string | undefined {
	if (filePath === undefined) return undefined;
	if (filePath.startsWith('node:')) return filePath;
	if (packageJsonPath === undefined) return undefined;
	const locator = relative(dirname(packageJsonPath), filePath).replaceAll('\\', '/');
	if (locator.length === 0 || locator === '..' || locator.startsWith('../') || locator.startsWith('/') || /^[A-Za-z]:\//u.test(locator)) return undefined;
	return locator;
}

function stableTypeDisplay(value: string, origin: ForeignTypeSnapshot['origin'], projectRoot: string): string {
	const normalized = value.replaceAll('\\', '/');
	const normalizedRoot = resolve(projectRoot).replaceAll('\\', '/');
	const leaksProviderState = normalized.includes(normalizedRoot)
		|| normalized.includes('.virune-interop-')
		|| normalized.includes('__virune')
		|| /import\(["'](?:\/|[A-Za-z]:\/|\/\/)/u.test(normalized)
		|| normalized.includes('file://');
	if (!leaksProviderState) return value;
	if (origin?.moduleSpecifier !== undefined) {
		return origin.exportName === undefined
			? `typeof import(${JSON.stringify(origin.moduleSpecifier)})`
			: `${origin.moduleSpecifier}#${origin.exportName}`;
	}
	return '<external>';
}

const nodeBuiltinSpecifiers = new Set(builtinModules);
const nodeImportConditions = new Set(['node-addons', 'node', 'import', 'module-sync']);

function isNodeBuiltinSpecifier(specifier: string): boolean {
	if (specifier.startsWith('node:')) {
		const bare = specifier.slice('node:'.length);
		return bare.length > 0 && (nodeBuiltinSpecifiers.has(specifier) || nodeBuiltinSpecifiers.has(bare));
	}
	return nodeBuiltinSpecifiers.has(specifier);
}

function resolveRuntimeModule(request: JsImportRequest): { readonly entry?: string; readonly path?: string; readonly format?: ModuleResolutionWitness['runtimeFormat'] } {
	const specifier = request.moduleSpecifier;
	if (isNodeBuiltinSpecifier(specifier)) {
		const builtinName = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
		return { entry: `node:${builtinName}`, format: 'builtin' };
	}
	if (specifier.startsWith('node:')) return { format: 'unknown' };
	if (request.platform === 'browser') return { format: 'bundler' };
	if (request.platform !== 'node') return { format: 'unknown' };

	const runtimePath = resolveNodeRuntimePath(specifier, request.containingFile);
	if (runtimePath === undefined) return { format: 'unknown' };
	return runtimeModuleFromPath(runtimePath);
}

function resolveNodeRuntimePath(specifier: string, containingFile: string): string | undefined {
	if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/') || specifier.startsWith('file:')) {
		try {
			const url = specifier.startsWith('file:') ? new URL(specifier) : new URL(specifier, pathToFileURL(containingFile));
			if (url.protocol !== 'file:' || url.search.length > 0 || url.hash.length > 0) return undefined;
			return existingRuntimeFile(fileURLToPath(url));
		} catch {
			return undefined;
		}
	}
	if (specifier.startsWith('#')) return undefined;

	const parsed = parsePackageSpecifier(specifier);
	if (parsed === undefined) return undefined;
	const packageRoot = findNodePackageRoot(parsed.packageName, containingFile);
	if (packageRoot === undefined) return undefined;
	const packageJson = readRuntimePackageJson(join(packageRoot, 'package.json'));
	if (packageJson === undefined) return undefined;
	if (packageJson.exports !== undefined) {
		const target = resolvePackageExports(packageJson.exports, parsed.subpath, packageRoot);
		return target === null || target === undefined ? undefined : existingRuntimeFile(target);
	}
	return resolveLegacyPackageRuntimePath(packageRoot, packageJson, parsed.subpath);
}

function resolveLegacyPackageRuntimePath(packageRoot: string, packageJson: RuntimePackageJson, subpath: string): string | undefined {
	const target = subpath === '.' ? packageJson.main ?? '.' : subpath;
	if (typeof target !== 'string' || target.length === 0) return undefined;
	try {
		const packageUrl = pathToFileURL(`${resolve(packageRoot)}/`);
		const url = new URL(target, packageUrl);
		if (url.protocol !== 'file:' || url.search.length > 0 || url.hash.length > 0) return undefined;
		return existingRuntimeFile(fileURLToPath(url));
	} catch {
		return undefined;
	}
}

function existingRuntimeFile(path: string): string | undefined {
	try {
		return existsSync(path) && statSync(path).isFile() ? path : undefined;
	} catch {
		return undefined;
	}
}

function runtimeModuleFromPath(path: string): { readonly entry: string; readonly path: string; readonly format: ModuleResolutionWitness['runtimeFormat'] } {
	const extension = extname(path);
	if (extension === '.mjs' || extension === '.mts') return { entry: path, path, format: 'esm' };
	if (extension === '.cjs' || extension === '.cts') return { entry: path, path, format: 'commonjs' };
	if (extension === '.json' || extension === '.wasm') return { entry: path, path, format: 'unknown' };
	const packageInfo = findPackageInfo(path);
	if (packageInfo.type === 'module') return { entry: path, path, format: 'esm' };
	if (packageInfo.type === 'commonjs') return { entry: path, path, format: 'commonjs' };
	return { entry: path, path, format: extension === '.js' || extension.length === 0 ? 'commonjs' : 'unknown' };
}

function parsePackageSpecifier(specifier: string): { readonly packageName: string; readonly subpath: string } | undefined {
	if (specifier.length === 0 || specifier.includes('\\') || specifier.includes('%')) return undefined;
	const parts = specifier.split('/');
	let packageName: string;
	let rest: string[];
	if (specifier.startsWith('@')) {
		if (parts.length < 2 || parts[0]!.length <= 1 || parts[1]!.length === 0 || parts[1] === '.' || parts[1] === '..') return undefined;
		packageName = `${parts[0]}/${parts[1]}`;
		rest = parts.slice(2);
	} else {
		if (parts[0]!.length === 0 || parts[0]!.startsWith('.')) return undefined;
		packageName = parts[0]!;
		rest = parts.slice(1);
	}
	if (rest.some(part => part.length === 0 || part === '.' || part === '..')) return undefined;
	return { packageName, subpath: rest.length === 0 ? '.' : `./${rest.join('/')}` };
}

function findNodePackageRoot(packageName: string, containingFile: string): string | undefined {
	const selfPackageJson = findNearestPackageJson(containingFile);
	if (selfPackageJson !== undefined) {
		const selfPackage = readRuntimePackageJson(selfPackageJson);
		if (selfPackage?.name === packageName && selfPackage.exports !== undefined) return dirname(selfPackageJson);
	}

	let current = dirname(resolve(containingFile));
	const packageSegments = packageName.split('/');
	while (true) {
		const packageJsonPath = join(current, 'node_modules', ...packageSegments, 'package.json');
		if (existsSync(packageJsonPath)) return dirname(packageJsonPath);
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function findNearestPackageJson(filePath: string): string | undefined {
	let current = dirname(resolve(filePath));
	while (true) {
		if (current.split(/[\\/]/u).includes('node_modules')) return undefined;
		const packageJsonPath = join(current, 'package.json');
		if (existsSync(packageJsonPath)) return packageJsonPath;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function readRuntimePackageJson(packageJsonPath: string): RuntimePackageJson | undefined {
	try {
		const value = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
		return {
			...(typeof value.name === 'string' ? { name: value.name } : {}),
			...(typeof value.type === 'string' ? { type: value.type } : {}),
			...(typeof value.main === 'string' ? { main: value.main } : {}),
			...(Object.hasOwn(value, 'exports') ? { exports: value.exports } : {}),
		};
	} catch {
		return undefined;
	}
}

function resolvePackageExports(exportsValue: unknown, subpath: string, packageRoot: string): PackageTargetResolution {
	if (subpath.endsWith('/')) return undefined;
	if (isRecord(exportsValue)) {
		const keys = Object.keys(exportsValue);
		const dotKeys = keys.filter(key => key.startsWith('.'));
		if (dotKeys.length > 0 && dotKeys.length !== keys.length) return undefined;
		if (dotKeys.length === keys.length && keys.length > 0) {
			if (Object.hasOwn(exportsValue, subpath) && !subpath.includes('*')) {
				return resolvePackageTarget(exportsValue[subpath], packageRoot, undefined);
			}
			const patterns = keys.filter(key => key.includes('*') && key.split('*').length === 2).sort(comparePackagePatternKeys);
			for (const pattern of patterns) {
				const match = packagePatternMatch(pattern, subpath);
				if (match === undefined) continue;
				return resolvePackageTarget(exportsValue[pattern], packageRoot, match);
			}
			return undefined;
		}
	}
	if (subpath !== '.') return undefined;
	return resolvePackageTarget(exportsValue, packageRoot, undefined);
}

function resolvePackageTarget(target: unknown, packageRoot: string, patternMatch: string | undefined): PackageTargetResolution {
	if (target === null) return null;
	if (typeof target === 'string') return resolvePackageTargetString(target, packageRoot, patternMatch);
	if (Array.isArray(target)) {
		for (const item of target) {
			const resolved = resolvePackageTarget(item, packageRoot, patternMatch);
			if (resolved !== undefined) return resolved;
		}
		return undefined;
	}
	if (!isRecord(target)) return undefined;
	for (const key of Object.keys(target)) {
		if (/^(0|[1-9]\d*)$/u.test(key)) return undefined;
	}
	for (const [condition, value] of Object.entries(target)) {
		if (condition !== 'default' && !nodeImportConditions.has(condition)) continue;
		const resolved = resolvePackageTarget(value, packageRoot, patternMatch);
		if (resolved !== undefined) return resolved;
	}
	return undefined;
}

function resolvePackageTargetString(target: string, packageRoot: string, patternMatch: string | undefined): string | undefined {
	if (!target.startsWith('./') || target.includes('?') || target.includes('#')) return undefined;
	if (patternMatch === undefined && target.includes('*')) return undefined;
	if (patternMatch !== undefined && !validPackagePathSegments(patternMatch, false)) return undefined;
	const expanded = patternMatch === undefined ? target : target.replaceAll('*', patternMatch);
	if (!validPackagePathSegments(expanded, true)) return undefined;
	try {
		const packageUrl = pathToFileURL(`${resolve(packageRoot)}/`);
		const targetUrl = new URL(expanded, packageUrl);
		if (targetUrl.protocol !== 'file:' || targetUrl.search.length > 0 || targetUrl.hash.length > 0) return undefined;
		const candidate = fileURLToPath(targetUrl);
		const locator = relative(resolve(packageRoot), candidate).replaceAll('\\', '/');
		if (locator.length === 0 || locator === '..' || locator.startsWith('../') || locator.startsWith('/')) return undefined;
		return candidate;
	} catch {
		return undefined;
	}
}

function validPackagePathSegments(value: string, allowLeadingDot: boolean): boolean {
	const segments = value.split(/[\\/]/u);
	const start = allowLeadingDot && segments[0] === '.' ? 1 : 0;
	if (allowLeadingDot && start === 0) return false;
	for (const rawSegment of segments.slice(start)) {
		if (rawSegment.length === 0) return false;
		let decoded: string;
		try { decoded = decodeURIComponent(rawSegment); } catch { return false; }
		const lowered = decoded.toLowerCase();
		if (decoded.includes('/') || decoded.includes('\\') || lowered === '.' || lowered === '..' || lowered === 'node_modules') return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function comparePackagePatternKeys(left: string, right: string): number {
	const leftBase = left.indexOf('*');
	const rightBase = right.indexOf('*');
	if (leftBase !== rightBase) return rightBase - leftBase;
	return right.length - left.length;
}

function packagePatternMatch(pattern: string, subpath: string): string | undefined {
	const star = pattern.indexOf('*');
	if (star < 0 || pattern.indexOf('*', star + 1) >= 0) return undefined;
	const prefix = pattern.slice(0, star);
	const suffix = pattern.slice(star + 1);
	if (!subpath.startsWith(prefix) || subpath === prefix) return undefined;
	if (suffix.length > 0 && (!subpath.endsWith(suffix) || subpath.length < pattern.length)) return undefined;
	const match = subpath.slice(prefix.length, subpath.length - suffix.length);
	return match.length === 0 ? undefined : match;
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