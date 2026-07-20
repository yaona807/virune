import type * as A from '../ast/nodes.js';
import { analyzeControlFlow } from '../analysis/control-flow.js';
import { DiagnosticBag } from '../diagnostics/diagnostic.js';
import { Scope, SymbolFactory, type SymbolInfo } from '../binder/symbols.js';
import type { ForeignTypeSnapshot, InteropArgumentType, InteropSemanticModel, JsImportKind, JsInteropProvider, PrimitiveBridgeKind } from '../interop/types.js';
import type { SourceSpan, SymbolId, TypeId } from '../source.js';
import { TypeArena, type Type } from '../types/types.js';
import { builtinMember } from './builtin-members.js';
import { EffectRegistry } from './effect-registry.js';
import { TypeOperations } from './type-operations.js';

interface FunctionContext {
	readonly declaration: A.FunctionDeclaration | A.TestDeclaration | A.LambdaExpression;
	readonly scope: Scope;
	readonly async: boolean;
	returnType?: TypeId;
	readonly returnTypes: TypeId[];
	readonly typeParameters: ReadonlyMap<string, TypeId>;
	readonly effects: ReadonlySet<string>;
}

export interface SemanticModel {
	readonly arena: TypeArena;
	readonly diagnostics: DiagnosticBag;
	readonly globalScope: Scope;
	readonly symbols: ReadonlyMap<SymbolId, SymbolInfo>;
	readonly namedTypes: ReadonlyMap<string, TypeId>;
	readonly interop: InteropSemanticModel;
}

export interface TypeCheckerOptions {
	readonly signatureOnlyNodeIds?: ReadonlySet<number>;
	readonly typeOnlyNodeIds?: ReadonlySet<number>;
	readonly platform?: 'node' | 'browser' | 'neutral';
	readonly moduleId?: string;
	readonly containingFile?: string;
	readonly jsInteropProvider?: JsInteropProvider;
}

export class TypeChecker {
	readonly arena = new TypeArena();
	readonly diagnostics = new DiagnosticBag();
	readonly globalScope = new Scope();
	readonly #factory = new SymbolFactory();
	readonly #symbols = new Map<SymbolId, SymbolInfo>();
	readonly #namedTypes = new Map<string, TypeId>();
	readonly #recordDeclarations = new Map<string, A.RecordDeclaration>();
	readonly #enumDeclarations = new Map<string, A.EnumDeclaration>();
	readonly #typeAliasDeclarations = new Map<string, A.TypeAliasDeclaration>();
	readonly #newtypeDeclarations = new Map<string, A.NewtypeDeclaration>();
	readonly #effects = new EffectRegistry();
	readonly #variants = new Map<string, { readonly enumType: TypeId; readonly valueTypes: readonly TypeId[]; readonly symbol: SymbolInfo }>();
	#currentFunction: FunctionContext | undefined;
	#loopDepth = 0;
	readonly #signatureOnlyNodeIds: ReadonlySet<number>;
	readonly #typeOnlyNodeIds: ReadonlySet<number>;
	readonly #platform: 'node' | 'browser' | 'neutral';
	readonly #moduleId: string;
	readonly #types: TypeOperations;
	readonly #jsInteropProvider: JsInteropProvider | undefined;
	readonly #containingFile: string;
	readonly #interopUsages: import('../interop/types.js').ForeignUsage[] = [];
	readonly #moduleWitnesses: import('../interop/types.js').ModuleResolutionWitness[] = [];
	#requiresJavaScriptInitialization = false;

	public constructor(options: TypeCheckerOptions = {}) {
		this.#signatureOnlyNodeIds = options.signatureOnlyNodeIds ?? new Set();
		this.#typeOnlyNodeIds = options.typeOnlyNodeIds ?? new Set();
		this.#platform = options.platform ?? 'neutral';
		this.#moduleId = options.moduleId ?? '<module>';
		this.#containingFile = options.containingFile ?? this.#moduleId;
		this.#jsInteropProvider = options.jsInteropProvider;
		this.#types = new TypeOperations({ arena: this.arena, diagnostics: this.diagnostics });
	}

	public check(module: A.ModuleNode): SemanticModel {
		this.registerBuiltins(module.span);
		this.registerForeignImports(module);
		this.registerTypes(module);
		this.finalizeTypes();
		this.registerValues(module);
		for (const declaration of module.declarations) this.checkDeclaration(declaration);
		return { arena: this.arena, diagnostics: this.diagnostics, globalScope: this.globalScope, symbols: this.#symbols, namedTypes: this.#namedTypes, interop: { usages: this.#interopUsages, usageIR: this.#interopUsages.map(stableForeignUsage), moduleWitnesses: this.#moduleWitnesses, requiresJavaScriptInitialization: this.#requiresJavaScriptInitialization } };
	}

	private registerForeignImports(module: A.ModuleNode): void {
		for (const declaration of module.imports) {
			if (declaration.sourceKind !== 'javascript') continue;
			if (declaration.public) this.diagnostics.error('L4207', 'JavaScript imports cannot be publicly re-exported; wrap the value in a Virune newtype or adapter', declaration.span);
			if (/^\.{1,2}\//u.test(declaration.source) && declaration.source.endsWith('.ts') && !declaration.source.endsWith('.interop.ts')) this.diagnostics.error('L4210', 'Direct TypeScript imports are not executed at runtime; rename the file to *.interop.ts so Virune can type-check and emit it', declaration.span);
			if (declaration.typeOnly && (declaration.defaultImport !== undefined || declaration.namespaceImport !== undefined)) {
				this.diagnostics.error('L4208', 'Type-only JavaScript imports support named imports only in v1', declaration.span);
				continue;
			}
			this.#requiresJavaScriptInitialization = this.#requiresJavaScriptInitialization || !declaration.typeOnly;
			const bindings: { readonly local?: string; readonly imported?: string; readonly kind: JsImportKind; readonly span: SourceSpan }[] = [];
			if (declaration.defaultImport !== undefined) bindings.push({ local: declaration.defaultImport, imported: 'default', kind: declaration.typeOnly ? 'type-only' : 'default', span: declaration.span });
			else if (declaration.namespaceImport !== undefined) bindings.push({ local: declaration.namespaceImport, imported: '*', kind: declaration.typeOnly ? 'type-only' : 'namespace', span: declaration.span });
			else if (declaration.items.length > 0) for (const item of declaration.items) bindings.push({ local: item.local, imported: item.imported, kind: declaration.typeOnly ? 'type-only' : 'named', span: item.span });
			else bindings.push({ kind: 'side-effect', span: declaration.span });
			if (this.#jsInteropProvider === undefined) {
				this.diagnostics.error('L4200', `JavaScript import ${declaration.source} requires a JavaScript interop provider`, declaration.span);
				continue;
			}
			for (const binding of bindings) {
				try {
					const resolution = this.#jsInteropProvider.resolveImport({ containingFile: this.#containingFile, moduleSpecifier: declaration.source, kind: binding.kind, ...(binding.imported === undefined ? {} : { importedName: binding.imported }), platform: this.#platform });
					this.#moduleWitnesses.push(resolution.witness);
					if (binding.kind === 'named' && resolution.witness.runtimeFormat === 'commonjs') {
						this.diagnostics.error('L4211', `Named imports from CommonJS module ${declaration.source} are not portable; use a default or namespace import, or a TypeScript interop adapter`, binding.span);
						continue;
					}
					if (resolution.type?.category === 'any') {
						this.diagnostics.error('L4212', `JavaScript import ${binding.imported ?? declaration.source} resolves to TypeScript any; expose unknown through an interop adapter or use unsafe extern js`, binding.span);
						continue;
					}
					if (binding.local === undefined || resolution.type === undefined) continue;
					const typeId = this.arena.foreign(resolution.type);
					const symbol = this.#factory.create(binding.local, 'import', typeId, binding.span, { public: declaration.public, typeOnly: declaration.typeOnly });
					if (!this.globalScope.define(symbol)) this.diagnostics.error('L1001', `Duplicate definition ${binding.local}`, binding.span);
					else this.#symbols.set(symbol.id, symbol);
					this.#interopUsages.push({ kind: 'import', nodeId: declaration.id, span: declaration.span, foreignType: resolution.type, runtimeImport: resolution.runtime, moduleWitness: resolution.witness });
				} catch (error) {
					this.diagnostics.error('L4201', `Cannot resolve JavaScript import ${declaration.source}: ${error instanceof Error ? error.message : String(error)}`, declaration.span);
				}
			}
		}
	}

	private registerBuiltins(span: SourceSpan): void {
		for (const effect of ['Console', 'Task', 'File', 'Process', 'Network', 'Timer', 'Clock', 'Storage', 'Dom', 'Random', 'JavaScript']) this.#effects.registerBuiltin(effect);
		for (const [name, type] of [
			['Bool', this.arena.bool], ['Int', this.arena.int], ['Float', this.arena.float], ['BigInt', this.arena.bigint], ['String', this.arena.string],
			['Unit', this.arena.unit], ['Unknown', this.arena.unknown], ['Never', this.arena.never],
		] as const) this.#namedTypes.set(name, type);
		const jsError = this.arena.add({ kind: 'named', name: 'JsError', definitionId: 'std:JsError', declarationKind: 'record', arguments: [], fields: new Map([['name', this.arena.string], ['message', this.arena.string]]) });
		this.#namedTypes.set('JsError', jsError);
		const jsonError = this.arena.add({ kind: 'named', name: 'JsonError', definitionId: 'std:JsonError', declarationKind: 'record', arguments: [], fields: new Map([['path', this.arena.string], ['expected', this.arena.string], ['actual', this.arena.string], ['message', this.arena.string]]) });
		this.#namedTypes.set('JsonError', jsonError);
		const duration = this.arena.add({ kind: 'named', name: 'Duration', definitionId: 'std:Duration', declarationKind: 'newtype', arguments: [], underlying: this.arena.int });
		this.#namedTypes.set('Duration', duration);
		const taskTimeoutError = this.arena.add({ kind: 'named', name: 'TaskTimeoutError', definitionId: 'std:TaskTimeoutError', declarationKind: 'record', arguments: [], fields: new Map([['milliseconds', this.arena.int]]) });
		this.#namedTypes.set('TaskTimeoutError', taskTimeoutError);
		const supervisorRestartLimitError = this.arena.add({ kind: 'named', name: 'SupervisorRestartLimitError', definitionId: 'std:SupervisorRestartLimitError', declarationKind: 'record', arguments: [], fields: new Map([['restarts', this.arena.int]]) });
		this.#namedTypes.set('SupervisorRestartLimitError', supervisorRestartLimitError);
		const bytes = this.arena.add({ kind: 'named', name: 'Bytes', definitionId: 'std:Bytes', declarationKind: 'newtype', arguments: [], underlying: this.arena.unknown, derives: new Set(['Eq', 'Hash', 'Debug']) });
		const mutableBytes = this.arena.add({ kind: 'named', name: 'MutableBytes', definitionId: 'std:MutableBytes', declarationKind: 'newtype', arguments: [], underlying: this.arena.unknown, mustUse: true });
		this.#namedTypes.set('Bytes', bytes); this.#namedTypes.set('MutableBytes', mutableBytes);
		const byteOrder = this.arena.add({ kind: 'named', name: 'ByteOrder', definitionId: 'std:ByteOrder', declarationKind: 'enum', arguments: [], variants: new Map([['BigEndian', []], ['LittleEndian', []]]), derives: new Set(['Eq', 'Hash', 'Debug']) });
		this.#namedTypes.set('ByteOrder', byteOrder);
		const bytesError = this.arena.add({ kind: 'named', name: 'BytesError', definitionId: 'std:BytesError', declarationKind: 'record', arguments: [], fields: new Map([['message', this.arena.string]]), derives: new Set(['Eq', 'Hash', 'Debug']) });
		this.#namedTypes.set('BytesError', bytesError);
		const integerRangeError = this.arena.add({ kind: 'named', name: 'IntegerRangeError', definitionId: 'std:IntegerRangeError', declarationKind: 'record', arguments: [], fields: new Map([['type', this.arena.string], ['value', this.arena.string]]), derives: new Set(['Eq', 'Hash', 'Debug']) });
		this.#namedTypes.set('IntegerRangeError', integerRangeError);
		for (const [name, underlying] of [['Byte', this.arena.int], ['Int8', this.arena.int], ['UInt8', this.arena.int], ['Int16', this.arena.int], ['UInt16', this.arena.int], ['Int32', this.arena.int], ['UInt32', this.arena.int], ['Int64', this.arena.bigint], ['UInt64', this.arena.bigint]] as const) {
			this.#namedTypes.set(name, this.arena.add({ kind: 'named', name, definitionId: `std:${name}`, declarationKind: 'newtype', arguments: [], underlying, derives: new Set(['Eq', 'Hash', 'Debug']) }));
		}
		const httpBody = this.arena.add({ kind: 'named', name: 'HttpBody', definitionId: 'std:HttpBody', declarationKind: 'enum', arguments: [], variants: new Map([['Empty', []], ['Text', [this.arena.string]], ['Bytes', [bytes]]]), derives: new Set(['Eq', 'Hash', 'Debug']) });
		this.#namedTypes.set('HttpBody', httpBody);
		const httpResponse = this.arena.add({ kind: 'named', name: 'HttpResponse', definitionId: 'std:HttpResponse', declarationKind: 'record', arguments: [], fields: new Map([
			['status', this.arena.int], ['ok', this.arena.bool], ['headers', this.arena.map(this.arena.string, this.arena.string)], ['body', httpBody],
		]) });
		this.#namedTypes.set('HttpResponse', httpResponse);
		const fileHandle = this.arena.add({ kind: 'named', name: 'FileHandle', definitionId: 'std:FileHandle', declarationKind: 'newtype', arguments: [], underlying: this.arena.unknown, mustUse: true });
		this.#namedTypes.set('FileHandle', fileHandle);
		const t = this.arena.variable('T');
		const e = this.arena.variable('E');
		this.defineBuiltin('Unit', this.arena.unit, span);
		this.defineBuiltin('expect', this.arena.function([this.arena.bool], this.arena.unit), span);
		this.defineBuiltin('panic', this.arena.function([this.arena.string], this.arena.never), span);
		this.defineBuiltin('Some', this.arena.function([t], this.arena.option(t), ['T']), span);
		this.defineBuiltin('Ok', this.arena.function([t], this.arena.result(t, e), ['T', 'E']), span);
		this.defineBuiltin('Err', this.arena.function([e], this.arena.result(t, e), ['T', 'E']), span);
		this.defineBuiltin('None', this.arena.option(t), span);
		for (const namespace of ['List', 'Map', 'Set', 'Int', 'Float', 'String', 'Json', 'Console', 'Debug', 'Option', 'Result', 'Validation', 'Task', 'Duration', 'Queue', 'Stack', 'Stream', 'File', 'Path', 'Process', 'Http', 'HttpBody', 'Fetch', 'Timer', 'Storage', 'Dom', 'Crypto', 'Url', 'Bytes', 'MutableBytes', 'ByteOrder', 'Byte', 'Int8', 'UInt8', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Int64', 'UInt64']) this.defineBuiltin(namespace, this.arena.unknown, span);
	}

	private defineBuiltin(name: string, typeId: TypeId, span: SourceSpan): void {
		const symbol = this.#factory.create(name, 'builtin', typeId, span);
		this.globalScope.defineAllowParent(symbol); this.#symbols.set(symbol.id, symbol);
	}

	private registerTypes(module: A.ModuleNode): void {
		for (const declaration of module.declarations) {
			let declarationKind: 'record' | 'enum' | 'newtype' | 'alias' | undefined;
			if (declaration.kind === 'RecordDeclaration') declarationKind = 'record';
			else if (declaration.kind === 'EnumDeclaration') declarationKind = 'enum';
			else if (declaration.kind === 'NewtypeDeclaration') declarationKind = 'newtype';
			else if (declaration.kind === 'TypeAliasDeclaration') declarationKind = 'alias';
			if (declarationKind === undefined) continue;
			const typeDeclaration = declaration as A.RecordDeclaration | A.EnumDeclaration | A.NewtypeDeclaration | A.TypeAliasDeclaration;
			if (this.#namedTypes.has(typeDeclaration.name)) {
				this.diagnostics.error('L1001', `Duplicate type name ${typeDeclaration.name}`, typeDeclaration.span); continue;
			}
			const typeId = this.arena.add({ kind: 'named', name: typeDeclaration.name, definitionId: typeDeclaration.definitionId ?? `${this.#moduleId}#${typeDeclaration.name}`, declarationKind, arguments: [] });
			this.#namedTypes.set(typeDeclaration.name, typeId);
			const symbol = this.#factory.create(typeDeclaration.name, 'type', typeId, typeDeclaration.span, { declaration: typeDeclaration, public: typeDeclaration.public, typeOnly: this.#typeOnlyNodeIds.has(typeDeclaration.id) });
			typeDeclaration.symbolId = symbol.id; this.#symbols.set(symbol.id, symbol);
			if (!this.globalScope.define(symbol)) this.diagnostics.error('L1002', `Name ${typeDeclaration.name} is already defined`, typeDeclaration.span);
			if (declaration.kind === 'RecordDeclaration') this.#recordDeclarations.set(declaration.name, declaration);
			if (declaration.kind === 'EnumDeclaration') this.#enumDeclarations.set(declaration.name, declaration);
			if (declaration.kind === 'TypeAliasDeclaration') this.#typeAliasDeclarations.set(declaration.name, declaration);
			if (declaration.kind === 'NewtypeDeclaration') this.#newtypeDeclarations.set(declaration.name, declaration);
		}
	}

	private finalizeTypes(): void {
		for (const [name, declaration] of this.#recordDeclarations) {
			const typeParameters = new Map(declaration.typeParameters.map(item => [item.name, this.arena.variable(item.name)]));
			const fields = new Map<string, TypeId>();
			for (const field of declaration.fields) {
				if (fields.has(field.name)) this.diagnostics.error('L1003', `Duplicate field ${field.name}`, field.span);
				const fieldType = this.resolveTypeReference(field.type, typeParameters);
				if (this.containsOpenEffect(fieldType)) this.diagnostics.error('L2113', 'uses * callbacks are non-escaping and cannot be stored in record fields', field.span);
				fields.set(field.name, fieldType);
			}
			this.arena.setNamedDetails(this.#namedTypes.get(name)!, { fields, derives: new Set(declaration.derives), mustUse: declaration.attributes.some(attribute => attribute.name === 'mustUse') });
		}
		for (const [name, declaration] of this.#newtypeDeclarations) {
			const underlying = this.resolveTypeReference(declaration.underlying, new Map());
			if (this.containsOpenEffect(underlying)) this.diagnostics.error('L2113', 'uses * callbacks are non-escaping and cannot be stored in newtypes', declaration.span);
			this.arena.setNamedDetails(this.#namedTypes.get(name)!, { underlying, mustUse: declaration.attributes.some(attribute => attribute.name === 'mustUse') });
		}
		for (const [name, declaration] of this.#typeAliasDeclarations) {
			const underlying = this.resolveTypeReference(declaration.target, new Map());
			if (this.containsOpenEffect(underlying)) this.diagnostics.error('L2113', 'uses * callbacks are non-escaping and cannot be stored in type aliases', declaration.span);
			this.arena.setNamedDetails(this.#namedTypes.get(name)!, { underlying });
		}
		for (const [name, declaration] of this.#enumDeclarations) {
			const typeParameters = new Map(declaration.typeParameters.map(item => [item.name, this.arena.variable(item.name)]));
			const variants = new Map<string, readonly TypeId[]>();
			for (const variant of declaration.variants) {
				if (variants.has(variant.name) || this.globalScope.lookupCurrent(variant.name) !== undefined) this.diagnostics.error('L1004', `Duplicate enum variant ${variant.name}`, variant.span);
				const values = variant.values.map(type => this.resolveTypeReference(type, typeParameters));
				if (values.some(value => this.containsOpenEffect(value))) this.diagnostics.error('L2113', 'uses * callbacks are non-escaping and cannot be stored in enum payloads', variant.span);
				variants.set(variant.name, values);
			}
			this.arena.setNamedDetails(this.#namedTypes.get(name)!, { variants, derives: new Set(declaration.derives), mustUse: declaration.attributes.some(attribute => attribute.name === 'mustUse') });
		}
	}

	private registerValues(module: A.ModuleNode): void {
		for (const declaration of module.declarations) {
			if (declaration.kind === 'FunctionDeclaration') {
				const typeParameters = new Map(declaration.typeParameters.map(item => [item.name, this.arena.variable(item.name)]));
				const parameters = declaration.parameters.map(item => this.resolveTypeReference(item.type, typeParameters));
				const result = declaration.returnType === undefined ? this.arena.error : this.resolveTypeReference(declaration.returnType, typeParameters);
				const typeId = this.arena.function(parameters, result, declaration.typeParameters.map(item => item.name), declaration.async, declaration.effects);
				const symbol = this.defineValue(declaration.name, 'function', typeId, declaration.span, declaration.public, declaration);
				if (symbol !== undefined) declaration.symbolId = symbol.id;
			} else if (declaration.kind === 'TopLevelLetDeclaration') {
				const typeId = declaration.annotation === undefined ? this.arena.error : this.resolveTypeReference(declaration.annotation, new Map());
				const symbol = this.defineValue(declaration.name, 'variable', typeId, declaration.span, declaration.public, declaration, declaration.constant);
				if (symbol !== undefined) declaration.symbolId = symbol.id;
			} else if (declaration.kind === 'ExternDeclaration') {
				for (const fn of declaration.functions) {
					const parameters = fn.parameters.map(item => this.resolveTypeReference(item.type, new Map()));
					const result = this.resolveTypeReference(fn.returnType, new Map());
					const symbol = this.defineValue(fn.name, 'extern', this.arena.function(parameters, result, [], fn.async, fn.effects), fn.span, false, fn);
					if (symbol !== undefined) fn.symbolId = symbol.id;
				}
			}
		}
		for (const [enumName, declaration] of this.#enumDeclarations) {
			const enumType = this.#namedTypes.get(enumName)!;
			const type = this.arena.get(enumType);
			if (type.kind !== 'named' || type.variants === undefined) continue;
			const genericArguments = declaration.typeParameters.map(parameter => this.arena.variable(parameter.name));
			const constructedEnumType = genericArguments.length === 0 ? enumType : this.arena.namedInstance(type, genericArguments);
			for (const variant of declaration.variants) {
				const valueTypes = type.variants.get(variant.name) ?? [];
				const typeId = valueTypes.length === 0 ? constructedEnumType : this.arena.function(valueTypes, constructedEnumType, declaration.typeParameters.map(item => item.name));
				const symbol = this.defineValue(variant.name, 'variant', typeId, variant.span, declaration.public, declaration);
				if (symbol !== undefined) { variant.symbolId = symbol.id; this.#variants.set(variant.name, { enumType: constructedEnumType, valueTypes, symbol }); }
			}
		}
	}

	private defineValue(name: string, kind: SymbolInfo['kind'], typeId: TypeId, span: SourceSpan, publicValue: boolean, declaration: A.AstNode, constant = false): SymbolInfo | undefined {
		const symbol = this.#factory.create(name, kind, typeId, span, { declaration, public: publicValue, typeOnly: this.#typeOnlyNodeIds.has(declaration.id), constant });
		if (!this.globalScope.define(symbol)) { this.diagnostics.error('L1005', `Name ${name} is already defined`, span); return undefined; }
		this.#symbols.set(symbol.id, symbol); return symbol;
	}

	private checkDeclaration(declaration: A.Declaration): void {
		if (this.#signatureOnlyNodeIds.has(declaration.id)) return;
		this.checkAttributes(declaration);
		switch (declaration.kind) {
			case 'FunctionDeclaration': this.checkFunction(declaration); break;
			case 'TopLevelLetDeclaration': {
				if (declaration.public && !declaration.constant) this.diagnostics.error('L2080', 'Only const declarations can be public', declaration.span);
				if (declaration.public && declaration.annotation === undefined) this.diagnostics.error('L2081', 'Public const declarations require an explicit type', declaration.span);
				const annotated = declaration.annotation === undefined ? undefined : this.resolveTypeReference(declaration.annotation, new Map());
				const valueType = this.checkExpression(declaration.value, this.globalScope, annotated);
				const expected = annotated ?? valueType;
				if (this.containsOpenEffect(expected)) this.diagnostics.error('L2113', 'uses * callbacks are non-escaping and cannot be stored in top-level declarations', declaration.span);
				if (!this.isAssignable(valueType, expected)) this.typeMismatch(valueType, expected, declaration.value.span);
				if (declaration.constant && !this.isConstantExpression(declaration.value)) this.diagnostics.error('L2082', 'const initializer must be evaluable without function calls, mutable state, async work, or external values', declaration.value.span);
				declaration.inferredTypeId = expected; if (declaration.symbolId !== undefined) this.#symbols.get(declaration.symbolId)!.typeId = expected;
				break;
			}
			case 'TestDeclaration': this.checkTest(declaration); break;
			case 'RecordDeclaration': this.checkRecordFieldAttributes(declaration); this.checkDerives(declaration.derives, declaration.span, declaration.name); break;
			case 'EnumDeclaration': this.checkDerives(declaration.derives, declaration.span, declaration.name); break;
			case 'ExternDeclaration': this.checkExtern(declaration); break;
			default: break;
		}
	}

	private checkFunction(declaration: A.FunctionDeclaration): void {
		this.validateEffects(declaration.effects, declaration.span);
		if (declaration.public && declaration.returnType === undefined) this.diagnostics.error('L2001', 'Public functions require an explicit return type', declaration.span);
		if ((declaration.async || declaration.typeParameters.length > 0) && declaration.returnType === undefined) this.diagnostics.error('L2002', 'Async and generic functions require an explicit return type', declaration.span);
		const scope = new Scope(this.globalScope);
		const typeParameters = new Map(declaration.typeParameters.map(item => [item.name, this.arena.variable(item.name)]));
		for (const parameter of declaration.parameters) {
			if (parameter.optional) this.diagnostics.error('L2114', 'Optional parameters are supported only in extern js declarations', parameter.span);
			const typeId = this.resolveTypeReference(parameter.type, typeParameters);
			const parameterType = this.arena.get(typeId);
			if (this.containsOpenEffect(typeId) && !(parameterType.kind === 'function' && parameterType.effects.includes('*'))) this.diagnostics.error('L2113', 'uses * is allowed only on a direct non-escaping callback parameter', parameter.span);
			const symbol = this.#factory.create(parameter.name, 'parameter', typeId, parameter.span, { declaration });
			if (!scope.define(symbol)) this.diagnostics.error('L1006', `Parameter ${parameter.name} shadows an existing name`, parameter.span);
			else { parameter.symbolId = symbol.id; this.#symbols.set(symbol.id, symbol); }
		}
		const resolvedReturnType = declaration.returnType === undefined ? undefined : this.resolveTypeReference(declaration.returnType, typeParameters);
		if (resolvedReturnType !== undefined && this.containsOpenEffect(resolvedReturnType)) this.diagnostics.error('L2113', 'uses * callbacks are non-escaping and cannot be returned', declaration.returnType?.span ?? declaration.span);
		const context: FunctionContext = { declaration, scope, async: declaration.async, returnTypes: [], typeParameters, effects: new Set(declaration.effects), ...(resolvedReturnType === undefined ? {} : { returnType: resolvedReturnType }) };
		if (declaration.public) {
			for (const parameter of declaration.parameters) {
				const symbol = parameter.symbolId === undefined ? undefined : this.#symbols.get(parameter.symbolId);
				if (symbol !== undefined && this.containsForeignType(symbol.typeId)) this.diagnostics.error('L4209', `Public function ${declaration.name} cannot expose JavaScript foreign type ${this.arena.display(symbol.typeId)}; wrap it in a Virune newtype`, parameter.span);
			}
			if (context.returnType !== undefined && this.containsForeignType(context.returnType)) this.diagnostics.error('L4209', `Public function ${declaration.name} cannot return JavaScript foreign type ${this.arena.display(context.returnType)}; wrap it in a Virune newtype`, declaration.span);
		}

		if (declaration.attributes.some(attribute => attribute.name === 'jsExport')) {
			for (const parameter of declaration.parameters) {
				const symbol = parameter.symbolId === undefined ? undefined : this.#symbols.get(parameter.symbolId);
				if (symbol !== undefined && !this.isSafeFfiType(symbol.typeId)) this.diagnostics.error('L4213', `@jsExport parameter ${parameter.name} has type ${this.arena.display(symbol.typeId)}, which cannot be fully validated at the JavaScript boundary; use Unknown and decode explicitly`, parameter.span);
			}
			if (context.returnType !== undefined && !this.isSafeFfiType(context.returnType)) this.diagnostics.error('L4213', `@jsExport return type ${this.arena.display(context.returnType)} cannot be fully validated at the JavaScript boundary; use Unknown and encode explicitly`, declaration.returnType?.span ?? declaration.span);
		}
		const previous = this.#currentFunction; const previousLoopDepth = this.#loopDepth; this.#currentFunction = context; this.#loopDepth = 0;
		if (declaration.expressionBody) context.returnTypes.push(this.checkExpression(declaration.body as A.Expression, scope, context.returnType));
		else this.checkBlock(declaration.body as A.BlockStatement, scope);
		this.#currentFunction = previous; this.#loopDepth = previousLoopDepth;
		const inferred = context.returnType ?? this.commonType(context.returnTypes, declaration.span);
		if (declaration.returnType !== undefined) for (const typeId of context.returnTypes) if (!this.isAssignable(typeId, inferred)) this.typeMismatch(typeId, inferred, declaration.span);
		if (!declaration.expressionBody) {
			const controlFlow = analyzeControlFlow(declaration.body as A.BlockStatement, this.arena);
			if (inferred !== this.arena.unit && !controlFlow.alwaysTerminates) this.diagnostics.error('L3001', `Function ${declaration.name} does not return on every path`, declaration.span);
			for (const span of controlFlow.unreachable) this.diagnostics.error('L3006', 'Unreachable statement', span);
		}
		declaration.inferredTypeId = inferred;
		if (declaration.symbolId !== undefined) {
			const symbol = this.#symbols.get(declaration.symbolId)!;
			const functionType = this.arena.get(symbol.typeId);
			if (functionType.kind === 'function') symbol.typeId = this.arena.function(functionType.parameters, inferred, functionType.typeParameters, functionType.async, functionType.effects);
		}
	}

	private checkTest(declaration: A.TestDeclaration): void {
		const scope = new Scope(this.globalScope);
		const previous = this.#currentFunction; const previousLoopDepth = this.#loopDepth;
		this.#currentFunction = { declaration, scope, async: declaration.async, returnType: this.arena.unit, returnTypes: [], typeParameters: new Map(), effects: new Set(['*']) }; this.#loopDepth = 0;
		this.checkBlock(declaration.body, scope);
		this.#currentFunction = previous; this.#loopDepth = previousLoopDepth;
	}

	private checkExtern(declaration: A.ExternDeclaration): void {
		for (const fn of declaration.functions) {
			this.validateEffects(fn.effects, fn.span);
			let optionalSeen = false;
			for (const parameter of fn.parameters) {
				if (parameter.optional) optionalSeen = true;
				else if (optionalSeen) this.diagnostics.error('L2115', 'Optional extern parameters must be trailing', parameter.span);
				const parameterType = this.resolveTypeReference(parameter.type, new Map());
				if (!declaration.unsafe && !this.isSafeFfiType(parameterType)) this.diagnostics.error('L4213', `Safe extern parameter ${parameter.name} has type ${this.arena.display(parameterType)}, which cannot be fully validated; use Unknown or an adapter`, parameter.span);
			}
			const returnType = this.resolveTypeReference(fn.returnType, new Map());
			if (!declaration.unsafe) {
				const type = this.arena.get(returnType);
				if (type.kind !== 'result' && !(type.kind === 'future' && this.arena.get(type.value).kind === 'result')) this.diagnostics.error('L4001', `Safe extern function ${fn.name} must return Result`, fn.span);
				if (!this.isSafeFfiType(returnType)) this.diagnostics.error('L4213', `Safe extern return type ${this.arena.display(returnType)} cannot be fully validated; use Result<Unknown, E> or an adapter`, fn.returnType.span);
			}
		}
	}

	private checkAttributes(declaration: A.Declaration): void {
		const seen = new Set<string>();
		for (const attribute of declaration.attributes) {
			if (seen.has(attribute.name)) this.diagnostics.error('L2051', `Duplicate attribute @${attribute.name}`, attribute.span);
			seen.add(attribute.name);
			if (attribute.name === 'jsExport') {
				if (declaration.kind !== 'FunctionDeclaration') this.diagnostics.error('L2052', '@jsExport can be used only on functions', attribute.span);
				else {
					if (!declaration.public) this.diagnostics.error('L2053', '@jsExport function must be public', attribute.span);
					if (declaration.typeParameters.length > 0) this.diagnostics.error('L2054', '@jsExport does not support generic functions', attribute.span);
					if (attribute.arguments.length > 0) this.diagnostics.error('L2055', '@jsExport does not accept arguments', attribute.span);
				}
			} else if (attribute.name === 'mustUse') {
				if (!['RecordDeclaration', 'EnumDeclaration', 'NewtypeDeclaration'].includes(declaration.kind)) this.diagnostics.error('L2090', '@mustUse can be used only on record, enum, or newtype declarations', attribute.span);
				if (attribute.arguments.length > 0) this.diagnostics.error('L2091', '@mustUse does not accept arguments', attribute.span);
			} else if (attribute.name === 'json') {
				const strict = attribute.arguments.length === 1 && attribute.arguments[0]?.kind === 'IdentifierExpression' && attribute.arguments[0].name === 'strict';
				if (declaration.kind !== 'RecordDeclaration') this.diagnostics.error('L2056', '@json can be used only on records', attribute.span);
				else {
					if (!strict) this.diagnostics.error('L2057', '@json currently accepts only the strict argument', attribute.span);
					if (!declaration.derives.includes('Json')) this.diagnostics.error('L2058', '@json(strict) requires derives Json', attribute.span);
				}
			} else this.diagnostics.error('L2059', `Unknown attribute @${attribute.name}`, attribute.span);
		}
	}

	private checkRecordFieldAttributes(declaration: A.RecordDeclaration): void {
		const jsonNames = new Set<string>();
		const recordTypeId = this.#namedTypes.get(declaration.name);
		const recordType = recordTypeId === undefined ? undefined : this.arena.get(recordTypeId);
		for (const field of declaration.fields) {
			const seen = new Set<string>();
			for (const attribute of field.attributes) {
				if (seen.has(attribute.name)) this.diagnostics.error('L2078', `Duplicate field attribute @${attribute.name}`, attribute.span);
				seen.add(attribute.name);
				if (attribute.name === 'jsOptional') {
					if (attribute.arguments.length > 0) this.diagnostics.error('L2116', '@jsOptional does not accept arguments', attribute.span);
					const fieldType = recordType?.kind === 'named' ? recordType.fields?.get(field.name) : undefined;
					if (fieldType === undefined || this.arena.get(fieldType).kind !== 'option') this.diagnostics.error('L2116', '@jsOptional can be used only on Option fields', attribute.span);
					continue;
				}
				if (!declaration.derives.includes('Json')) this.diagnostics.error('L2079', `@${attribute.name} requires ${declaration.name} to derive Json`, attribute.span);
				if (attribute.name === 'jsonName') {
					const argument = attribute.arguments[0];
					if (attribute.arguments.length !== 1 || argument?.kind !== 'LiteralExpression' || argument.literalKind !== 'String') {
						this.diagnostics.error('L2080', '@jsonName requires exactly one String literal', attribute.span);
						continue;
					}
					const name = String(argument.value);
					if (jsonNames.has(name)) this.diagnostics.error('L2081', `Duplicate JSON field name ${name}`, attribute.span);
					jsonNames.add(name);
				} else if (attribute.name === 'jsonDefault') {
					const argument = attribute.arguments[0];
					if (attribute.arguments.length !== 1 || argument === undefined || !this.isJsonDefaultExpression(argument)) {
						this.diagnostics.error('L2082', '@jsonDefault requires exactly one compile-time constant expression', attribute.span);
						continue;
					}
					const expected = recordType?.kind === 'named' ? recordType.fields?.get(field.name) : undefined;
					const actual = this.checkExpression(argument, this.globalScope, expected);
					if (expected !== undefined && !this.isAssignable(actual, expected)) this.typeMismatch(actual, expected, argument.span);
				} else this.diagnostics.error('L2083', `Unknown field attribute @${attribute.name}`, attribute.span);
			}
			if (!seen.has('jsonName')) {
				if (jsonNames.has(field.name)) this.diagnostics.error('L2081', `Duplicate JSON field name ${field.name}`, field.span);
				jsonNames.add(field.name);
			}
		}
	}

	private isJsonDefaultExpression(expression: A.Expression): boolean {
		switch (expression.kind) {
			case 'LiteralExpression': return true;
			case 'IdentifierExpression': return expression.name === 'None' || expression.name === 'Unit';
			case 'ListExpression': return expression.items.every(item => this.isJsonDefaultExpression(item));
			case 'TupleExpression': return expression.items.every(item => this.isJsonDefaultExpression(item));
			case 'RecordExpression': return expression.entries.every(item => this.isJsonDefaultExpression(item.value));
			case 'CallExpression': return expression.callee.kind === 'IdentifierExpression' && ['Some', 'Ok', 'Err'].includes(expression.callee.name) && expression.arguments.every(item => this.isJsonDefaultExpression(item));
			default: return false;
		}
	}

	private checkDerives(derives: readonly string[], span: SourceSpan, typeName: string): void {
		const seen = new Set<string>();
		for (const derive of derives) {
			if (seen.has(derive)) this.diagnostics.error('L2060', `Duplicate derive ${derive} on ${typeName}`, span);
			seen.add(derive);
			if (!['Eq', 'Hash', 'Debug', 'Json'].includes(derive)) this.diagnostics.error('L2003', `Unknown derive ${derive} on ${typeName}`, span);
		}
		const typeId = this.#namedTypes.get(typeName);
		const type = typeId === undefined ? undefined : this.arena.get(typeId);
		if (type?.kind !== 'named') return;
		const components = type.fields === undefined ? [...(type.variants?.values() ?? [])].flat() : [...type.fields.values()];
		if (derives.includes('Eq')) for (const component of components) if (!this.supportsDerivedEq(component, typeId!)) { this.diagnostics.error('L2061', `${typeName} cannot derive Eq because ${this.arena.display(component)} does not support derived equality`, span); break; }
		if (derives.includes('Hash')) { if (!derives.includes('Eq')) this.diagnostics.error('L2092', `${typeName} must derive Eq before Hash`, span); for (const component of components) if (!this.supportsHash(component)) { this.diagnostics.error('L2093', `${typeName} cannot derive Hash because ${this.arena.display(component)} is not hashable`, span); break; } }
		if (derives.includes('Json')) for (const component of components) if (!this.supportsJson(component)) { this.diagnostics.error('L2062', `${typeName} cannot derive Json because ${this.arena.display(component)} is not JSON-compatible`, span); break; }
	}

	private checkBlock(block: A.BlockStatement, parent: Scope): void {
		const scope = new Scope(parent);
		for (const statement of block.statements) this.checkStatement(statement, scope);
	}

	private checkStatement(statement: A.Statement, scope: Scope): void {
		switch (statement.kind) {
			case 'LetStatement': {
				const annotated = statement.annotation === undefined ? undefined : this.resolveTypeReference(statement.annotation, new Map());
				const valueType = this.checkExpression(statement.value, scope, annotated);
				const expected = annotated ?? valueType;
				if (!this.isAssignable(valueType, expected)) this.typeMismatch(valueType, expected, statement.value.span);
				const symbol = this.#factory.create(statement.name, 'variable', expected, statement.span, { mutable: statement.mutable, declaration: statement });
				if (!scope.define(symbol)) this.diagnostics.error('L1007', `Local name ${statement.name} shadows an existing name`, statement.span);
				else { statement.symbolId = symbol.id; statement.inferredTypeId = expected; this.#symbols.set(symbol.id, symbol); }
				break;
			}
			case 'ReturnStatement': {
				const typeId = statement.value === undefined ? this.arena.unit : this.checkExpression(statement.value, scope, this.#currentFunction?.returnType);
				this.#currentFunction?.returnTypes.push(typeId);
				if (this.#currentFunction?.returnType !== undefined && !this.isAssignable(typeId, this.#currentFunction.returnType)) this.typeMismatch(typeId, this.#currentFunction.returnType, statement.span);
				break;
			}
			case 'IfStatement':
				this.requireBool(this.checkExpression(statement.condition, scope), statement.condition.span);
				this.checkBlock(statement.thenBlock, scope);
				if (statement.elseBranch?.kind === 'BlockStatement') this.checkBlock(statement.elseBranch, scope);
				else if (statement.elseBranch !== undefined) this.checkStatement(statement.elseBranch, scope);
				break;
			case 'ForStatement': {
				const iterableType = this.arena.get(this.checkExpression(statement.iterable, scope));
				let itemType = this.arena.error;
				if (iterableType.kind === 'list' || iterableType.kind === 'set') itemType = iterableType.element;
				else if (iterableType.kind === 'map') itemType = this.arena.tuple([iterableType.key, iterableType.value]);
				else if (iterableType.kind === 'primitive' && iterableType.name === 'String') itemType = this.arena.string;
				else this.diagnostics.error('L2004', 'for requires an iterable List, Set, Map, or String value', statement.iterable.span);
				const child = new Scope(scope); const symbol = this.#factory.create(statement.name, 'variable', itemType, statement.span, { declaration: statement });
				if (!child.define(symbol)) this.diagnostics.error('L1008', `Loop variable ${statement.name} shadows an existing name`, statement.span); else { statement.symbolId = symbol.id; this.#symbols.set(symbol.id, symbol); }
				this.#loopDepth++; this.checkBlock(statement.body, child); this.#loopDepth--; break;
			}
			case 'WhileStatement': this.requireBool(this.checkExpression(statement.condition, scope), statement.condition.span); this.#loopDepth++; this.checkBlock(statement.body, scope); this.#loopDepth--; break;
			case 'BreakStatement': if (this.#loopDepth === 0) this.diagnostics.error('L2095', 'break can be used only inside a loop', statement.span); break;
			case 'ContinueStatement': if (this.#loopDepth === 0) this.diagnostics.error('L2096', 'continue can be used only inside a loop', statement.span); break;
			case 'DiscardStatement': this.checkExpression(statement.expression, scope); break;
			case 'AssignmentStatement': {
				const target = scope.lookup(statement.name);
				if (target === undefined) this.diagnostics.error('L1009', `Unknown name ${statement.name}`, statement.span);
				else if (!target.mutable) this.diagnostics.error('L2010', `Cannot assign to immutable name ${statement.name}`, statement.span);
				else { statement.targetSymbolId = target.id; const valueType = this.checkExpression(statement.value, scope, target.typeId); if (this.containsOpenEffect(valueType)) this.diagnostics.error('L2113', 'uses * callbacks are non-escaping and cannot be assigned', statement.span); if (!this.isAssignable(valueType, target.typeId)) this.typeMismatch(valueType, target.typeId, statement.value.span); }
				break;
			}
			case 'DeferStatement': {
					if (this.#currentFunction === undefined) this.diagnostics.error('L2070', 'defer can be used only inside a function or test', statement.span);
					const deferredType = this.checkExpression(statement.expression, scope);
					if (!this.arena.equals(deferredType, this.arena.unit) && !this.arena.equals(deferredType, this.arena.never)) this.diagnostics.error('L2071', `defer expression must produce Unit, received ${this.arena.display(deferredType)}`, statement.expression.span);
					break;
				}
				case 'ExpressionStatement': { const result = this.checkExpression(statement.expression, scope); if (this.isMustUse(result)) this.diagnostics.error('L2097', `Value of type ${this.arena.display(result)} must be used; bind it, return it, await it, handle it, or write discard`, statement.span); break; }
		}
	}

	private checkExpression(expression: A.Expression, scope: Scope, expected?: TypeId): TypeId {
		let typeId: TypeId;
		switch (expression.kind) {
			case 'LiteralExpression': typeId = this.literalType(expression); break;
			case 'IdentifierExpression': {
				if (expression.name === 'None' && expected !== undefined && this.arena.get(expected).kind === 'option') { expression.inferredTypeId = expected; return expected; }
				const symbol = scope.lookup(expression.name);
				if (symbol === undefined) { this.diagnostics.error('L1010', `Unknown name ${expression.name}`, expression.span); typeId = this.arena.error; }
				else {
					expression.symbolId = symbol.id; typeId = symbol.typeId;
					if (symbol.typeOnly) this.diagnostics.error('L1012', `Type-only import ${expression.name} cannot be used as a value`, expression.span);
					if (this.#currentFunction?.declaration.kind === 'LambdaExpression' && this.containsOpenEffect(symbol.typeId) && symbol.declaration !== this.#currentFunction.declaration) this.diagnostics.error('L2113', 'uses * callbacks are non-escaping and cannot be captured by lambdas', expression.span);
					if (expected !== undefined && symbol.kind === 'variant') { const substitutions = new Map<string, TypeId>(); this.unify(typeId, expected, substitutions); typeId = this.substitute(typeId, substitutions); }
				}
				break;
			}
			case 'WildcardExpression': this.diagnostics.error('L2011', 'Wildcard can only be used in patterns or pipeline placeholders', expression.span); typeId = this.arena.error; break;
			case 'CallExpression': typeId = this.checkCall(expression, scope, expected); break;
			case 'FieldExpression': typeId = this.checkField(expression, scope); break;
			case 'BinaryExpression': typeId = this.checkBinary(expression, scope); break;
			case 'UnaryExpression': typeId = this.checkUnary(expression, scope); break;
			case 'PipelineExpression': typeId = this.checkPipeline(expression, scope); break;
			case 'TryExpression': typeId = this.checkTry(expression, scope); break;
			case 'AwaitExpression': typeId = this.checkAwait(expression, scope); break;
			case 'RecordExpression': typeId = this.checkRecord(expression, scope, expected); break;
			case 'RecordUpdateExpression': typeId = this.checkRecordUpdate(expression, scope); break;
			case 'ListExpression': typeId = this.checkList(expression, scope, expected); break;
			case 'TupleExpression': typeId = this.arena.tuple(expression.items.map(item => this.checkExpression(item, scope))); break;
			case 'ConditionalExpression': {
				this.requireBool(this.checkExpression(expression.condition, scope), expression.condition.span);
				const left = this.checkExpression(expression.thenExpression, scope, expected); const right = this.checkExpression(expression.elseExpression, scope, expected);
				typeId = this.commonType([left, right], expression.span); break;
			}
			case 'MatchExpression': typeId = this.checkMatch(expression, scope, expected); break;
			case 'LambdaExpression': typeId = this.checkLambda(expression, scope, expected); break;
			case 'ParallelExpression': typeId = this.checkParallel(expression, scope); break;
		}
		typeId = this.applyExpectedForeignBridge(expression, typeId, expected);
		expression.inferredTypeId = typeId; return typeId;
	}

	private checkForeignCall(expression: A.CallExpression, scope: Scope, callee: ForeignTypeSnapshot): TypeId {
		expression.foreignCall = true;
		this.requireEffects(['JavaScript'], expression.span);
		if (expression.typeArguments.length > 0) this.diagnostics.error('L4203', 'Explicit Virune type arguments are not supported for JavaScript calls; use a TypeScript interop adapter', expression.span);
		const argumentTypes = expression.arguments.map(argument => this.checkExpression(argument, scope));
		const interopArguments = argumentTypes.map((typeId, index) => this.interopArgumentType(typeId, expression.arguments[index]!.span));
		const resolution = this.#jsInteropProvider?.resolveCall(callee.ref, interopArguments);
		if (resolution === undefined) {
			this.diagnostics.error('L4204', `Cannot resolve JavaScript call for ${callee.display}; use a TypeScript interop adapter`, expression.span);
			return this.arena.error;
		}
		const minimum = Math.max(0, resolution.parameterCount - resolution.optionalParameterCount);
		if (expression.arguments.length < minimum || (!resolution.rest && expression.arguments.length > resolution.parameterCount)) this.diagnostics.error('L4205', `JavaScript call expects ${minimum}${resolution.rest ? '+' : `..${resolution.parameterCount}`} arguments, received ${expression.arguments.length}`, expression.span);
		this.#interopUsages.push({ kind: 'call', nodeId: expression.id, span: expression.span, foreignType: resolution.result, receiverMode: resolution.receiverMode, mayReject: resolution.mayReject });
		return this.arena.foreign(resolution.result);
	}

	private interopArgumentType(typeId: TypeId, span: SourceSpan): InteropArgumentType {
		const type = this.arena.get(typeId);
		if (type.kind === 'foreign') return { kind: 'foreign', type: type.ref };
		if (type.kind === 'primitive') {
			if (type.name === 'Unknown' || type.name === 'Never' || type.name === 'InvalidType') return { kind: 'unknown' };
			return { kind: 'native-primitive', primitive: type.name };
		}
		this.diagnostics.error('L4206', `Native value of type ${this.arena.display(typeId)} must be explicitly encoded before passing it to JavaScript`, span);
		return { kind: 'unknown' };
	}

	private applyExpectedForeignBridge(expression: A.Expression, actual: TypeId, expected: TypeId | undefined): TypeId {
		if (expected === undefined) return actual;
		const source = this.arena.get(actual);
		if (source.kind !== 'foreign') return actual;
		const bridge = this.primitiveBridge(source.snapshot, expected);
		if (bridge === undefined) return actual;
		expression.foreignBridge = bridge;
		this.#interopUsages.push({ kind: 'bridge', nodeId: expression.id, span: expression.span, foreignType: source.snapshot, bridge: { kind: 'primitive', bridge, targetType: expected } });
		return expected;
	}

	private primitiveBridge(source: ForeignTypeSnapshot, target: TypeId): PrimitiveBridgeKind | undefined {
		if (source.primitive === 'string' && this.arena.equals(target, this.arena.string)) return 'string';
		if (source.primitive === 'boolean' && this.arena.equals(target, this.arena.bool)) return 'bool';
		if (source.primitive === 'number' && this.arena.equals(target, this.arena.float)) return 'float';
		if (source.primitive === 'bigint' && this.arena.equals(target, this.arena.bigint)) return 'bigint';
		if (source.primitive === 'void' && this.arena.equals(target, this.arena.unit)) return 'unit';
		if (source.category === 'unknown' && this.arena.equals(target, this.arena.unknown)) return 'unknown';
		return undefined;
	}

	private literalType(expression: A.LiteralExpression): TypeId {
		switch (expression.literalKind) {
			case 'String': return this.arena.string;
			case 'Int':
				if (!Number.isSafeInteger(expression.value)) this.diagnostics.error('L2065', 'Int literal is outside the JavaScript safe integer range; use BigInt', expression.span);
				return this.arena.int;
			case 'Float': return this.arena.float;
			case 'BigInt': return this.arena.bigint;
			case 'Bool': return this.arena.bool;
		}
	}

	private checkCall(expression: A.CallExpression, scope: Scope, expected?: TypeId): TypeId {
		const calleeTypeId = this.checkExpression(expression.callee, scope);
		const calleeType = this.arena.get(calleeTypeId);
		if (calleeType.kind === 'foreign') return this.checkForeignCall(expression, scope, calleeType.snapshot);
		if (calleeType.kind !== 'function') { this.diagnostics.error('L2012', `Value of type ${this.arena.display(calleeTypeId)} is not callable`, expression.callee.span); expression.arguments.forEach(arg => this.checkExpression(arg, scope)); return this.arena.error; }
		this.requireEffects(calleeType.effects.filter(effect => effect !== '*'), expression.span);
		if (expression.arguments.length !== calleeType.parameters.length) this.diagnostics.error('L2013', `Expected ${calleeType.parameters.length} arguments, received ${expression.arguments.length}`, expression.span);
		const substitutions = new Map<string, TypeId>();
		const argumentTypes: TypeId[] = [];
		if (expression.typeArguments.length > 0) {
			if (expression.typeArguments.length !== calleeType.typeParameters.length) this.diagnostics.error('L2046', `Expected ${calleeType.typeParameters.length} type arguments, received ${expression.typeArguments.length}`, expression.span);
			expression.typeArguments.forEach((argument, index) => {
				const name = calleeType.typeParameters[index];
				if (name !== undefined) substitutions.set(name, this.resolveTypeReference(argument, this.#currentFunction?.typeParameters ?? new Map()));
			});
		}
		expression.arguments.forEach((argument, index) => {
			const parameter = calleeType.parameters[index] ?? this.arena.error;
			const argumentType = this.checkExpression(argument, scope, parameter);
			argumentTypes.push(argumentType);
			this.unify(parameter, argumentType, substitutions);
			const substituted = this.substitute(parameter, substitutions);
			if (!this.isAssignable(argumentType, substituted)) this.typeMismatch(argumentType, substituted, argument.span);
			const argumentFunction = this.arena.get(argumentType);
			if (argumentFunction.kind === 'function') this.requireEffects(argumentFunction.effects.filter(effect => effect !== '*'), argument.span);
		});
		if (expected !== undefined) this.unify(calleeType.result, expected, substitutions);
		const result = this.substitute(calleeType.result, substitutions);
		if (expression.callee.kind === 'FieldExpression' && expression.callee.target.kind === 'IdentifierExpression' && expression.callee.target.name === 'Json') {
			const resultType = this.arena.get(result);
			const jsonTarget = expression.callee.field === 'decode' && resultType.kind === 'result' ? resultType.value : expression.callee.field === 'encode' ? argumentTypes[0] : undefined;
			if (jsonTarget !== undefined) {
				if (this.containsTypeVariable(jsonTarget)) this.diagnostics.error('L2047', `Cannot infer JSON target type for Json.${expression.callee.field}`, expression.span);
				else if (!this.supportsJson(jsonTarget)) this.diagnostics.error('L2048', `Type ${this.arena.display(jsonTarget)} does not support Json`, expression.span);
			}
		}
		if (expression.callee.kind === 'FieldExpression' && expression.callee.target.kind === 'IdentifierExpression') {
			const namespace = expression.callee.target.name;
			const target = argumentTypes[0];
			if (namespace === 'Debug' && target !== undefined && !this.supportsDerive(target, 'Debug')) this.diagnostics.error('L2063', `Type ${this.arena.display(target)} does not support Debug`, expression.span);
			if (namespace === 'Map') {
				const key = substitutions.get('T') ?? (expression.callee.field === 'empty' ? undefined : expression.callee.field === 'size' || expression.callee.field === 'keys' || expression.callee.field === 'values' || expression.callee.field === 'entries' || expression.callee.field === 'mapValues' ? this.mapKeyOf(argumentTypes[0]) : argumentTypes[1]);
				if (key !== undefined && (!this.supportsEq(key) || !this.supportsHash(key))) this.diagnostics.error('L2109', `Map key type ${this.arena.display(key)} must support structural Eq and Hash`, expression.span);
			}
			if (namespace === 'Set') {
				const element = substitutions.get('T') ?? (expression.callee.field === 'from' ? this.listElementOf(argumentTypes[0]) : expression.callee.field === 'empty' ? undefined : this.setElementOf(argumentTypes[0]) ?? argumentTypes[1]);
				if (element !== undefined && (!this.supportsEq(element) || !this.supportsHash(element))) this.diagnostics.error('L2110', `Set element type ${this.arena.display(element)} must support structural Eq and Hash`, expression.span);
			}
			if (namespace === 'List' && expression.callee.field === 'unique') { const element = this.listElementOf(argumentTypes[0]); if (element !== undefined && (!this.supportsEq(element) || !this.supportsHash(element))) this.diagnostics.error('L2111', `List.unique element type ${this.arena.display(element)} must support structural Eq and Hash`, expression.span); }
				if (namespace === 'List' && expression.callee.field === 'uniqueBy') { const key = substitutions.get('U'); if (key !== undefined && (!this.supportsEq(key) || !this.supportsHash(key))) this.diagnostics.error('L2111', `List.uniqueBy key type ${this.arena.display(key)} must support structural Eq and Hash`, expression.span); }
		}
		return calleeType.async ? this.arena.future(result) : result;
	}

	private checkField(expression: A.FieldExpression, scope: Scope): TypeId {
		if (expression.target.kind === 'IdentifierExpression') {
			const namespace = expression.target.name;
			this.checkBuiltinPlatform(namespace, expression.span);
			const builtin = this.builtinMember(namespace, expression.field);
			if (builtin !== undefined) { this.checkExpression(expression.target, scope); return builtin; }
			const symbol = scope.lookup(namespace);
			if (symbol?.kind === 'type') {
				const named = this.arena.get(symbol.typeId);
				if (named.kind === 'named' && named.declarationKind === 'newtype' && named.underlying !== undefined && expression.field === 'create') {
					expression.target.symbolId = symbol.id;
					if (symbol.typeOnly) this.diagnostics.error('L1012', `Type-only import ${namespace} cannot be used as a value`, expression.span);
					if (symbol.declaration !== undefined && this.#signatureOnlyNodeIds.has(symbol.declaration.id)) this.diagnostics.error('L2117', `newtype constructor ${namespace}.create is private to its declaring module`, expression.span);
					return this.arena.function([named.underlying], symbol.typeId);
				}
				if (named.kind === 'named' && named.declarationKind === 'enum' && named.variants?.has(expression.field)) {
					expression.target.symbolId = symbol.id;
					if (symbol.typeOnly) this.diagnostics.error('L1012', `Type-only import ${namespace} cannot be used as a value`, expression.span);
					const values = named.variants.get(expression.field) ?? [];
					return values.length === 0 ? symbol.typeId : this.arena.function(values, symbol.typeId);
				}
			}
		}
		const targetTypeId = this.checkExpression(expression.target, scope);
		const targetType = this.arena.get(targetTypeId);
		if (targetType.kind === 'foreign') {
			this.requireEffects(['JavaScript'], expression.span);
			const property = this.#jsInteropProvider?.getProperty(targetType.ref, expression.field);
			if (property === undefined) { this.diagnostics.error('L4202', `Foreign type ${targetType.snapshot.display} has no accessible property ${expression.field}`, expression.span); return this.arena.error; }
			this.#interopUsages.push({ kind: 'property', nodeId: expression.id, span: expression.span, foreignType: property });
			return this.arena.foreign(property);
		}
		if (targetType.kind === 'named' && targetType.fields?.has(expression.field)) return targetType.fields.get(expression.field)!;
		if (targetType.kind === 'list' && expression.field === 'length') return this.arena.int;
		this.diagnostics.error('L2014', `Type ${this.arena.display(targetTypeId)} has no field ${expression.field}`, expression.span);
		return this.arena.error;
	}

	private builtinMember(namespace: string, member: string): TypeId | undefined {
		return builtinMember(this.arena, this.#namedTypes, namespace, member);
	}

	private checkBuiltinPlatform(namespace: string, span: A.AstNode['span']): void {
		const nodeOnly = new Set(['File', 'Path', 'Process', 'Http', 'Crypto']);
		const browserOnly = new Set(['Fetch', 'Storage', 'Dom']);
		if (nodeOnly.has(namespace) && this.#platform !== 'node') this.diagnostics.error('L4010', `${namespace} is only available on the node platform`, span);
		if (browserOnly.has(namespace) && this.#platform !== 'browser') this.diagnostics.error('L4011', `${namespace} is only available on the browser platform`, span);
	}

	private requireEffects(required: readonly string[], span: A.AstNode['span']): void {
		if (required.length === 0) return;
		const allowed = this.#currentFunction?.effects;
		for (const effect of required) {
			if (allowed?.has('*') === true || allowed?.has(effect) === true) continue;
			this.diagnostics.error('L2076', `Effect ${effect} is not declared by the enclosing function; add uses ${effect}`, span);
		}
	}

	private validateEffects(effects: readonly string[], span: A.AstNode['span']): void {
		for (const effect of effects) if (effect !== '*' && !this.#effects.has(effect)) this.diagnostics.error('L2085', `Unknown effect ${effect}; Virune supports only built-in effects`, span);
	}

	private checkBinary(expression: A.BinaryExpression, scope: Scope): TypeId {
		const left = this.checkExpression(expression.left, scope); const right = this.checkExpression(expression.right, scope);
		if (['&&', '||'].includes(expression.operator)) { this.requireBool(left, expression.left.span); this.requireBool(right, expression.right.span); return this.arena.bool; }
		if (['==', '!='].includes(expression.operator)) {
			if (!this.arena.equals(left, right)) this.typeMismatch(right, left, expression.right.span);
			else if (!this.supportsEq(left)) this.diagnostics.error('L2049', `Type ${this.arena.display(left)} does not support equality`, expression.span);
			return this.arena.bool;
		}
		if (['<', '<=', '>', '>='].includes(expression.operator)) { if (!this.arena.equals(left, right) || ![this.arena.int, this.arena.float, this.arena.bigint, this.arena.string].includes(left)) this.diagnostics.error('L2015', 'Comparison requires operands of the same ordered type', expression.span); return this.arena.bool; }
		if (!this.arena.equals(left, right)) { this.typeMismatch(right, left, expression.right.span); return this.arena.error; }
		if (expression.operator === '+' && left === this.arena.string) return this.arena.string;
		if (![this.arena.int, this.arena.float, this.arena.bigint].includes(left)) { this.diagnostics.error('L2016', `Operator ${expression.operator} cannot be applied to ${this.arena.display(left)}`, expression.span); return this.arena.error; }
		return left;
	}

	private checkUnary(expression: A.UnaryExpression, scope: Scope): TypeId {
		const operand = this.checkExpression(expression.operand, scope);
		if (expression.operator === '!') { this.requireBool(operand, expression.operand.span); return this.arena.bool; }
		if (![this.arena.int, this.arena.float, this.arena.bigint].includes(operand)) this.diagnostics.error('L2017', 'Unary minus requires a numeric value', expression.span);
		return operand;
	}

	private checkPipeline(expression: A.PipelineExpression, scope: Scope): TypeId {
		const leftType = this.checkExpression(expression.left, scope);
		if (expression.right.kind === 'CallExpression') {
			const calleeTypeId = this.checkExpression(expression.right.callee, scope); const callee = this.arena.get(calleeTypeId);
			if (callee.kind !== 'function') return this.arena.error;
			this.requireEffects(callee.effects.filter(effect => effect !== '*'), expression.right.span);
			const args = [expression.left, ...expression.right.arguments];
			if (callee.parameters.length !== args.length) this.diagnostics.error('L2018', `Pipeline target expects ${callee.parameters.length} arguments`, expression.right.span);
			const substitutions = new Map<string, TypeId>();
			if (expression.right.typeArguments.length > 0) {
				if (expression.right.typeArguments.length !== callee.typeParameters.length) this.diagnostics.error('L2046', `Expected ${callee.typeParameters.length} type arguments, received ${expression.right.typeArguments.length}`, expression.right.span);
				expression.right.typeArguments.forEach((argument, index) => { const name = callee.typeParameters[index]; if (name !== undefined) substitutions.set(name, this.resolveTypeReference(argument, this.#currentFunction?.typeParameters ?? new Map())); });
			}
			for (let index = 0; index < args.length; index++) {
				const argument = args[index]!;
				const parameter = callee.parameters[index] ?? this.arena.error;
				const actual = index === 0 ? leftType : this.checkExpression(argument, scope, this.substitute(parameter, substitutions));
				this.unify(parameter, actual, substitutions);
				const expectedParameter = this.substitute(parameter, substitutions);
				if (!this.isAssignable(actual, expectedParameter)) this.typeMismatch(actual, expectedParameter, argument.span);
				const callback = this.arena.get(actual);
				if (callback.kind === 'function') this.requireEffects(callback.effects.filter(effect => effect !== '*'), argument.span);
			}
			const result = this.substitute(callee.result, substitutions); return callee.async ? this.arena.future(result) : result;
		}
		const calleeTypeId = this.checkExpression(expression.right, scope); const callee = this.arena.get(calleeTypeId);
		if (callee.kind !== 'function' || callee.parameters.length !== 1) { this.diagnostics.error('L2019', 'Pipeline target must be a function accepting the piped value', expression.right.span); return this.arena.error; }
		this.requireEffects(callee.effects.filter(effect => effect !== '*'), expression.right.span);
		if (!this.isAssignable(leftType, callee.parameters[0]!)) this.typeMismatch(leftType, callee.parameters[0]!, expression.left.span);
		return callee.async ? this.arena.future(callee.result) : callee.result;
	}

	private checkTry(expression: A.TryExpression, scope: Scope): TypeId {
		const operandId = this.checkExpression(expression.operand, scope); const operand = this.arena.get(operandId);
		const returnId = this.#currentFunction?.returnType;
		if (returnId === undefined) { this.diagnostics.error('L2020', '? requires an enclosing function with a known return type', expression.span); return this.arena.error; }
		const returnType = this.arena.get(returnId);
		if (operand.kind === 'result' && returnType.kind === 'result') { if (!this.arena.equals(operand.error, returnType.error)) this.typeMismatch(operand.error, returnType.error, expression.span); return operand.value; }
		if (operand.kind === 'option' && returnType.kind === 'option') return operand.value;
		this.diagnostics.error('L2021', `Cannot propagate ${this.arena.display(operandId)} from function returning ${this.arena.display(returnId)}`, expression.span); return this.arena.error;
	}

	private checkAwait(expression: A.AwaitExpression, scope: Scope): TypeId {
		if (!this.#currentFunction?.async) this.diagnostics.error('L2022', 'await can only be used in an async function or test', expression.span);
		const operandId = this.checkExpression(expression.operand, scope); const operand = this.arena.get(operandId);
		if (operand.kind === 'foreign') {
			this.requireEffects(['JavaScript'], expression.span);
			const awaited = this.#jsInteropProvider?.getAwaitedType(operand.ref);
			if (awaited === undefined) { this.diagnostics.error('L2023', `await requires Future or JavaScript PromiseLike, received ${this.arena.display(operandId)}`, expression.span); return this.arena.error; }
			this.#interopUsages.push({ kind: 'await', nodeId: expression.id, span: expression.span, foreignType: awaited, mayReject: true });
			return this.arena.foreign(awaited);
		}
		if (operand.kind !== 'future') { this.diagnostics.error('L2023', `await requires Future, received ${this.arena.display(operandId)}`, expression.span); return this.arena.error; }
		return operand.value;
	}

	private checkRecord(expression: A.RecordExpression, scope: Scope, expected?: TypeId): TypeId {
		const typeId = this.#namedTypes.get(expression.name); const type = typeId === undefined ? undefined : this.arena.get(typeId);
		if (typeId === undefined || type?.kind !== 'named' || type.declarationKind !== 'record' || type.fields === undefined) { this.diagnostics.error('L2024', `Unknown record type ${expression.name}`, expression.span); expression.entries.forEach(entry => this.checkExpression(entry.value, scope)); return this.arena.error; }
		const declaration = this.#recordDeclarations.get(expression.name);
		const substitutions = new Map<string, TypeId>();
		if (expected !== undefined) {
			const expectedType = this.arena.get(expected);
			if (expectedType.kind === 'named' && expectedType.name === expression.name && declaration !== undefined) declaration.typeParameters.forEach((parameter, index) => substitutions.set(parameter.name, expectedType.arguments[index] ?? this.arena.error));
		}
		const supplied = new Set<string>();
		for (const entry of expression.entries) {
			if (supplied.has(entry.name)) this.diagnostics.error('L2025', `Duplicate record field ${entry.name}`, entry.span); supplied.add(entry.name);
			const rawExpected = type.fields.get(entry.name);
			const preliminaryExpected = rawExpected === undefined ? undefined : this.substitute(rawExpected, substitutions);
			const actual = this.checkExpression(entry.value, scope, preliminaryExpected);
			if (rawExpected === undefined) this.diagnostics.error('L2026', `Record ${expression.name} has no field ${entry.name}`, entry.span);
			else { this.unify(rawExpected, actual, substitutions); const fieldExpected = this.substitute(rawExpected, substitutions); if (!this.isAssignable(actual, fieldExpected)) this.typeMismatch(actual, fieldExpected, entry.value.span); }
		}
		for (const field of type.fields.keys()) if (!supplied.has(field)) this.diagnostics.error('L2027', `Missing record field ${field}`, expression.span);
		if (declaration === undefined || declaration.typeParameters.length === 0) return typeId;
		const argumentsList = declaration.typeParameters.map(parameter => substitutions.get(parameter.name) ?? this.arena.error);
		declaration.typeParameters.forEach((parameter, index) => { if (argumentsList[index] === this.arena.error) this.diagnostics.error('L2045', `Cannot infer type argument ${parameter.name} for ${expression.name}`, expression.span); });
		return this.arena.namedInstance(type, argumentsList, { fields: new Map([...type.fields].map(([name, field]) => [name, this.substitute(field, substitutions)])) });
	}

	private checkRecordUpdate(expression: A.RecordUpdateExpression, scope: Scope): TypeId {
		const base = this.checkExpression(expression.base, scope); const type = this.arena.get(base);
		if (type.kind !== 'named' || type.declarationKind !== 'record' || type.fields === undefined) { this.diagnostics.error('L2028', 'Record update requires a record value', expression.base.span); return this.arena.error; }
		for (const entry of expression.entries) { const expected = type.fields.get(entry.name); const actual = this.checkExpression(entry.value, scope, expected); if (expected === undefined) this.diagnostics.error('L2029', `Record has no field ${entry.name}`, entry.span); else if (!this.isAssignable(actual, expected)) this.typeMismatch(actual, expected, entry.value.span); }
		return base;
	}

	private checkList(expression: A.ListExpression, scope: Scope, expected?: TypeId): TypeId {
		if (expression.items.length === 0) {
			const expectedType = expected === undefined ? undefined : this.arena.get(expected);
			if (expected !== undefined && expectedType?.kind === 'list') return expected;
			this.diagnostics.error('L2030', 'Empty List requires an explicit type annotation', expression.span); return this.arena.list(this.arena.error);
		}
		const itemTypes = expression.items.map(item => this.checkExpression(item, scope)); const element = this.commonType(itemTypes, expression.span); return this.arena.list(element);
	}

	private checkMatch(expression: A.MatchExpression, scope: Scope, expected?: TypeId): TypeId {
		const target = this.checkExpression(expression.target, scope); const resultTypes: TypeId[] = []; const covered = new Set<string>(); const seenPatterns = new Set<string>(); let wildcard = false;
		for (const arm of expression.arms) {
			const child = new Scope(scope); const key = this.checkPattern(arm.pattern, target, child);
			if (arm.guard === undefined && key === '*') wildcard = true;
			else if (arm.guard === undefined && key !== undefined) {
				if (seenPatterns.has(key)) this.diagnostics.error('L3002', `Unreachable duplicate pattern ${key}`, arm.pattern.span);
				seenPatterns.add(key); covered.add(key.includes('(') ? key.slice(0, key.indexOf('(')) : key);
			}
			if (arm.guard !== undefined) this.requireBool(this.checkExpression(arm.guard, child), arm.guard.span);
			resultTypes.push(this.checkExpression(arm.expression, child, expected));
		}
		const targetType = this.arena.get(target);
		if (!wildcard) {
			if (target === this.arena.bool && (!covered.has('true') || !covered.has('false'))) this.diagnostics.error('L3003', 'Bool match must cover true and false', expression.span);
			if (targetType.kind === 'named' && targetType.declarationKind === 'enum' && targetType.variants !== undefined) for (const name of targetType.variants.keys()) if (!covered.has(name)) this.diagnostics.error('L3004', `Non-exhaustive match: missing ${name}`, expression.span);
			if (targetType.kind === 'option') for (const name of ['Some', 'None']) if (!covered.has(name)) this.diagnostics.error('L3004', `Non-exhaustive match: missing ${name}`, expression.span);
			if (targetType.kind === 'result') for (const name of ['Ok', 'Err']) if (!covered.has(name)) this.diagnostics.error('L3004', `Non-exhaustive match: missing ${name}`, expression.span);
			if ([this.arena.int, this.arena.string].includes(target)) this.diagnostics.error('L3005', 'Int and String matches require a wildcard arm', expression.span);
		}
		return this.commonType(resultTypes, expression.span);
	}

	private checkPattern(pattern: A.Pattern, target: TypeId, scope: Scope): string | undefined {
		switch (pattern.kind) {
			case 'WildcardPattern': return '*';
			case 'BindingPattern': { const symbol = this.#factory.create(pattern.name, 'variable', target, pattern.span, { declaration: pattern }); if (!scope.define(symbol)) this.diagnostics.error('L1011', `Pattern name ${pattern.name} shadows an existing name`, pattern.span); else { pattern.symbolId = symbol.id; this.#symbols.set(symbol.id, symbol); } return '*'; }
			case 'LiteralPattern': { const literalType = pattern.literalKind === 'Bool' ? this.arena.bool : pattern.literalKind === 'Int' ? this.arena.int : this.arena.string; if (!this.arena.equals(literalType, target)) this.typeMismatch(literalType, target, pattern.span); return String(pattern.value); }
			case 'VariantPattern': {
				let values: readonly TypeId[] | undefined; let enumType: TypeId | undefined;
				if (pattern.name === 'Some') { const t = this.arena.get(target); if (t.kind === 'option') { values = [t.value]; enumType = target; } }
				else if (pattern.name === 'None') { const t = this.arena.get(target); if (t.kind === 'option') { values = []; enumType = target; } }
				else if (pattern.name === 'Ok') { const t = this.arena.get(target); if (t.kind === 'result') { values = [t.value]; enumType = target; } }
				else if (pattern.name === 'Err') { const t = this.arena.get(target); if (t.kind === 'result') { values = [t.error]; enumType = target; } }
				else {
					const variant = this.#variants.get(pattern.name);
					if (variant !== undefined) {
						const substitutions = new Map<string, TypeId>(); this.unify(variant.enumType, target, substitutions);
						values = variant.valueTypes.map(value => this.substitute(value, substitutions)); enumType = this.substitute(variant.enumType, substitutions); pattern.symbolId = variant.symbol.id;
					}
				}
				if (values === undefined || enumType === undefined || !this.arena.equals(enumType, target)) { this.diagnostics.error('L2031', `Variant ${pattern.name} does not belong to ${this.arena.display(target)}`, pattern.span); return pattern.name; }
				if (values.length !== pattern.values.length) this.diagnostics.error('L2032', `Variant ${pattern.name} expects ${values.length} patterns`, pattern.span);
				const childKeys = pattern.values.map((item, index) => this.checkPattern(item, values[index] ?? this.arena.error, scope) ?? '?'); return `${pattern.name}(${childKeys.join(',')})`;
			}
			case 'RecordPattern': {
				const typeId = this.#namedTypes.get(pattern.name); const type = typeId === undefined ? undefined : this.arena.get(typeId);
				if (typeId === undefined || !this.arena.equals(typeId, target) || type?.kind !== 'named' || type.fields === undefined) this.diagnostics.error('L2033', `Record pattern ${pattern.name} does not match ${this.arena.display(target)}`, pattern.span);
				else for (const field of pattern.fields) { const fieldType = type.fields.get(field.name); if (fieldType === undefined) this.diagnostics.error('L2034', `Unknown field ${field.name}`, field.span); else this.checkPattern(field.pattern, fieldType, scope); }
				return '*';
			}
			case 'RangePattern': {
				if (!this.arena.equals(target, this.arena.int)) this.typeMismatch(this.arena.int, target, pattern.span);
				if (pattern.start > pattern.end) this.diagnostics.error('L2073', 'Range pattern start must not exceed its end', pattern.span);
				return `${pattern.start}..=${pattern.end}`;
			}
			case 'ListPattern': {
				const targetType = this.arena.get(target);
				if (targetType.kind !== 'list') { this.diagnostics.error('L2074', `List pattern does not match ${this.arena.display(target)}`, pattern.span); return '*'; }
				for (const item of pattern.items) this.checkPattern(item, targetType.element, scope);
				if (pattern.rest?.kind === 'BindingPattern') {
					const symbol = this.#factory.create(pattern.rest.name, 'variable', target, pattern.rest.span, { declaration: pattern.rest });
					if (!scope.define(symbol)) this.diagnostics.error('L1011', `Pattern name ${pattern.rest.name} shadows an existing name`, pattern.rest.span); else { pattern.rest.symbolId = symbol.id; this.#symbols.set(symbol.id, symbol); }
				}
				return '*';
			}
			case 'TuplePattern': {
				const targetType = this.arena.get(target);
				if (targetType.kind !== 'tuple') { this.diagnostics.error('L2111', `Tuple pattern does not match ${this.arena.display(target)}`, pattern.span); return '*'; }
				if (targetType.items.length !== pattern.items.length) this.diagnostics.error('L2112', `Tuple pattern expects ${targetType.items.length} items, received ${pattern.items.length}`, pattern.span);
				pattern.items.forEach((item, index) => this.checkPattern(item, targetType.items[index] ?? this.arena.error, scope));
				return '*';
			}
			case 'OrPattern': {
				if (pattern.alternatives.some(item => this.patternHasBinding(item))) this.diagnostics.error('L2075', 'OR patterns cannot bind names in Virune 1.0', pattern.span);
				return pattern.alternatives.map(item => this.checkPattern(item, target, new Scope(scope)) ?? '?').join('|');
			}
		}
	}


	private patternHasBinding(pattern: A.Pattern): boolean {
		switch (pattern.kind) {
			case 'BindingPattern': return true;
			case 'VariantPattern': return pattern.values.some(item => this.patternHasBinding(item));
			case 'RecordPattern': return pattern.fields.some(field => this.patternHasBinding(field.pattern));
			case 'ListPattern': return pattern.items.some(item => this.patternHasBinding(item)) || pattern.rest?.kind === 'BindingPattern';
			case 'TuplePattern': return pattern.items.some(item => this.patternHasBinding(item));
			case 'OrPattern': return pattern.alternatives.some(item => this.patternHasBinding(item));
			default: return false;
		}
	}

	private checkLambda(expression: A.LambdaExpression, scope: Scope, expected?: TypeId): TypeId {
		const expectedType = expected === undefined ? undefined : this.arena.get(expected);
		const child = new Scope(scope); const parameters: TypeId[] = [];
		expression.parameters.forEach((parameter, index) => {
			const typeId = parameter.annotation === undefined ? expectedType?.kind === 'function' ? expectedType.parameters[index] ?? this.arena.error : this.arena.error : this.resolveTypeReference(parameter.annotation, new Map());
			if (typeId === this.arena.error) this.diagnostics.error('L2035', `Cannot infer type of lambda parameter ${parameter.name}`, parameter.span);
			const symbol = this.#factory.create(parameter.name, 'parameter', typeId, parameter.span, { declaration: expression }); if (!child.define(symbol)) this.diagnostics.error('L1012', `Lambda parameter ${parameter.name} shadows an existing name`, parameter.span); else { parameter.symbolId = symbol.id; this.#symbols.set(symbol.id, symbol); } parameters.push(typeId);
		});
		if (expectedType?.kind === 'function' && expression.async !== expectedType.async) this.diagnostics.error('L2083', `Lambda async mode does not match expected ${expectedType.async ? 'async ' : ''}function`, expression.span);
		const expectedResult = expression.returnType === undefined ? expectedType?.kind === 'function' ? expectedType.result : undefined : this.resolveTypeReference(expression.returnType, new Map());
		if (!expression.expressionBody && expectedResult === undefined) this.diagnostics.error('L2084', 'Block lambdas require a return type unless the expected function type supplies one', expression.span);
		const effects = expression.effects.length > 0 ? expression.effects : expectedType?.kind === 'function' ? expectedType.effects : [];
		const previous = this.#currentFunction;
		const context: FunctionContext = { declaration: expression, scope: child, async: expression.async, returnTypes: [], typeParameters: new Map(), effects: new Set(effects), ...(expectedResult === undefined ? {} : { returnType: expectedResult }) };
		this.#currentFunction = context;
		let result: TypeId;
		if (expression.expressionBody) {
			result = this.checkExpression(expression.body as A.Expression, child, expectedResult);
			context.returnTypes.push(result);
		} else {
			this.checkBlock(expression.body as A.BlockStatement, child);
			result = expectedResult ?? this.commonType(context.returnTypes, expression.span);
			const controlFlow = analyzeControlFlow(expression.body as A.BlockStatement, this.arena);
			if (result !== this.arena.unit && !controlFlow.alwaysTerminates) this.diagnostics.error('L3001', 'Lambda does not return on every path', expression.span);
			for (const span of controlFlow.unreachable) this.diagnostics.error('L3006', 'Unreachable statement', span);
		}
		this.#currentFunction = previous;
		if (expectedResult !== undefined && !this.isAssignable(result, expectedResult)) this.typeMismatch(result, expectedResult, expression.span);
		return this.arena.function(parameters, expectedResult ?? result, [], expression.async, effects);
	}

	private checkParallel(expression: A.ParallelExpression, scope: Scope): TypeId {
		const fields = new Map<string, TypeId>(); let commonError: TypeId | undefined;
		for (const entry of expression.entries) {
			if (fields.has(entry.name)) this.diagnostics.error('L2036', `Duplicate parallel entry ${entry.name}`, entry.span);
			const futureId = this.checkExpression(entry.value, scope); const future = this.arena.get(futureId);
			if (future.kind !== 'future') { this.diagnostics.error('L2037', 'parallel entries must be async expressions', entry.value.span); fields.set(entry.name, this.arena.error); continue; }
			if (expression.tryMode) {
				const result = this.arena.get(future.value); if (result.kind !== 'result') { this.diagnostics.error('L2038', 'parallel try entries must return Result', entry.value.span); fields.set(entry.name, this.arena.error); continue; }
				if (commonError !== undefined && !this.arena.equals(commonError, result.error)) this.diagnostics.error('L2039', 'parallel try entries must share the same error type', entry.value.span); commonError ??= result.error; fields.set(entry.name, result.value);
			} else fields.set(entry.name, future.value);
		}
		const record = this.arena.add({ kind: 'named', name: `$Parallel${expression.id}`, definitionId: `${this.#moduleId}#$Parallel${expression.id}`, declarationKind: 'record', arguments: [], fields });
		return this.arena.future(expression.tryMode ? this.arena.result(record, commonError ?? this.arena.error) : record);
	}

	private resolveTypeReference(reference: A.TypeReferenceNode, typeParameters: ReadonlyMap<string, TypeId>): TypeId {
		if (reference.functionType !== undefined) {
			const functionType = reference.functionType;
			this.validateEffects(functionType.effects, reference.span);
			let resolved = this.arena.function(
				functionType.parameters.map(parameter => this.resolveTypeReference(parameter, typeParameters)),
				this.resolveTypeReference(functionType.result, typeParameters),
				[],
				functionType.async,
				functionType.effects,
			);
			if (reference.optional) resolved = this.arena.option(resolved);
			reference.resolvedTypeId = resolved;
			return resolved;
		}
		let typeId = typeParameters.get(reference.name) ?? this.#namedTypes.get(reference.name);
		if (typeId === undefined) {
			const imported = this.globalScope.lookup(reference.name);
			if (imported?.typeOnly === true) {
				const importedType = this.arena.get(imported.typeId);
				if (importedType.kind === 'foreign') typeId = imported.typeId;
			}
		}
		const args = reference.arguments.map(item => this.resolveTypeReference(item, typeParameters));
		if (reference.name === 'List') typeId = args.length === 1 ? this.arena.list(args[0]!) : this.invalidArity(reference, 1, args.length);
		else if (reference.name === 'Map') typeId = args.length === 2 ? this.arena.map(args[0]!, args[1]!) : this.invalidArity(reference, 2, args.length);
		else if (reference.name === 'Set') typeId = args.length === 1 ? this.arena.set(args[0]!) : this.invalidArity(reference, 1, args.length);
		else if (reference.name === 'Option') typeId = args.length === 1 ? this.arena.option(args[0]!) : this.invalidArity(reference, 1, args.length);
		else if (reference.name === 'Result') typeId = args.length === 2 ? this.arena.result(args[0]!, args[1]!) : this.invalidArity(reference, 2, args.length);
		else if (reference.name === 'Validation') typeId = args.length === 2 ? this.arena.result(args[0]!, this.arena.list(args[1]!)) : this.invalidArity(reference, 2, args.length);
		else if (reference.name === '$Tuple') typeId = args.length >= 2 ? this.arena.tuple(args) : this.invalidArity(reference, 2, args.length);
		else if (reference.name === 'Stream') typeId = args.length === 1 ? this.arena.add({ kind: 'named', name: 'Stream', definitionId: 'std:Stream', declarationKind: 'alias', arguments: [args[0]!] }) : this.invalidArity(reference, 1, args.length);
		else if (typeId === undefined) { this.diagnostics.error('L2040', `Unknown type ${reference.name}`, reference.span); typeId = this.arena.error; }
		else if (args.length > 0) {
			const named = this.arena.get(typeId);
			if (named.kind === 'named') {
				const declaration = this.#recordDeclarations.get(reference.name) ?? this.#enumDeclarations.get(reference.name) ?? this.#typeAliasDeclarations.get(reference.name);
				const parameters = declaration?.typeParameters ?? [];
				if (parameters.length !== args.length) this.diagnostics.error('L2041', `${reference.name} expects ${parameters.length} type arguments, received ${args.length}`, reference.span);
				const substitutions = new Map(parameters.map((item, index) => [item.name, args[index] ?? this.arena.error]));
				typeId = this.arena.add({ ...named, arguments: args, ...(named.fields === undefined ? {} : { fields: new Map([...named.fields].map(([field, fieldType]) => [field, this.substitute(fieldType, substitutions)])) }), ...(named.variants === undefined ? {} : { variants: new Map([...named.variants].map(([variant, values]) => [variant, values.map(value => this.substitute(value, substitutions))])) }), ...(named.underlying === undefined ? {} : { underlying: this.substitute(named.underlying, substitutions) }) });
			}
		}
		const resolvedNamed = this.arena.get(typeId);
		if (resolvedNamed.kind === 'named' && resolvedNamed.declarationKind === 'alias' && resolvedNamed.underlying !== undefined) typeId = resolvedNamed.underlying;

		if (reference.optional) typeId = this.arena.option(typeId);
		reference.resolvedTypeId = typeId; return typeId;
	}

	private containsForeignType(typeId: TypeId, seen = new Set<TypeId>()): boolean {
		if (seen.has(typeId)) return false;
		seen.add(typeId);
		const type = this.arena.get(typeId);
		switch (type.kind) {
			case 'foreign': return true;
			case 'function': return type.parameters.some(item => this.containsForeignType(item, seen)) || this.containsForeignType(type.result, seen);
			case 'list': case 'set': return this.containsForeignType(type.element, seen);
			case 'map': return this.containsForeignType(type.key, seen) || this.containsForeignType(type.value, seen);
			case 'tuple': return type.items.some(item => this.containsForeignType(item, seen));
			case 'option': case 'future': return this.containsForeignType(type.value, seen);
			case 'result': return this.containsForeignType(type.value, seen) || this.containsForeignType(type.error, seen);
			case 'named': return type.arguments.some(item => this.containsForeignType(item, seen)) || (type.underlying !== undefined && this.containsForeignType(type.underlying, seen));
			default: return false;
		}
	}


	private containsOpenEffect(typeId: TypeId, seen = new Set<TypeId>()): boolean {
		if (seen.has(typeId)) return false;
		seen.add(typeId);
		const type = this.arena.get(typeId);
		switch (type.kind) {
			case 'function': return type.effects.includes('*') || type.parameters.some(item => this.containsOpenEffect(item, seen)) || this.containsOpenEffect(type.result, seen);
			case 'list': case 'set': return this.containsOpenEffect(type.element, seen);
			case 'map': return this.containsOpenEffect(type.key, seen) || this.containsOpenEffect(type.value, seen);
			case 'tuple': return type.items.some(item => this.containsOpenEffect(item, seen));
			case 'option': case 'future': return this.containsOpenEffect(type.value, seen);
			case 'result': return this.containsOpenEffect(type.value, seen) || this.containsOpenEffect(type.error, seen);
			case 'named': return type.arguments.some(item => this.containsOpenEffect(item, seen)) || (type.underlying !== undefined && this.containsOpenEffect(type.underlying, seen)) || [...(type.fields?.values() ?? [])].some(item => this.containsOpenEffect(item, seen)) || [...(type.variants?.values() ?? [])].flat().some(item => this.containsOpenEffect(item, seen));
			default: return false;
		}
	}

	private isSafeFfiType(typeId: TypeId, seen = new Set<TypeId>()): boolean {
		const type = this.arena.get(typeId);
		if (type.kind === 'primitive') return type.name !== 'Never' && type.name !== 'InvalidType';
		if (seen.has(typeId)) return false;
		seen.add(typeId);
		switch (type.kind) {
			case 'function': case 'foreign': case 'typeVariable': return false;
			case 'list': return this.isSafeFfiType(type.element, seen);
			case 'tuple': return type.items.every(item => this.isSafeFfiType(item, new Set(seen)));
			case 'option': case 'future': return this.isSafeFfiType(type.value, seen);
			case 'result': return this.isSafeFfiType(type.value, new Set(seen)) && this.isSafeFfiType(type.error, new Set(seen));
			case 'map': return this.isSafeFfiPrimitiveKey(type.key) && this.isSafeFfiType(type.value, seen);
			case 'set': return this.isSafeFfiPrimitiveKey(type.element);
			case 'named': {
				if (type.arguments.some(item => this.arena.get(item).kind === 'typeVariable')) return false;
				if (type.underlying !== undefined) return this.isSafeFfiType(type.underlying, seen);
				if (type.fields !== undefined) return [...type.fields.values()].every(item => this.isSafeFfiType(item, new Set(seen)));
				if (type.variants !== undefined) return [...type.variants.values()].flat().every(item => this.isSafeFfiType(item, new Set(seen)));
				return false;
			}
		}
	}

	private isSafeFfiPrimitiveKey(typeId: TypeId): boolean {
		const type = this.arena.get(typeId);
		return type.kind === 'primitive' && ['String', 'Int', 'BigInt', 'Bool'].includes(type.name);
	}

	private invalidArity(reference: A.TypeReferenceNode, expected: number, actual: number): TypeId { this.diagnostics.error('L2041', `${reference.name} expects ${expected} type arguments, received ${actual}`, reference.span); return this.arena.error; }


	private isAssignable(source: TypeId, target: TypeId): boolean { return this.#types.isAssignable(source, target); }
	private listElementOf(typeId: TypeId | undefined): TypeId | undefined { return this.#types.listElementOf(typeId); }
	private setElementOf(typeId: TypeId | undefined): TypeId | undefined { return this.#types.setElementOf(typeId); }
	private mapKeyOf(typeId: TypeId | undefined): TypeId | undefined { return this.#types.mapKeyOf(typeId); }
	private isMustUse(typeId: TypeId, seen = new Set<TypeId>()): boolean { return this.#types.isMustUse(typeId, seen); }
	private supportsHash(typeId: TypeId, seen = new Set<TypeId>()): boolean { return this.#types.supportsHash(typeId, seen); }
	private containsTypeVariable(typeId: TypeId, seen = new Set<TypeId>()): boolean { return this.#types.containsTypeVariable(typeId, seen); }
	private supportsDerive(typeId: TypeId, derive: 'Debug', seen = new Set<TypeId>()): boolean { return this.#types.supportsDerive(typeId, derive, seen); }
	private supportsJson(typeId: TypeId, seen = new Set<TypeId>()): boolean { return this.#types.supportsJson(typeId, seen); }
	private supportsDerivedEq(typeId: TypeId, owner: TypeId, seen = new Set<TypeId>()): boolean { return this.#types.supportsDerivedEq(typeId, owner, seen); }
	private supportsEq(typeId: TypeId, seen = new Set<TypeId>()): boolean { return this.#types.supportsEq(typeId, seen); }
	private commonType(types: readonly TypeId[], span: SourceSpan): TypeId { return this.#types.commonType(types, span); }


	private isConstantExpression(expression: A.Expression): boolean {
		switch (expression.kind) {
			case 'LiteralExpression': return true;
			case 'IdentifierExpression': return expression.symbolId !== undefined && this.#symbols.get(expression.symbolId)?.constant === true;
			case 'UnaryExpression': return this.isConstantExpression(expression.operand);
			case 'BinaryExpression': return this.isConstantExpression(expression.left) && this.isConstantExpression(expression.right);
			case 'ListExpression': case 'TupleExpression': return expression.items.every(item => this.isConstantExpression(item));
			case 'RecordExpression': return expression.entries.every(entry => this.isConstantExpression(entry.value));
			case 'ConditionalExpression': return this.isConstantExpression(expression.condition) && this.isConstantExpression(expression.thenExpression) && this.isConstantExpression(expression.elseExpression);
			default: return false;
		}
	}

	private requireBool(typeId: TypeId, span: SourceSpan): void { if (!this.arena.equals(typeId, this.arena.bool)) this.typeMismatch(typeId, this.arena.bool, span); }
	private typeMismatch(actual: TypeId, expected: TypeId, span: SourceSpan): void { this.diagnostics.error('L2043', `${this.arena.display(actual)} cannot be used as ${this.arena.display(expected)}`, span); }

	private unify(pattern: TypeId, actual: TypeId, substitutions: Map<string, TypeId>): void { this.#types.unify(pattern, actual, substitutions); }
	private substitute(typeId: TypeId, substitutions: ReadonlyMap<string, TypeId>): TypeId { return this.#types.substitute(typeId, substitutions); }



}


function stableForeignUsage(usage: import('../interop/types.js').ForeignUsage): import('../interop/types.js').ForeignUsageIR {
	const { ref: _ref, ...foreignType } = usage.foreignType;
	return {
		kind: usage.kind,
		nodeId: usage.nodeId,
		span: usage.span,
		foreignType,
		...(usage.runtimeImport === undefined ? {} : { runtimeImport: usage.runtimeImport }),
		...(usage.moduleWitness === undefined ? {} : { moduleWitness: usage.moduleWitness }),
		...(usage.receiverMode === undefined ? {} : { receiverMode: usage.receiverMode }),
		...(usage.mayReject === undefined ? {} : { mayReject: usage.mayReject }),
		...(usage.bridge === undefined ? {} : { bridge: usage.bridge }),
	};
}

export function checkModule(module: A.ModuleNode, options: TypeCheckerOptions = {}): SemanticModel { return new TypeChecker(options).check(module); }
