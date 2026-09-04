import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';
import type {
	CanonicalForeignTypeIdentity,
	ContextualCallablePrimitiveKind,
	ContextualCallableResult,
	ForeignCallResolution,
	ForeignIndexResolution,
	ForeignObjectResolution,
	ForeignPrimitiveKind,
	ForeignTypeRef,
	ForeignTypeSnapshot,
	ForeignWriteResolution,
	InteropArgumentType,
	InteropCallableArgumentResolution,
	InteropCallTarget,
	InteropCallUsage,
	InteropIndexUsage,
	InteropObjectArgumentResolution,
	InteropObjectUsage,
	InteropWriteUsage,
	JsImportRequest,
	JsImportResolution,
	JsInteropProvider,
	ModuleResolutionWitness,
	NativeCallablePrimitiveKind,
	NativeCallableTypeTemplate,
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

interface UsageProbeContext {
	readonly stored: StoredType;
	readonly workspace: ProbeWorkspace;
	readonly directory: string;
	readonly imports: Set<string>;
	readonly declarations: string[];
	target: string;
	nextValueId: number;
}

interface UsageProbeResult {
	readonly checker: ts.TypeChecker;
	readonly initializer: ts.Expression;
	readonly virtualFileName: string;
}

interface RuntimePackageJson {
	readonly name?: string;
	readonly type?: string;
	readonly main?: string;
	readonly exports?: unknown;
}

const invalidPackageTarget = Symbol('invalid-package-target');
type PackageTargetResolution = string | null | undefined | typeof invalidPackageTarget;

/**
 * Conservative provider. Whole usages are resolved by TypeScript itself inside
 * one fixed Program session. Legacy per-signature call/construct entry points
 * remain public only for compatibility with callers that have not adopted the
 * whole-usage contract.
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
	readonly #references = new Set<ForeignTypeRef>();
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
		for (const [name, value] of [
			['resolveCallUsage', (reference: ForeignTypeRef, usage: InteropCallUsage) => this.resolveInvocationUsage(reference, usage, false)],
			['resolveConstructUsage', (reference: ForeignTypeRef, usage: InteropCallUsage) => this.resolveInvocationUsage(reference, usage, true)],
			['resolveIndexUsage', (reference: ForeignTypeRef, usage: InteropIndexUsage) => this.resolveIndexUsageInternal(reference, usage)],
			['resolveWriteUsage', (reference: ForeignTypeRef, usage: InteropWriteUsage) => this.resolveWriteUsageInternal(reference, usage)],
			['resolveObjectUsage', (reference: ForeignTypeRef, usage: InteropObjectUsage) => this.resolveObjectUsageInternal(reference, usage)],
		] as const) {
			Object.defineProperty(this, name, { value, enumerable: false, configurable: false, writable: false });
		}
	}

	public dispose(): void {
		this.#types.clear();
		this.#references.clear();
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
		if (property.declarations?.some(declaration => {
			const modifiers = ts.getCombinedModifierFlags(declaration);
			return (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
		}) === true) return undefined;
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

	private resolveIndexUsageInternal(reference: ForeignTypeRef, usage: InteropIndexUsage): ForeignIndexResolution | undefined {
		const context = this.createUsageProbeContext(reference);
		if (context === undefined) return undefined;
		const literalKey = usage.index.kind === 'native-primitive' && usage.index.literal !== undefined
			? usage.index.literal.kind === 'String'
				? usage.index.literal.value
				: (usage.index.literal.kind === 'Int' || usage.index.literal.kind === 'Float')
					&& renderInteropLiteral(usage.index.primitive, usage.index.literal) !== undefined
					? String(usage.index.literal.value)
					: undefined
			: undefined;
		if (literalKey !== undefined) {
			const property = context.stored.checker.getPropertyOfType(context.stored.type, literalKey);
			if (property?.declarations?.some(declaration => {
				const modifiers = ts.getCombinedModifierFlags(declaration);
				return (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
			}) === true) return undefined;
		}
		const index = this.renderUsageValue(usage.index, context, false, false);
		if (index === undefined) return undefined;
		const probe = this.runUsageProbe(context, `${context.target}[${index}]`);
		if (probe === undefined) return undefined;
		const result = probe.checker.getTypeAtLocation(probe.initializer);
		if ((result.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0) return undefined;
		const resultProjection: UsageProjection = {
			typeExpression: `(typeof import(${JSON.stringify(`./${probe.virtualFileName}`)}))["__viruneResult"]`,
			directory: context.directory,
		};
		return { result: this.store(result, probe.checker, probe.initializer, context.stored.origin, context.workspace, resultProjection) };
	}

	private resolveWriteUsageInternal(reference: ForeignTypeRef, usage: InteropWriteUsage): ForeignWriteResolution | undefined {
		const context = this.createUsageProbeContext(reference);
		if (context === undefined) return undefined;
		let left: string;
		let value: string | undefined;
		if (usage.kind === 'property') {
			left = `${context.target}.${safeTsName(usage.property)}`;
			value = this.renderUsageValue(usage.value, context, false, true);
		} else {
			const literalKey = usage.index.kind === 'native-primitive' && usage.index.literal !== undefined
				? usage.index.literal.kind === 'String'
					? usage.index.literal.value
					: (usage.index.literal.kind === 'Int' || usage.index.literal.kind === 'Float')
						&& renderInteropLiteral(usage.index.primitive, usage.index.literal) !== undefined
						? String(usage.index.literal.value)
						: undefined
				: undefined;
			if (literalKey !== undefined) {
				const property = context.stored.checker.getPropertyOfType(context.stored.type, literalKey);
				if (property?.declarations?.some(declaration => {
					const modifiers = ts.getCombinedModifierFlags(declaration);
					return (modifiers & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
				}) === true) return undefined;
			}
			const index = this.renderUsageValue(usage.index, context, false, false);
			value = this.renderUsageValue(usage.value, context, false, true);
			if (index === undefined) return undefined;
			left = `${context.target}[${index}]`;
		}
		if (value === undefined) return undefined;
		const probe = this.runUsageProbe(context, `${left} = ${value}`);
		if (probe === undefined || !ts.isBinaryExpression(probe.initializer) || probe.initializer.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
		const destination = probe.checker.getTypeAtLocation(probe.initializer.left);
		if ((destination.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0) return undefined;
		if (usage.value.kind !== 'contextual-object') return { accepted: true };
		const literal = unwrapObjectLiteral(probe.initializer.right);
		if (literal === undefined) return undefined;
		const objectValue = this.objectResolutionFromLiteral(literal, usage.value.object, probe.checker, context.workspace);
		return objectValue === undefined ? undefined : { accepted: true, objectValue };
	}

	private resolveObjectUsageInternal(reference: ForeignTypeRef, usage: InteropObjectUsage): ForeignObjectResolution | undefined {
		const context = this.createUsageProbeContext(reference);
		if (context === undefined || context.stored.usageProjection === undefined) return undefined;
		const rendered = this.renderUsageValue({ kind: 'contextual-object', object: usage }, context, true, true);
		if (rendered === undefined) return undefined;
		const probe = this.runUsageProbe(context, `${rendered} satisfies ${context.stored.usageProjection.typeExpression}`);
		if (probe === undefined) return undefined;
		const literal = unwrapObjectLiteral(probe.initializer);
		return literal === undefined ? undefined : this.objectResolutionFromLiteral(literal, usage, probe.checker, context.workspace);
	}

	private createUsageProbeContext(reference: ForeignTypeRef): UsageProbeContext | undefined {
		const stored = this.lookupType(reference);
		if (stored === undefined || stored.usageProjection === undefined) return undefined;
		const flags = stored.type.getFlags();
		if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return undefined;
		const imports = new Set<string>();
		if (stored.usageProjection.declaration !== undefined) imports.add(stored.usageProjection.declaration);
		const declarations = ['export {};'];
		let target: string;
		if (stored.usageProjection.valueExpression !== undefined) target = stored.usageProjection.valueExpression;
		else {
			declarations.push(`declare const __viruneTarget: ${stored.usageProjection.typeExpression};`);
			target = '__viruneTarget';
		}
		return {
			stored,
			workspace: stored.workspace,
			directory: stored.usageProjection.directory,
			imports,
			declarations,
			target,
			nextValueId: 0,
		};
	}

	private renderUsageValue(argument: InteropArgumentType, context: UsageProbeContext, allowNativeCallable: boolean, allowObject: boolean, depth = 0, preserveForeignEvidence = false): string | undefined {
		if (depth > 12) return undefined;
		if (argument.kind === 'unknown') {
			if (depth !== 0) return undefined;
			const name = `__viruneValue${context.nextValueId++}`;
			context.declarations.push(`declare const ${name}: unknown;`);
			return name;
		}
		if (argument.kind === 'contextual-object') {
			if (!allowObject) return undefined;
			const seen = new Set<string>();
			const entries: string[] = [];
			for (const entry of argument.object.entries) {
				if (typeof entry.property !== 'string' || entry.property.length === 0 || seen.has(entry.property)) return undefined;
				seen.add(entry.property);
				const value = this.renderUsageValue(entry.value, context, true, true, depth + 1, preserveForeignEvidence);
				if (value === undefined) return undefined;
				entries.push(`[${JSON.stringify(entry.property)}]: ${value}`);
			}
			return `({ ${entries.join(', ')} })`;
		}
		if (argument.kind === 'foreign') {
			const source = this.lookupType(argument.type);
			if (source === undefined || source.workspace !== context.workspace || source.usageProjection === undefined || source.usageProjection.directory !== context.directory) return undefined;
			if (source.usageProjection.declaration !== undefined) context.imports.add(source.usageProjection.declaration);
			const sourceType = preserveForeignEvidence || !foreignTypeRequiresUnknownProjection(source.type, source.checker, source.location)
				? source.usageProjection.typeExpression
				: 'unknown';
			const name = `__viruneValue${context.nextValueId++}`;
			context.declarations.push(`declare const ${name}: ${sourceType};`);
			return name;
		}
		if (argument.kind === 'contextual-callable') {
			if (!allowNativeCallable || !Number.isSafeInteger(argument.parameterCount) || argument.parameterCount < 0 || argument.parameterCount > 64 || typeof argument.async !== 'boolean') return undefined;
			const parameters = Array.from({ length: argument.parameterCount }, (_, index) => `$arg${index}`);
			return `${argument.async ? 'async ' : ''}(${parameters.join(', ')}) => { throw new Error("__virune_contextual_probe"); }`;
		}
		if (argument.kind === 'native-callable') {
			if (!allowNativeCallable) return undefined;
			const sourceType = this.renderNativeCallableType(argument.callable, context);
			if (sourceType === undefined) return undefined;
			const name = `__viruneValue${context.nextValueId++}`;
			context.declarations.push(`declare const ${name}: ${sourceType};`);
			return name;
		}
		const literal = argument.literal === undefined ? undefined : renderInteropLiteral(argument.primitive, argument.literal);
		if (argument.literal !== undefined && literal === undefined) return undefined;
		if (literal !== undefined) return literal;
		if (argument.primitive === 'Unit') return 'undefined';
		const name = `__viruneValue${context.nextValueId++}`;
		context.declarations.push(`declare const ${name}: ${typescriptPrimitiveName(argument.primitive)};`);
		return name;
	}

	private renderNativeCallableType(callable: NativeCallableTypeTemplate, context: UsageProbeContext): string | undefined {
		const parameters: string[] = [];
		for (let index = 0; index < callable.parameters.length; index++) {
			const rendered = this.renderNativeCallableValue(callable.parameters[index]!, context, false);
			if (rendered === undefined) return undefined;
			parameters.push(`$arg${index}: ${rendered}`);
		}
		const result = this.renderNativeCallableValue(callable.result, context, true);
		if (result === undefined || typeof callable.async !== 'boolean') return undefined;
		return `(${parameters.join(', ')}) => ${callable.async ? `Promise<${result}>` : result}`;
	}

	private renderNativeCallableValue(value: NativeCallableTypeTemplate['result'], context: UsageProbeContext, allowNever: boolean): string | undefined {
		if (value === 'Never') return allowNever ? 'never' : undefined;
		if (typeof value === 'string') return allowNever ? typescriptCallableResultName(value) : typescriptCallbackParameterName(value);
		const source = this.lookupType(value.type);
		if (source === undefined || source.workspace !== context.workspace || source.usageProjection === undefined || source.usageProjection.directory !== context.directory) return undefined;
		if (source.usageProjection.declaration !== undefined) context.imports.add(source.usageProjection.declaration);
		return source.usageProjection.typeExpression;
	}

	private contextualCallableShape(
		type: ts.Type,
		checker: ts.TypeChecker,
		location: ts.Node,
		parameterCount: number,
		callable: NativeCallableTypeTemplate | undefined,
		workspace: ProbeWorkspace,
		origin: ForeignTypeSnapshot['origin'],
		directory: string,
	): InteropCallableArgumentResolution['target'] | undefined {
		const signature = contextualCallableSignature(type, checker);
		if (signature === undefined) return undefined;
		const parameters = signature.getParameters();
		if (parameters.length < parameterCount) return undefined;
		const parameterTypes: InteropCallableArgumentResolution['target']['parameters'][number][] = [];
		for (let index = 0; index < parameterCount; index++) {
			const parameter = parameters[index];
			if (parameter === undefined) return undefined;
			const parameterType = checker.getTypeOfSymbolAtLocation(parameter, location);
			const value = this.contextualCallableValue(parameterType, checker, location, workspace, origin, directory);
			if (value === undefined) return undefined;
			parameterTypes.push(value);
		}
		let result: ContextualCallableResult;
		if (callable === undefined) result = Object.freeze({ kind: 'deferred' });
		else if (callable.result === 'Never' || typeof callable.result !== 'string') result = Object.freeze({ kind: 'external' });
		else {
			const resultType = checker.getReturnTypeOfSignature(signature);
			const contextual = contextualCallbackResultForNativeCallable(resultType, checker, callable);
			if (contextual === undefined) return undefined;
			result = contextual;
		}
		return Object.freeze({ parameters: Object.freeze(parameterTypes), result });
	}

	private contextualCallableValue(type: ts.Type, checker: ts.TypeChecker, location: ts.Node, workspace: ProbeWorkspace, origin: ForeignTypeSnapshot['origin'], directory: string): InteropCallableArgumentResolution['target']['parameters'][number] | undefined {
		const primitive = contextualPrimitiveKind(type);
		if (primitive !== undefined) return primitive;
		const flags = type.getFlags();
		const unsafeFlags = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter | ts.TypeFlags.Union;
		if ((flags & unsafeFlags) !== 0) return undefined;
		if ((flags & ts.TypeFlags.Intersection) !== 0 && (type as ts.IntersectionType).types.some(item => (item.getFlags() & unsafeFlags) !== 0)) return undefined;
		const typeExpression = renderContextualTypeExpression(type, checker, location);
		if (typeExpression === undefined) return undefined;
		return this.store(type, checker, location, origin, workspace, { typeExpression, directory });
	}

	private runUsageProbe(context: UsageProbeContext, expression: string): UsageProbeResult | undefined {
		const importText = [...context.imports].sort().join('\n');
		const sourceText = `${importText.length === 0 ? '' : `${importText}\n`}${context.declarations.join('\n')}\nexport const __viruneResult = ${expression};\n`;
		const extension = context.workspace.platform === 'node' ? 'mts' : 'ts';
		const virtualFileName = `.virune-interop-operation-${context.workspace.platform}-${hash(sourceText)}.${extension}`;
		const virtualPath = join(context.directory, virtualFileName);
		const virtualKey = canonicalFilePath(virtualPath);
		const existing = context.workspace.virtualFiles.get(virtualKey);
		if (existing === undefined) {
			context.workspace.virtualFiles.set(virtualKey, { path: virtualPath, text: sourceText, version: 1 });
			context.workspace.projectVersion++;
		} else if (existing.text !== sourceText) return undefined;
		const program = context.workspace.languageService.getProgram();
		if (program === undefined) return undefined;
		const diagnostics = [
			...context.workspace.languageService.getCompilerOptionsDiagnostics(),
			...context.workspace.languageService.getSyntacticDiagnostics(virtualPath),
			...context.workspace.languageService.getSemanticDiagnostics(virtualPath),
		];
		if (diagnostics.some(item => item.category === ts.DiagnosticCategory.Error)) return undefined;
		const sourceFile = program.getSourceFile(virtualPath)
			?? program.getSourceFiles().find(item => canonicalFilePath(item.fileName) === virtualKey);
		const declaration = sourceFile?.statements
			.filter(ts.isVariableStatement)
			.flatMap(statement => [...statement.declarationList.declarations])
			.find(item => ts.isIdentifier(item.name) && item.name.text === '__viruneResult');
		if (declaration?.initializer === undefined) return undefined;
		return { checker: program.getTypeChecker(), initializer: declaration.initializer, virtualFileName };
	}

	private resolveInvocationUsage(reference: ForeignTypeRef, usage: InteropCallUsage, construct: boolean): ForeignCallResolution | undefined {
		const stored = this.lookupType(reference);
		if (stored === undefined || (stored.type.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return undefined;
		const callSignatures = stored.type.getCallSignatures();
		const constructSignatures = stored.type.getConstructSignatures();
		if (construct) {
			if (constructSignatures.length === 0 || callSignatures.length !== 0) return undefined;
		} else if (callSignatures.length === 0) return undefined;
		if (usage.arguments.some(argument => argument.kind === 'native-callable' || hasContextualCallable(argument)) && this.#compilerOptions.strictNullChecks !== true) return undefined;
		const context = this.createUsageProbeContext(reference);
		if (context === undefined) return undefined;
		if (!construct) {
			if (usage.target.kind === 'member') {
				const receiver = this.lookupType(usage.target.receiver);
				if (receiver === undefined || receiver.workspace !== context.workspace || receiver.usageProjection === undefined || receiver.usageProjection.directory !== context.directory) return undefined;
				if ((receiver.type.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return undefined;
				if (receiver.usageProjection.declaration !== undefined) context.imports.add(receiver.usageProjection.declaration);
				const property = JSON.stringify(usage.target.property);
				const expectedType = `(${receiver.usageProjection.typeExpression})[${property}]`;
				if (stored.usageProjection?.typeExpression !== expectedType) return undefined;
				if (receiver.usageProjection.valueExpression !== undefined) context.target = `(${receiver.usageProjection.valueExpression})[${property}]`;
				else {
					context.declarations.push(`declare const __viruneReceiver: ${receiver.usageProjection.typeExpression};`);
					context.target = `__viruneReceiver[${property}]`;
				}
			} else if (usage.target.kind === 'indexed-member') {
				const receiver = this.lookupType(usage.target.receiver);
				if (receiver === undefined || receiver.workspace !== context.workspace || receiver.usageProjection === undefined || receiver.usageProjection.directory !== context.directory) return undefined;
				if ((receiver.type.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return undefined;
				if (receiver.usageProjection.declaration !== undefined) context.imports.add(receiver.usageProjection.declaration);
				const index = this.renderUsageValue(usage.target.index, context, false, false);
				if (index === undefined) return undefined;
				if (receiver.usageProjection.valueExpression !== undefined) context.target = `(${receiver.usageProjection.valueExpression})[${index}]`;
				else {
					context.declarations.push(`declare const __viruneReceiver: ${receiver.usageProjection.typeExpression};`);
					context.target = `__viruneReceiver[${index}]`;
				}
			}
		}
		const argumentExpressions: string[] = [];
		for (const argument of usage.arguments) {
			const rendered = this.renderUsageValue(argument, context, true, true, 0, !construct);
			if (rendered === undefined) return undefined;
			argumentExpressions.push(rendered);
		}
		const invocationText = construct
			? `new (${context.target})(${argumentExpressions.join(', ')})`
			: `${context.target}(${argumentExpressions.join(', ')})`;
		const probe = this.runUsageProbe(context, invocationText);
		if (probe === undefined) return undefined;
		const invocation = probe.initializer;
		if (construct ? !ts.isNewExpression(invocation) : !ts.isCallExpression(invocation)) return undefined;
		const signature = probe.checker.getResolvedSignature(invocation as ts.CallLikeExpression);
		if (signature === undefined) return undefined;
		const resolvedResult = probe.checker.getReturnTypeOfSignature(signature);
		const provisionalSyncContext = !construct && usage.arguments.some(hasSyncContextualCallable);
		if (!provisionalSyncContext) {
			if ((resolvedResult.getFlags() & (ts.TypeFlags.Any | (construct ? ts.TypeFlags.Unknown : ts.TypeFlags.Never))) !== 0) return undefined;
			if (!resolvedGenericResultIsConcrete(signature, probe.checker, invocation)) return undefined;
		}
		const result = resolvedResult;
		const invocationArguments = ts.isCallExpression(invocation)
			? invocation.arguments
			: ts.isNewExpression(invocation)
				? invocation.arguments ?? ts.factory.createNodeArray<ts.Expression>()
				: ts.factory.createNodeArray<ts.Expression>();
		const parameters = signature.getParameters();
		const callableArguments: InteropCallableArgumentResolution[] = [];
		const contextualCallableArguments: InteropCallableArgumentResolution[] = [];
		const objectArguments: InteropObjectArgumentResolution[] = [];
		for (let index = 0; index < usage.arguments.length; index++) {
			const argument = usage.arguments[index]!;
			const node = invocationArguments[index];
			if (node === undefined) return undefined;
			if (!construct && !this.callArgumentPreservesAnySafety(argument, node, probe.checker)) return undefined;
			if (argument.kind === 'native-callable' || argument.kind === 'contextual-callable') {
				const contextual = probe.checker.getContextualType(node);
				if (contextual === undefined) return undefined;
				const callable = argument.kind === 'native-callable' ? argument.callable : undefined;
				const parameterCount = argument.kind === 'native-callable' ? argument.callable.parameters.length : argument.parameterCount;
				const target = this.contextualCallableShape(contextual, probe.checker, node, parameterCount, callable, context.workspace, stored.origin, context.directory);
				if (target === undefined) return undefined;
				const evidence = { index, target };
				if (argument.kind === 'native-callable') callableArguments.push(evidence);
				else contextualCallableArguments.push(evidence);
			} else if (argument.kind === 'contextual-object') {
				const literal = unwrapObjectLiteral(node);
				if (literal === undefined) return undefined;
				const object = this.objectResolutionFromLiteral(literal, argument.object, probe.checker, context.workspace);
				if (object === undefined) return undefined;
				objectArguments.push({ index, object });
			}
		}
		const { minimum, optional, rest } = signatureArity(parameters);
		const resultProjection: UsageProjection = {
			typeExpression: `(typeof import(${JSON.stringify(`./${probe.virtualFileName}`)}))["__viruneResult"]`,
			directory: context.directory,
		};
		const resultSnapshot = this.store(result, probe.checker, invocation, stored.origin, context.workspace, resultProjection);
		return {
			result: resultSnapshot,
			parameterCount: parameters.length,
			optionalParameterCount: optional,
			minimumArgumentCount: minimum,
			rest,
			mayReject: resultSnapshot.category === 'promise',
			receiverMode: !construct && usage.target.kind !== 'value' ? 'preserve-this' : 'none',
			...(callableArguments.length === 0 ? {} : { callableArguments: Object.freeze(callableArguments) }),
			...(contextualCallableArguments.length === 0 ? {} : { contextualCallableArguments: Object.freeze(contextualCallableArguments) }),
			...(objectArguments.length === 0 ? {} : { objectArguments: Object.freeze(objectArguments) }),
		};
	}

	private callArgumentPreservesAnySafety(argument: InteropArgumentType, node: ts.Expression, checker: ts.TypeChecker): boolean {
		if (argument.kind === 'foreign') {
			const actual = checker.getTypeAtLocation(node);
			if (!foreignTypeRequiresUnknownProjection(actual, checker, node)) return true;
			const contextual = checker.getContextualType(node);
			return contextual !== undefined && foreignAssignmentPreservesAnySafety(actual, contextual, checker);
		}
		if (argument.kind !== 'contextual-object') return true;
		const literal = unwrapObjectLiteral(node);
		if (literal === undefined || literal.properties.length !== argument.object.entries.length) return false;
		for (let index = 0; index < argument.object.entries.length; index++) {
			const entry = argument.object.entries[index]!;
			const property = literal.properties[index];
			if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isComputedPropertyName(property.name) || !ts.isStringLiteral(property.name.expression) || property.name.expression.text !== entry.property) return false;
			if (!this.callArgumentPreservesAnySafety(entry.value, property.initializer, checker)) return false;
		}
		return true;
	}

	private objectResolutionFromLiteral(literal: ts.ObjectLiteralExpression, usage: InteropObjectUsage, checker: ts.TypeChecker, workspace: ProbeWorkspace): ForeignObjectResolution | undefined {
		if (literal.properties.length !== usage.entries.length) return undefined;
		const entries: { readonly index: number; readonly property: string; readonly callable?: InteropCallableArgumentResolution['target']; readonly object?: ForeignObjectResolution }[] = [];
		for (let index = 0; index < usage.entries.length; index++) {
			const usageEntry = usage.entries[index]!;
			const property = literal.properties[index];
			if (property === undefined || !ts.isPropertyAssignment(property) || !ts.isComputedPropertyName(property.name) || !ts.isStringLiteral(property.name.expression) || property.name.expression.text !== usageEntry.property) return undefined;
			const contextual = checker.getContextualType(property.initializer);
			if (contextual === undefined || (contextual.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) !== 0) return undefined;
			if (usageEntry.value.kind === 'contextual-callable') {
				const callable = this.contextualCallableShape(contextual, checker, property.initializer, usageEntry.value.parameterCount, undefined, workspace, undefined, dirname(property.initializer.getSourceFile().fileName));
				if (callable === undefined) return undefined;
				entries.push({ index, property: usageEntry.property, callable });
			} else if (usageEntry.value.kind === 'native-callable') {
				const callable = this.contextualCallableShape(contextual, checker, property.initializer, usageEntry.value.callable.parameters.length, usageEntry.value.callable, workspace, undefined, dirname(property.initializer.getSourceFile().fileName));
				if (callable === undefined) return undefined;
				entries.push({ index, property: usageEntry.property, callable });
			} else if (usageEntry.value.kind === 'contextual-object') {
				const nestedLiteral = unwrapObjectLiteral(property.initializer);
				if (nestedLiteral === undefined) return undefined;
				const object = this.objectResolutionFromLiteral(nestedLiteral, usageEntry.value.object, checker, workspace);
				if (object === undefined) return undefined;
				entries.push({ index, property: usageEntry.property, object });
			} else entries.push({ index, property: usageEntry.property });
		}
		const result = checker.getTypeAtLocation(literal);
		if ((result.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) !== 0) return undefined;
		return { result: this.store(result, checker, literal, undefined, workspace), entries: Object.freeze(entries) };
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
		if (argument.kind === 'unknown' || argument.kind === 'native-callable' || argument.kind === 'contextual-callable' || argument.kind === 'contextual-object') return false;
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
		if (reference.providerId !== this.id || reference.generation !== this.generation || !this.#references.has(reference)) return undefined;
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
		const resolved = ts.resolveModuleName(request.moduleSpecifier, virtualPath, workspace.compilerOptions, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
		return { program, checker, sourceFile, workspace, ...(expression === undefined ? {} : { valueNode: expression }), ...(alias === undefined ? {} : { typeNode: alias }), ...(resolved === undefined ? {} : { resolvedModule: resolved }) };
	}

	private probeWorkspace(platform: JsImportRequest['platform']): ProbeWorkspace {
		const existing = this.#workspaces.get(platform);
		if (existing !== undefined) return existing;
		const typeRoots = platform === 'node' ? nodeTypeRoots(this.#compilerOptions.typeRoots) : this.#compilerOptions.typeRoots;
		const configuredCompilerOptions = { ...this.#compilerOptions };
		delete configuredCompilerOptions.baseUrl;
		delete configuredCompilerOptions.paths;
		delete configuredCompilerOptions.rootDirs;
		delete configuredCompilerOptions.moduleSuffixes;
		delete configuredCompilerOptions.resolvePackageJsonExports;
		delete configuredCompilerOptions.resolvePackageJsonImports;
		const platformConditions = platform === 'node'
			? ['node-addons', 'module-sync']
			: platform === 'browser' ? ['browser'] : [];
		const targetCompilerOptions: ts.CompilerOptions = platform === 'node'
			? {
				module: ts.ModuleKind.NodeNext,
				moduleResolution: ts.ModuleResolutionKind.NodeNext,
				customConditions: normalizedCustomConditions(platformConditions),
			}
			: {
				module: ts.ModuleKind.ESNext,
				moduleResolution: ts.ModuleResolutionKind.Bundler,
				customConditions: normalizedCustomConditions(platformConditions),
			};
		const compilerOptions: ts.CompilerOptions = {
			...configuredCompilerOptions,
			...targetCompilerOptions,
			resolvePackageJsonExports: true,
			resolvePackageJsonImports: true,
			preserveSymlinks: false,
			allowArbitraryExtensions: false,
			resolveJsonModule: false,
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
		const ref = Object.freeze<ForeignTypeRef>({ providerId: this.id, generation: this.generation, id });
		const rawDisplay = checker.typeToString(type, location, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
		const display = stableTypeDisplay(rawDisplay, origin, this.#projectRoot);
		this.#references.add(ref);
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
		const canonicalIdentity = category === 'promise' ? canonicalForeignTypeIdentity(type, checker) : undefined;
		return {
			ref,
			display,
			category,
			...(primitive === undefined ? {} : { primitive }),
			...(category === 'promise' ? { mustUse: true } : {}),
			...(canonicalIdentity === undefined ? {} : { canonicalIdentity }),
			...(origin === undefined ? {} : { origin }),
		};
	}

	private requireType(reference: ForeignTypeRef): StoredType {
		const type = this.lookupType(reference);
		if (type === undefined) {
			const staleOrForeign = reference.providerId !== this.id || reference.generation !== this.generation || this.#types.has(reference.id) && !this.#references.has(reference);
			throw new Error(staleOrForeign ? 'Stale or foreign JavaScript type handle' : 'Unknown JavaScript type handle');
		}
		return type;
	}

	private moduleWitness(request: JsImportRequest, resolved: ts.ResolvedModuleFull | undefined): ModuleResolutionWitness {
		const declarationInfo = findPackageInfo(resolved?.resolvedFileName);
		const runtime = resolveRuntimeModule(request, new Set<string>(nodeDefaultImportConditions));
		const runtimeInfo = runtime.path === undefined ? {} : findRuntimePackageInfo(request, runtime.path);
		const runtimeScopeInfo = runtime.path === undefined ? {} : findPackageInfo(runtime.path);
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
			conditions: witnessConditionsForPlatform(request.platform),
			platform: request.platform,
			providerVersion: this.version,
			...(resolved?.resolvedFileName === undefined || !existsSync(resolved.resolvedFileName) ? {} : { declarationGraphHash: hash(readFileSync(resolved.resolvedFileName)) }),
			...(runtimeScopeInfo.packageJsonPath === undefined ? {} : { packageJsonHash: hash(readFileSync(runtimeScopeInfo.packageJsonPath)) }),
			...(declarationInfo.packageJsonPath === undefined ? {} : { declarationPackageJsonHash: hash(readFileSync(declarationInfo.packageJsonPath)) }),
		};
	}
}

function unwrapObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
	let current = expression;
	while (ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
	return ts.isObjectLiteralExpression(current) ? current : undefined;
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

function canonicalForeignTypeIdentity(type: ts.Type, checker: ts.TypeChecker): CanonicalForeignTypeIdentity | undefined {
	try {
		const globalPromise = checker.resolveName('Promise', undefined, ts.SymbolFlags.Type, false);
		if (globalPromise === undefined) return undefined;
		const objectType = (type.getFlags() & ts.TypeFlags.Object) === 0 ? undefined : type as ts.ObjectType;
		const candidate = objectType !== undefined && (objectType.objectFlags & ts.ObjectFlags.Reference) !== 0
			? (type as ts.TypeReference).target.getSymbol()
			: type.getSymbol();
		if (candidate === undefined) return undefined;
		const expected = (globalPromise.flags & ts.SymbolFlags.Alias) === 0 ? globalPromise : checker.getAliasedSymbol(globalPromise);
		const actual = (candidate.flags & ts.SymbolFlags.Alias) === 0 ? candidate : checker.getAliasedSymbol(candidate);
		return actual === expected ? 'ecmascript:Promise' : undefined;
	} catch {
		return undefined;
	}
}

function hasContextualCallable(argument: InteropArgumentType): boolean {
	return argument.kind === 'contextual-callable'
		|| argument.kind === 'contextual-object' && argument.object.entries.some(entry => hasContextualCallable(entry.value));
}

function hasSyncContextualCallable(argument: InteropArgumentType): boolean {
	return argument.kind === 'contextual-callable' ? argument.async === false
		: argument.kind === 'contextual-object' && argument.object.entries.some(entry => hasSyncContextualCallable(entry.value));
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

function sameForeignTypeIdentity(actual: ts.Type, contextual: ts.Type, checker: ts.TypeChecker): boolean {
	if (actual === contextual) return true;
	if (contextual.isUnion()) return contextual.types.some(item => sameForeignTypeIdentity(actual, item, checker));
	if (actual.isUnion()) {
		if (!contextual.isUnion() || actual.types.length !== contextual.types.length) return false;
		return actual.types.every(item => contextual.types.some(candidate => sameForeignTypeIdentity(item, candidate, checker)));
	}
	const invalid = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter;
	if ((actual.getFlags() & invalid) !== 0 || (contextual.getFlags() & invalid) !== 0) return false;
	if ((actual.getFlags() & ts.TypeFlags.Object) === 0 || (contextual.getFlags() & ts.TypeFlags.Object) === 0) return false;
	const actualObject = actual as ts.ObjectType;
	const contextualObject = contextual as ts.ObjectType;
	const actualReference = (actualObject.objectFlags & ts.ObjectFlags.Reference) !== 0;
	const contextualReference = (contextualObject.objectFlags & ts.ObjectFlags.Reference) !== 0;
	if (actualReference !== contextualReference) return false;
	if (actualReference) {
		const actualRef = actual as ts.TypeReference;
		const contextualRef = contextual as ts.TypeReference;
		if (actualRef.target !== contextualRef.target) return false;
		const actualArguments = checker.getTypeArguments(actualRef);
		const contextualArguments = checker.getTypeArguments(contextualRef);
		return actualArguments.length === contextualArguments.length
			&& actualArguments.every((item, index) => sameForeignTypeIdentity(item, contextualArguments[index]!, checker));
	}
	const actualSymbol = actual.getSymbol();
	return actualSymbol !== undefined && actualSymbol === contextual.getSymbol();
}

function foreignAssignmentPreservesAnySafety(
	actual: ts.Type,
	contextual: ts.Type,
	checker: ts.TypeChecker,
	seen: Map<ts.Type, Set<ts.Type>> = new Map(),
	budget: { remaining: number } = { remaining: 1024 },
	depth = 0,
): boolean {
	try {
		if (budget.remaining-- <= 0 || depth > 24) return false;
		const contextualFlags = contextual.getFlags();
		if ((contextualFlags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return true;
		const actualFlags = actual.getFlags();
		if ((actualFlags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0) return false;
		if ((contextualFlags & (ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) !== 0) return false;
		if ((actualFlags & ts.TypeFlags.TypeParameter) !== 0) {
			const constraint = checker.getBaseConstraintOfType(actual);
			return constraint !== undefined && constraint !== actual
				&& foreignAssignmentPreservesAnySafety(constraint, contextual, checker, seen, budget, depth + 1);
		}
		if (!checker.isTypeAssignableTo(actual, contextual)) return false;
		if (sameForeignTypeIdentity(actual, contextual, checker)) return true;
		if (actual.isUnion()) {
			return actual.types.every(item => foreignAssignmentPreservesAnySafety(item, contextual, checker, seen, budget, depth + 1));
		}
		if (contextual.isUnion()) {
			return contextual.types.some(item => {
				const branchSeen = new Map<ts.Type, Set<ts.Type>>();
				for (const [source, targets] of seen) branchSeen.set(source, new Set(targets));
				return foreignAssignmentPreservesAnySafety(actual, item, checker, branchSeen, budget, depth + 1);
			});
		}
		if (primitiveKind(actual) !== undefined || primitiveKind(contextual) !== undefined) return true;
		if ((contextualFlags & ts.TypeFlags.NonPrimitive) !== 0) return isDefinitelyNonPrimitive(actual, checker);
		if ((actualFlags & ts.TypeFlags.Object) === 0 || (contextualFlags & ts.TypeFlags.Object) === 0) return false;

		const previous = seen.get(actual);
		if (previous?.has(contextual) === true) return true;
		if (previous === undefined) seen.set(actual, new Set([contextual]));
		else previous.add(contextual);

		const actualObject = actual as ts.ObjectType;
		const contextualObject = contextual as ts.ObjectType;
		const actualReference = (actualObject.objectFlags & ts.ObjectFlags.Reference) !== 0;
		const contextualReference = (contextualObject.objectFlags & ts.ObjectFlags.Reference) !== 0;
		if (actualReference && contextualReference) {
			const actualRef = actual as ts.TypeReference;
			const contextualRef = contextual as ts.TypeReference;
			if (actualRef.target === contextualRef.target) {
				const actualArguments = checker.getTypeArguments(actualRef);
				const contextualArguments = checker.getTypeArguments(contextualRef);
				return actualArguments.length === contextualArguments.length
					&& actualArguments.every((item, index) => foreignAssignmentPreservesAnySafety(item, contextualArguments[index]!, checker, seen, budget, depth + 1));
			}
		}

		for (const kind of [ts.SignatureKind.Call, ts.SignatureKind.Construct]) {
			const contextualSignatures = checker.getSignaturesOfType(contextual, kind);
			if (contextualSignatures.length === 0) continue;
			const actualSignatures = checker.getSignaturesOfType(actual, kind);
			if (actualSignatures.length !== 1 || contextualSignatures.length !== 1) return false;
			const actualSignature = actualSignatures[0]!;
			const contextualSignature = contextualSignatures[0]!;
			const actualThis = actualSignature.thisParameter;
			if (actualThis !== undefined) {
				const actualThisDeclaration = actualThis.valueDeclaration ?? actualThis.declarations?.[0] ?? actualSignature.declaration;
				if (actualThisDeclaration === undefined) return false;
				const actualThisType = checker.getTypeOfSymbolAtLocation(actualThis, actualThisDeclaration);
				if (foreignTypeRequiresUnknownProjection(actualThisType, checker, actualThisDeclaration)) {
					const contextualThis = contextualSignature.thisParameter;
					const contextualThisDeclaration = contextualThis?.valueDeclaration ?? contextualThis?.declarations?.[0] ?? contextualSignature.declaration;
					if (contextualThis === undefined || contextualThisDeclaration === undefined) return false;
					const contextualThisType = checker.getTypeOfSymbolAtLocation(contextualThis, contextualThisDeclaration);
					if (!foreignAssignmentPreservesAnySafety(actualThisType, contextualThisType, checker, seen, budget, depth + 1)) return false;
				}
			}
			const actualParameters = actualSignature.getParameters();
			const contextualParameters = contextualSignature.getParameters();
			const parameterCount = Math.min(actualParameters.length, contextualParameters.length);
			for (let index = 0; index < parameterCount; index++) {
				const actualParameter = actualParameters[index]!;
				const actualDeclaration = actualParameter.valueDeclaration ?? actualParameter.declarations?.[0] ?? actualSignature.declaration;
				if (actualDeclaration === undefined) return false;
				const actualParameterType = checker.getTypeOfSymbolAtLocation(actualParameter, actualDeclaration);
				if (!foreignTypeRequiresUnknownProjection(actualParameterType, checker, actualDeclaration)) continue;
				const contextualParameter = contextualParameters[index]!;
				const contextualDeclaration = contextualParameter.valueDeclaration ?? contextualParameter.declarations?.[0] ?? contextualSignature.declaration;
				if (contextualDeclaration === undefined) return false;
				const contextualParameterType = checker.getTypeOfSymbolAtLocation(contextualParameter, contextualDeclaration);
				if (!foreignAssignmentPreservesAnySafety(actualParameterType, contextualParameterType, checker, seen, budget, depth + 1)) return false;
			}
			const contextualResult = checker.getReturnTypeOfSignature(contextualSignature);
			if ((contextualResult.getFlags() & ts.TypeFlags.Void) !== 0) continue;
			const actualResult = checker.getReturnTypeOfSignature(actualSignature);
			if (!foreignAssignmentPreservesAnySafety(actualResult, contextualResult, checker, seen, budget, depth + 1)) return false;
		}

		for (const property of checker.getPropertiesOfType(contextual)) {
			const sourceProperty = checker.getPropertyOfType(actual, property.getName());
			if (sourceProperty === undefined) {
				if ((property.flags & ts.SymbolFlags.Optional) !== 0) continue;
				return false;
			}
			const contextualDeclaration = property.valueDeclaration ?? property.declarations?.[0];
			const actualDeclaration = sourceProperty.valueDeclaration ?? sourceProperty.declarations?.[0];
			if (contextualDeclaration === undefined || actualDeclaration === undefined) return false;
			const contextualProperty = checker.getTypeOfSymbolAtLocation(property, contextualDeclaration);
			const actualProperty = checker.getTypeOfSymbolAtLocation(sourceProperty, actualDeclaration);
			if (!foreignAssignmentPreservesAnySafety(actualProperty, contextualProperty, checker, seen, budget, depth + 1)) return false;
		}

		for (const indexInfo of checker.getIndexInfosOfType(contextual)) {
			const keyFlags = indexInfo.keyType.getFlags();
			const sourceIndex = (keyFlags & ts.TypeFlags.NumberLike) !== 0
				? checker.getIndexTypeOfType(actual, ts.IndexKind.Number)
				: (keyFlags & ts.TypeFlags.StringLike) !== 0
					? checker.getIndexTypeOfType(actual, ts.IndexKind.String)
					: undefined;
			if (sourceIndex === undefined || !foreignAssignmentPreservesAnySafety(sourceIndex, indexInfo.type, checker, seen, budget, depth + 1)) return false;
		}
		return true;
	} catch {
		return false;
	}
}

function resolvedGenericResultIsConcrete(signature: ts.Signature, checker: ts.TypeChecker, location: ts.Node): boolean {
	try {
		const declaration = signature.declaration;
		if (declaration === undefined) return (signature.getTypeParameters()?.length ?? 0) === 0;
		if (declaration.kind === ts.SyntaxKind.JSDocSignature) return false;
		const original = checker.getSignatureFromDeclaration(declaration);
		if (original === undefined) return false;
		const typeParameters = original.getTypeParameters() ?? [];
		if (typeParameters.length === 0) return true;
		const originalResult = checker.getReturnTypeOfSignature(original);
		const inferredArguments = checker.getTypeArgumentsForResolvedSignature(signature);
		for (let index = 0; index < typeParameters.length; index++) {
			const typeParameter = typeParameters[index]!;
			if (!typeParameterOccursInResult(originalResult, typeParameter, checker, location)) continue;
			const inferred = inferredArguments?.[index];
			if (inferred === undefined || typeContainsUnresolvedGenericResult(inferred, checker, location)) return false;
		}
		return true;
	} catch {
		return false;
	}
}

function typeParameterOccursInResult(
	type: ts.Type,
	target: ts.Type,
	checker: ts.TypeChecker,
	location: ts.Node,
	seen = new Set<ts.Type>(),
	budget: { remaining: number } = { remaining: 256 },
	depth = 0,
): boolean {
	try {
		if (type === target) return true;
		if (budget.remaining-- <= 0 || depth > 16) return true;
		if (seen.has(type)) return false;
		seen.add(type);
		if (type.isUnionOrIntersection() && type.types.some(item => typeParameterOccursInResult(item, target, checker, location, seen, budget, depth + 1))) return true;
		const flags = type.getFlags();
		if ((flags & ts.TypeFlags.Object) === 0) return false;
		const objectType = type as ts.ObjectType;
		if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
			const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
			if (typeArguments.some(item => typeParameterOccursInResult(item, target, checker, location, seen, budget, depth + 1))) return true;
			return false;
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
				if (typeParameterOccursInResult(thisType, target, checker, declaration, seen, budget, depth + 1)) return true;
			}
			for (const parameter of signature.getParameters()) {
				const declaration = parameter.valueDeclaration ?? parameter.declarations?.[0];
				if (declaration === undefined) return true;
				const parameterType = checker.getTypeOfSymbolAtLocation(parameter, declaration);
				if (typeParameterOccursInResult(parameterType, target, checker, declaration, seen, budget, depth + 1)) return true;
			}
			if (typeParameterOccursInResult(checker.getReturnTypeOfSignature(signature), target, checker, signatureLocation, seen, budget, depth + 1)) return true;
		}
		for (const indexInfo of checker.getIndexInfosOfType(type)) {
			if (typeParameterOccursInResult(indexInfo.type, target, checker, location, seen, budget, depth + 1)) return true;
		}
		for (const property of checker.getPropertiesOfType(type)) {
			const declaration = property.valueDeclaration ?? property.declarations?.[0] ?? location;
			const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
			if (typeParameterOccursInResult(propertyType, target, checker, declaration, seen, budget, depth + 1)) return true;
		}
		return false;
	} catch {
		return true;
	}
}

function typeContainsUnresolvedGenericResult(
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
		if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.TypeParameter)) !== 0) return true;
		if ((flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Never)) !== 0) return depth === 0;
		if (primitiveKind(type) !== undefined || (flags & (ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) !== 0) return false;
		if (seen.has(type)) return false;
		seen.add(type);
		if (type.isUnionOrIntersection()) return type.types.some(item => typeContainsUnresolvedGenericResult(item, checker, location, seen, budget, depth + 1));
		if ((flags & ts.TypeFlags.Object) === 0) return false;
		const objectType = type as ts.ObjectType;
		if ((objectType.objectFlags & ts.ObjectFlags.Reference) !== 0) {
			const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
			if (typeArguments.some(item => typeContainsUnresolvedGenericResult(item, checker, location, seen, budget, depth + 1))) return true;
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
	const extension = request.platform === 'node' ? 'mts' : 'ts';
	return `.virune-interop-${hash(`${request.moduleSpecifier}:${request.kind}:${request.importedName ?? ''}`)}.${extension}`;
}

function usageProjectionForImport(request: JsImportRequest): UsageProjection | undefined {
	if (request.kind === 'side-effect') return undefined;
	const moduleText = JSON.stringify(request.moduleSpecifier);
	const binding = `__viruneImport_${hash(`${request.moduleSpecifier}:${request.kind}:${request.importedName ?? ''}`).slice(0, 16)}`;
	if (request.kind === 'type-only') {
		if (request.importedName === undefined) return undefined;
		return {
			typeExpression: binding,
			directory: dirname(request.containingFile),
			declaration: `import type { ${safeTsName(request.importedName)} as ${binding} } from ${moduleText};`,
		};
	}
	const declaration = request.kind === 'named'
		? `import { ${safeTsName(request.importedName ?? '')} as ${binding} } from ${moduleText};`
		: request.kind === 'default' ? `import ${binding} from ${moduleText};`
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

function typescriptCallbackParameterName(primitive: NativeCallablePrimitiveKind): string | undefined {
	if (primitive === 'Int') return undefined;
	return typescriptCallableResultName(primitive);
}

function typescriptCallableResultName(primitive: NativeCallablePrimitiveKind): string | undefined {
	return primitive === 'Bool' ? 'boolean'
		: primitive === 'String' ? 'string'
			: primitive === 'BigInt' ? 'bigint'
				: primitive === 'Unit' ? 'undefined'
					: primitive === 'Int' || primitive === 'Float' ? 'number'
						: undefined;
}

function contextualCallableSignature(type: ts.Type, checker: ts.TypeChecker): ts.Signature | undefined {
	let callableType = type;
	if (type.isUnion()) {
		const candidates = type.types.filter(item => (item.getFlags() & ts.TypeFlags.Undefined) === 0);
		if (candidates.length !== type.types.length) {
			if (candidates.length !== 1) return undefined;
			callableType = candidates[0]!;
		}
	}
	const flags = callableType.getFlags();
	if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0) return undefined;
	if (callableType.getConstructSignatures().length !== 0) return undefined;
	const signatures = callableType.getCallSignatures();
	if (signatures.length !== 1) return undefined;
	const requiredProperties = checker.getPropertiesOfType(callableType).filter(property => (property.flags & ts.SymbolFlags.Optional) === 0);
	if (requiredProperties.length !== 0) return undefined;
	const signature = signatures[0]!;
	if (signature.thisParameter !== undefined || (signature.getTypeParameters()?.length ?? 0) !== 0) return undefined;
	const parameters = signature.getParameters();
	const declaration = signature.declaration;
	if (declaration === undefined || declaration.parameters.length !== parameters.length) return undefined;
	return signature;
}

function contextualPrimitiveKind(type: ts.Type): ContextualCallablePrimitiveKind | undefined {
	const flags = type.getFlags();
	if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter | ts.TypeFlags.Union | ts.TypeFlags.Intersection)) !== 0) return undefined;
	if ((flags & ts.TypeFlags.BooleanLike) !== 0) return 'boolean';
	if ((flags & ts.TypeFlags.StringLike) !== 0) return 'string';
	if ((flags & ts.TypeFlags.NumberLike) !== 0) return 'number';
	if ((flags & ts.TypeFlags.BigIntLike) !== 0) return 'bigint';
	if ((flags & ts.TypeFlags.Undefined) !== 0) return 'undefined';
	return undefined;
}

function contextualCallbackResult(type: ts.Type, checker: ts.TypeChecker): ContextualCallableResult | undefined {
	const flags = type.getFlags();
	if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter)) !== 0) return undefined;
	if ((flags & ts.TypeFlags.Void) !== 0) return Object.freeze({ kind: 'void' });
	const awaited = checker.getAwaitedType(type);
	if (awaited !== undefined && awaited !== type) {
		if ((awaited.getFlags() & ts.TypeFlags.Void) !== 0) return Object.freeze({ kind: 'promise', value: 'void' });
		const value = contextualPrimitiveKind(awaited);
		return value === undefined ? undefined : Object.freeze({ kind: 'promise', value });
	}
	const value = contextualPrimitiveKind(type);
	return value === undefined ? undefined : Object.freeze({ kind: 'value', value });
}

function contextualCallbackResultForNativeCallable(type: ts.Type, checker: ts.TypeChecker, callable: NativeCallableTypeTemplate): ContextualCallableResult | undefined {
	if (!type.isUnion() || callable.async || callable.result !== 'Unit') return contextualCallbackResult(type, checker);
	for (const branch of type.types) {
		const result = contextualCallbackResult(branch, checker);
		if (result?.kind === 'void' || result?.kind === 'value' && result.value === 'undefined') return result;
	}
	return contextualCallbackResult(type, checker);
}

function renderContextualTypeExpression(type: ts.Type, checker: ts.TypeChecker, location: ts.Node): string | undefined {
	try {
		const node = checker.typeToTypeNode(type, location, ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.UseFullyQualifiedType);
		if (node === undefined) return undefined;
		const text = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, node, location.getSourceFile()).trim();
		return text.length === 0 ? undefined : text;
	} catch {
		return undefined;
	}
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

function normalizedCustomConditions(configured: readonly string[] | undefined): string[] {
	return [...new Set(configured ?? [])].sort();
}

function witnessConditionsForPlatform(platform: JsImportRequest['platform']): string[] {
	return platform === 'node'
		? ['types', ...nodeDefaultImportConditions]
		: platform === 'browser'
			? ['types', 'import', 'browser']
			: ['types', 'import'];
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
const nodeDefaultImportConditions = ['node-addons', 'node', 'import', 'module-sync'] as const;

function isNodeBuiltinSpecifier(specifier: string): boolean {
	if (specifier.startsWith('node:')) {
		const bare = specifier.slice('node:'.length);
		return bare.length > 0 && (nodeBuiltinSpecifiers.has(specifier) || nodeBuiltinSpecifiers.has(bare));
	}
	return nodeBuiltinSpecifiers.has(specifier);
}

function resolveRuntimeModule(request: JsImportRequest, nodeImportConditions: ReadonlySet<string>): { readonly entry?: string; readonly path?: string; readonly format?: ModuleResolutionWitness['runtimeFormat'] } {
	const specifier = request.moduleSpecifier;
	if (isNodeBuiltinSpecifier(specifier)) {
		const builtinName = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
		return { entry: `node:${builtinName}`, format: 'builtin' };
	}
	if (specifier.startsWith('node:')) return { format: 'unknown' };
	if (request.platform === 'browser') return { format: 'bundler' };
	if (request.platform !== 'node') return { format: 'unknown' };

	const runtimePath = resolveNodeRuntimePath(specifier, request.containingFile, nodeImportConditions);
	if (runtimePath === undefined) return { format: 'unknown' };
	return runtimeModuleFromPath(runtimePath);
}

function resolveNodeRuntimePath(specifier: string, containingFile: string, nodeImportConditions: ReadonlySet<string>): string | undefined {
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
		const target = resolvePackageExports(packageJson.exports, parsed.subpath, packageRoot, nodeImportConditions);
		return typeof target === 'string' ? existingRuntimeFile(target) : undefined;
	}
	return resolveLegacyPackageRuntimePath(packageRoot, packageJson, parsed.subpath);
}

function resolveLegacyPackageRuntimePath(packageRoot: string, packageJson: RuntimePackageJson, subpath: string): string | undefined {
	if (subpath !== '.') {
		const target = resolveLegacyPackageTargetPath(packageRoot, subpath);
		return target === undefined ? undefined : existingRuntimeFile(target);
	}

	if (packageJson.main !== undefined && packageJson.main.length > 0) {
		const main = resolveLegacyPackageTargetPath(packageRoot, packageJson.main);
		if (main === undefined) return undefined;
		for (const candidate of [
			main,
			`${main}.js`,
			`${main}.json`,
			`${main}.node`,
			join(main, 'index.js'),
			join(main, 'index.json'),
			join(main, 'index.node'),
		]) {
			const locator = relative(resolve(packageRoot), resolve(candidate)).replaceAll('\\', '/');
			if (locator === '..' || locator.startsWith('../') || locator.startsWith('/') || /^[A-Za-z]:\//u.test(locator)) continue;
			const resolved = existingRuntimeFile(candidate);
			if (resolved !== undefined) return resolved;
		}
	}

	for (const candidate of ['index.js', 'index.json', 'index.node']) {
		const resolved = existingRuntimeFile(join(packageRoot, candidate));
		if (resolved !== undefined) return resolved;
	}
	return undefined;
}

function resolveLegacyPackageTargetPath(packageRoot: string, target: string): string | undefined {
	if (target.length === 0) return undefined;
	try {
		const packagePath = resolve(packageRoot);
		const packageUrl = pathToFileURL(`${packagePath}/`);
		const url = new URL(target, packageUrl);
		if (url.protocol !== 'file:' || url.search.length > 0 || url.hash.length > 0) return undefined;
		const candidate = fileURLToPath(url);
		const locator = relative(packagePath, candidate).replaceAll('\\', '/');
		if (locator === '..' || locator.startsWith('../') || locator.startsWith('/') || /^[A-Za-z]:\//u.test(locator)) return undefined;
		return candidate;
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
	const pathSegments = resolve(path).split(/[\\/]/u);
	const underNodeModules = pathSegments.includes('node_modules');
	if (extension === '.mjs') return { entry: path, path, format: 'esm' };
	if (extension === '.cjs') return { entry: path, path, format: 'commonjs' };
	if (extension === '.mts') return { entry: path, path, format: underNodeModules ? 'unknown' : 'esm' };
	if (extension === '.cts') return { entry: path, path, format: underNodeModules ? 'unknown' : 'commonjs' };
	if (extension === '.json' || extension === '.wasm') return { entry: path, path, format: 'unknown' };
	if (extension !== '.js' && extension !== '.ts' && extension.length !== 0) return { entry: path, path, format: 'unknown' };
	if (extension === '.ts' && underNodeModules) return { entry: path, path, format: 'unknown' };
	const packageScope = findRuntimePackageScope(path);
	if (packageScope.kind === 'invalid') return { entry: path, path, format: 'unknown' };
	if (packageScope.kind === 'valid') {
		if (packageScope.type === 'module') return { entry: path, path, format: 'esm' };
		if (packageScope.type === 'commonjs') return { entry: path, path, format: 'commonjs' };
	}
	return { entry: path, path, format: canParseAsCommonJs(path) ? 'commonjs' : 'unknown' };
}

function findRuntimePackageScope(path: string): { readonly kind: 'none' } | { readonly kind: 'invalid' } | { readonly kind: 'valid'; readonly type?: string } {
	let current = dirname(resolve(path));
	while (true) {
		if (current.split(/[\\/]/u).at(-1) === 'node_modules') return { kind: 'none' };
		const packageJsonPath = join(current, 'package.json');
		if (existsSync(packageJsonPath)) {
			const packageJson = readRuntimePackageJson(packageJsonPath);
			if (packageJson === undefined) return { kind: 'invalid' };
			return { kind: 'valid', ...(packageJson.type === undefined ? {} : { type: packageJson.type }) };
		}
		const parent = dirname(current);
		if (parent === current) return { kind: 'none' };
		current = parent;
	}
}

function canParseAsCommonJs(path: string): boolean {
	try {
		const source = readFileSync(path, 'utf8').replace(/^\uFEFF?#![^\r\n]*(?:\r?\n|$)/u, '');
		new Script(`(function (exports, require, module, __filename, __dirname) {\n${source}\n});`, { filename: path });
		return true;
	} catch {
		return false;
	}
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

function resolvePackageExports(exportsValue: unknown, subpath: string, packageRoot: string, nodeImportConditions: ReadonlySet<string>): PackageTargetResolution {
	if (subpath.endsWith('/')) return undefined;
	if (isRecord(exportsValue)) {
		const keys = Object.keys(exportsValue);
		const dotKeys = keys.filter(key => key.startsWith('.'));
		if (dotKeys.length > 0 && dotKeys.length !== keys.length) return invalidPackageTarget;
		if (dotKeys.length === keys.length && keys.length > 0) {
			if (Object.hasOwn(exportsValue, subpath) && !subpath.includes('*')) {
				return resolvePackageTarget(exportsValue[subpath], packageRoot, undefined, nodeImportConditions);
			}
			const patterns = keys.filter(key => key.includes('*') && key.split('*').length === 2).sort(comparePackagePatternKeys);
			for (const pattern of patterns) {
				const match = packagePatternMatch(pattern, subpath);
				if (match === undefined) continue;
				return resolvePackageTarget(exportsValue[pattern], packageRoot, match, nodeImportConditions);
			}
			return undefined;
		}
	}
	if (subpath !== '.') return undefined;
	return resolvePackageTarget(exportsValue, packageRoot, undefined, nodeImportConditions);
}

function resolvePackageTarget(target: unknown, packageRoot: string, patternMatch: string | undefined, nodeImportConditions: ReadonlySet<string>): PackageTargetResolution {
	if (target === null) return null;
	if (typeof target === 'string') return resolvePackageTargetString(target, packageRoot, patternMatch);
	if (Array.isArray(target)) {
		let invalidFallback = false;
		for (const item of target) {
			const resolved = resolvePackageTarget(item, packageRoot, patternMatch, nodeImportConditions);
			if (resolved === invalidPackageTarget) {
				invalidFallback = true;
				continue;
			}
			if (resolved !== undefined) return resolved;
		}
		return invalidFallback ? invalidPackageTarget : null;
	}
	if (!isRecord(target)) return invalidPackageTarget;
	for (const key of Object.keys(target)) {
		if (/^(0|[1-9]\d*)$/u.test(key)) return invalidPackageTarget;
	}
	for (const [condition, value] of Object.entries(target)) {
		if (condition !== 'default' && !nodeImportConditions.has(condition)) continue;
		const resolved = resolvePackageTarget(value, packageRoot, patternMatch, nodeImportConditions);
		if (resolved !== undefined) return resolved;
	}
	return undefined;
}

function resolvePackageTargetString(target: string, packageRoot: string, patternMatch: string | undefined): PackageTargetResolution {
	if (!target.startsWith('./')) return invalidPackageTarget;
	if (target.includes('?') || target.includes('#')) return null;
	if (patternMatch === undefined && target.includes('*')) return null;
	if (patternMatch !== undefined && !validPackagePathSegments(patternMatch, false)) return invalidPackageTarget;
	const expanded = patternMatch === undefined ? target : target.replaceAll('*', patternMatch);
	if (!validPackagePathSegments(expanded, true)) return invalidPackageTarget;
	try {
		const packageUrl = pathToFileURL(`${resolve(packageRoot)}/`);
		const targetUrl = new URL(expanded, packageUrl);
		if (targetUrl.protocol !== 'file:') return invalidPackageTarget;
		if (targetUrl.search.length > 0 || targetUrl.hash.length > 0) return null;
		const candidate = fileURLToPath(targetUrl);
		const locator = relative(resolve(packageRoot), candidate).replaceAll('\\', '/');
		if (locator.length === 0 || locator === '..' || locator.startsWith('../') || locator.startsWith('/')) return invalidPackageTarget;
		return candidate;
	} catch {
		return invalidPackageTarget;
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
