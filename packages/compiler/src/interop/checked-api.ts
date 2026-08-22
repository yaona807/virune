import type * as A from '../ast/nodes.js';
import {
	compileSource as compileSourceBase,
	type CompileOptions,
	type CompileResult,
} from '../compiler.js';
import {
	checkModule as checkModuleBase,
	TypeChecker as BaseTypeChecker,
	type SemanticModel,
	type TypeCheckerOptions,
} from '../checker/checker.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import {
	buildProject as buildProjectBase,
	ProjectBuildCache,
	type BuildProjectOptions,
	type ProjectBuildResult,
} from '../project/project.js';
import { IncrementalProjectBuilder as BaseIncrementalProjectBuilder } from '../project/incremental.js';
import type { SourceFile } from '../source.js';
import { currentCheckedInterop, invalidateCheckedSemantic, isCurrentCheckedSemantic, registerCheckedSemantic } from './check-session.js';
import { invalidateCheckedSourceIdentity, isCurrentCheckedSourceIdentity, registerCheckedSourceIdentity } from './source-identity.js';

type CheckedModuleMap = ReadonlyMap<A.ModuleNode, SemanticModel>;

interface SemanticReuseSeal {
	readonly operationState: string;
	readonly semanticDiagnosticsState: string;
}

const currentModulesByCache = new WeakMap<ProjectBuildCache, CheckedModuleMap>();
const reuseSealBySemantic = new WeakMap<object, SemanticReuseSeal>();
const activeCaches = new WeakSet<ProjectBuildCache>();
const activeCheckedModules = new WeakSet<A.ModuleNode>();

function invalidateCheckedModule(module: A.ModuleNode): void {
	invalidateCheckedSemantic(module);
	invalidateCheckedSourceIdentity(module);
}

function registerCheckedModule(
	module: A.ModuleNode,
	semantic: SemanticModel,
	diagnostics: readonly Diagnostic[],
): void {
	const previousSeal = reuseSealBySemantic.get(semantic);
	try {
		registerCheckedSourceIdentity(module, semantic);
		registerCheckedSemantic(module, semantic, diagnostics);
		const currentSeal = semanticReuseSeal(module, semantic);
		if (previousSeal !== undefined) {
			if (
				previousSeal.operationState !== currentSeal.operationState
				|| previousSeal.semanticDiagnosticsState !== currentSeal.semanticDiagnosticsState
			) {
				throw new Error('Cannot reuse checked semantic after its operation evidence changed');
			}
		} else {
			reuseSealBySemantic.set(semantic, currentSeal);
		}
	} catch (error) {
		invalidateCheckedModule(module);
		throw error;
	}
}

function semanticReuseSeal(module: A.ModuleNode, semantic: SemanticModel): SemanticReuseSeal {
	const interop = currentCheckedInterop(module, semantic);
	if (interop === undefined) throw new Error('Cannot seal a semantic that is not the current checked session');
	return Object.freeze({
		operationState: reuseStructuralState(interop),
		semanticDiagnosticsState: reuseStructuralState(semantic.diagnostics.items),
	});
}

/**
 * Encode only own data properties from compiler-owned snapshots. Reuse safety
 * must not depend on inherited serialization/iteration/array helpers that
 * callers can replace between cache preflight and cached semantic registration.
 */
function reuseStructuralState(value: unknown): string {
	return encodeReuseStructuralValue(value, new Map<object, number>());
}

function encodeReuseStructuralValue(value: unknown, seen: Map<object, number>): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'string') return `string:${value.length}:${value}`;
	if (typeof value === 'boolean') return value ? 'boolean:true' : 'boolean:false';
	if (typeof value === 'bigint') return `bigint:${value}`;
	if (typeof value === 'number') {
		if (Number.isNaN(value)) return 'number:NaN';
		if (value === Number.POSITIVE_INFINITY) return 'number:+Infinity';
		if (value === Number.NEGATIVE_INFINITY) return 'number:-Infinity';
		if (Object.is(value, -0)) return 'number:-0';
		return `number:${value}`;
	}
	if (typeof value === 'function' || typeof value === 'symbol') {
		throw new Error('Cannot seal checked semantic evidence containing executable or symbolic values');
	}
	if (typeof value !== 'object') throw new Error(`Cannot seal checked semantic ${typeof value} value`);

	const existing = seen.get(value);
	if (existing !== undefined) return `reference:${existing}`;
	const id = seen.size;
	seen.set(value, id);

	if (Array.isArray(value)) {
		if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('Cannot seal checked semantic array with a changed prototype');
		const keys = Reflect.ownKeys(value);
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
		if (
			lengthDescriptor === undefined
			|| !('value' in lengthDescriptor)
			|| typeof lengthDescriptor.value !== 'number'
			|| !Number.isSafeInteger(lengthDescriptor.value)
			|| lengthDescriptor.value < 0
		) {
			throw new Error('Cannot seal checked semantic array with an invalid length');
		}
		const length = lengthDescriptor.value;
		let indexKeyCount = 0;
		for (const key of keys) {
			if (typeof key === 'symbol') throw new Error('Cannot seal checked semantic array with symbol fields');
			if (key === 'length') continue;
			const index = Number(key);
			if (!Number.isSafeInteger(index) || index < 0 || index >= length || `${index}` !== key) {
				throw new Error('Cannot seal checked semantic array with sparse or extra fields');
			}
			indexKeyCount++;
		}
		if (indexKeyCount !== length) throw new Error('Cannot seal checked semantic array with sparse or extra fields');
		let encodedItems = '';
		for (let index = 0; index < length; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, `${index}`);
			if (descriptor === undefined || !('value' in descriptor)) throw new Error('Cannot seal checked semantic array with accessor entries');
			if (index > 0) encodedItems += ',';
			encodedItems += encodeReuseStructuralValue(descriptor.value, seen);
		}
		return `array:${id}:[${encodedItems}]`;
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error('Cannot seal checked semantic object with a changed prototype');
	const keys = Reflect.ownKeys(value);
	let encodedFields = '';
	let fieldIndex = 0;
	for (const key of keys) {
		if (typeof key === 'symbol') throw new Error('Cannot seal checked semantic object with symbol fields');
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !('value' in descriptor)) throw new Error(`Cannot seal checked semantic accessor field ${key}`);
		if (fieldIndex > 0) encodedFields += ',';
		encodedFields += `${key.length}:${key}=${encodeReuseStructuralValue(descriptor.value, seen)}`;
		fieldIndex++;
	}
	return `object:${id}:{${encodedFields}}`;
}

function checkedModules(result: ProjectBuildResult): CheckedModuleMap {
	const modules = new Map<A.ModuleNode, SemanticModel>();
	for (const module of result.modules) {
		if (module.ast !== undefined && module.semantic !== undefined) modules.set(module.ast, module.semantic);
	}
	return modules;
}

function invalidateModules(modules: CheckedModuleMap | undefined): void {
	if (modules === undefined) return;
	for (const module of modules.keys()) invalidateCheckedModule(module);
}

function reusableModulesAreCurrent(modules: CheckedModuleMap | undefined): boolean {
	if (modules === undefined) return true;
	for (const [module, semantic] of modules) {
		if (!isCurrentCheckedSemantic(module, semantic) || !isCurrentCheckedSourceIdentity(module)) return false;
	}
	return true;
}

function trackedReusedSemanticCount(result: ProjectBuildResult, previous: CheckedModuleMap | undefined): number {
	if (previous === undefined) return 0;
	const trackedSemantics = new Set<SemanticModel>();
	for (const semantic of previous.values()) trackedSemantics.add(semantic);
	let count = 0;
	for (const module of result.modules) {
		if (module.semantic !== undefined && trackedSemantics.has(module.semantic)) count++;
	}
	return count;
}

function trackedReusedParsedCount(result: ProjectBuildResult, previous: CheckedModuleMap | undefined): number {
	if (previous === undefined) return 0;
	let count = 0;
	for (const module of result.modules) {
		if (module.ast !== undefined && previous.has(module.ast)) count++;
	}
	return count;
}

function registerCompileResult(result: CompileResult): CompileResult {
	if (result.ast !== undefined && result.semantic !== undefined) {
		registerCheckedModule(result.ast, result.semantic, result.diagnostics);
	}
	return result;
}

function registerProjectResult(result: ProjectBuildResult): ProjectBuildResult {
	const modules = checkedModules(result);
	try {
		for (const module of result.modules) {
			if (module.ast !== undefined && module.semantic !== undefined) {
				registerCheckedModule(module.ast, module.semantic, result.diagnostics);
			}
		}
		return result;
	} catch (error) {
		invalidateModules(modules);
		throw error;
	}
}

/**
 * Start one cached experimental build and return the exact prior experimental
 * module/semantic bindings. Cached parsed or checked entries that cannot be
 * explained by these bindings must be rebuilt before they can become operation
 * evidence.
 */
function beginCachedBuild(cache: ProjectBuildCache): CheckedModuleMap | undefined {
	if (activeCaches.has(cache)) throw new Error('Concurrent experimental project builds cannot share one ProjectBuildCache');
	const current = currentModulesByCache.get(cache);
	if (!reusableModulesAreCurrent(current)) {
		invalidateModules(current);
		currentModulesByCache.delete(cache);
		cache.clear();
		throw new Error('Cannot reuse experimental project cache after its checked result was mutated');
	}
	activeCaches.add(cache);
	currentModulesByCache.delete(cache);
	invalidateModules(current);
	return current;
}

/** Experimental compiler entry point with ephemeral checked-AST session binding. */
export function compileSource(source: SourceFile, options: CompileOptions = {}): CompileResult {
	return registerCompileResult(compileSourceBase(source, options));
}

/** Experimental checker entry point with ephemeral checked-AST session binding. */
export function checkModule(module: A.ModuleNode, options: TypeCheckerOptions = {}): SemanticModel {
	if (activeCheckedModules.has(module)) throw new Error('Reentrant experimental checkModule calls for the same AST are not supported');
	activeCheckedModules.add(module);
	invalidateCheckedModule(module);
	try {
		const semantic = checkModuleBase(module, options);
		registerCheckedModule(module, semantic, semantic.diagnostics.items);
		return semantic;
	} finally {
		activeCheckedModules.delete(module);
	}
}

/** Experimental checker class that keeps direct class users on the same session boundary. */
export class TypeChecker extends BaseTypeChecker {
	#checking = false;

	public override check(module: A.ModuleNode): SemanticModel {
		if (this.#checking) throw new Error('Reentrant experimental TypeChecker checks are not supported');
		this.#checking = true;
		invalidateCheckedModule(module);
		try {
			const semantic = super.check(module);
			registerCheckedModule(module, semantic, semantic.diagnostics.items);
			return semantic;
		} finally {
			this.#checking = false;
		}
	}
}

export function buildProject(rootDirectory: string, options?: BuildProjectOptions): Promise<ProjectBuildResult>;
export function buildProject(rootDirectory: string, write?: boolean, additionalEntries?: readonly string[]): Promise<ProjectBuildResult>;
export async function buildProject(
	rootDirectory: string,
	optionsOrWrite?: BuildProjectOptions | boolean,
	legacyAdditionalEntries: readonly string[] = [],
): Promise<ProjectBuildResult> {
	const cache = typeof optionsOrWrite === 'object' && optionsOrWrite !== null ? optionsOrWrite.incrementalCache : undefined;
	const previousCheckedModules = cache === undefined ? undefined : beginCachedBuild(cache);
	try {
		const result = typeof optionsOrWrite === 'boolean'
			? await buildProjectBase(rootDirectory, optionsOrWrite, legacyAdditionalEntries)
			: await buildProjectBase(rootDirectory, optionsOrWrite);
		if (cache !== undefined) {
			const untrackedParsedReuse = result.stats.reusedParsedModules > trackedReusedParsedCount(result, previousCheckedModules);
			const untrackedCheckedReuse = result.stats.reusedCheckedModules > trackedReusedSemanticCount(result, previousCheckedModules);
			if (untrackedParsedReuse || untrackedCheckedReuse) {
				throw new Error('Cannot promote parsed or checked results from an unregistered project cache; retry after cache reset');
			}
		}
		registerProjectResult(result);
		if (cache !== undefined) {
			currentModulesByCache.set(cache, checkedModules(result));
			if (result.modules.some(module => module.semantic === undefined)) cache.clear();
		}
		return result;
	} catch (error) {
		if (cache !== undefined) {
			currentModulesByCache.delete(cache);
			cache.clear();
		}
		throw error;
	} finally {
		if (cache !== undefined) activeCaches.delete(cache);
	}
}

/** Stateful experimental project compiler that registers each returned checked module. */
export class IncrementalProjectBuilder extends BaseIncrementalProjectBuilder {
	readonly #currentModules = new Map<A.ModuleNode, SemanticModel>();
	#building = false;

	#invalidateCurrentModules(): void {
		invalidateModules(this.#currentModules);
		this.#currentModules.clear();
	}

	#assertReusableCurrentModules(): void {
		if (reusableModulesAreCurrent(this.#currentModules)) return;
		this.#invalidateCurrentModules();
		super.clear();
		throw new Error('Cannot reuse experimental incremental builder after its checked result was mutated');
	}

	public override async build(
		rootDirectory: string,
		options: Omit<BuildProjectOptions, 'incrementalCache'> = {},
	): Promise<ProjectBuildResult> {
		if (this.#building) throw new Error('Concurrent experimental builds cannot share one IncrementalProjectBuilder');
		this.#building = true;
		try {
			this.#assertReusableCurrentModules();
			this.#invalidateCurrentModules();
			const result = registerProjectResult(await super.build(rootDirectory, options));
			for (const [module, semantic] of checkedModules(result)) this.#currentModules.set(module, semantic);
			if (result.modules.some(module => module.semantic === undefined)) super.clear();
			return result;
		} catch (error) {
			this.#invalidateCurrentModules();
			super.clear();
			throw error;
		} finally {
			this.#building = false;
		}
	}

	public override invalidate(path?: string): void {
		this.#invalidateCurrentModules();
		super.invalidate(path);
	}

	public override clear(): void {
		this.#invalidateCurrentModules();
		super.clear();
	}
}
