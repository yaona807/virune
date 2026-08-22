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
	readonly semanticHasErrors: boolean;
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
			if (previousSeal.operationState !== currentSeal.operationState || previousSeal.semanticHasErrors !== currentSeal.semanticHasErrors) {
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
	const operationState = JSON.stringify(interop);
	if (operationState === undefined) throw new Error('Cannot seal checked operation evidence that is not serializable');
	return Object.freeze({
		operationState,
		semanticHasErrors: semantic.diagnostics.items.some(item => item.severity === 'error'),
	});
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

function beginCachedBuild(cache: ProjectBuildCache): void {
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
	if (cache !== undefined) beginCachedBuild(cache);
	try {
		const result = typeof optionsOrWrite === 'boolean'
			? await buildProjectBase(rootDirectory, optionsOrWrite, legacyAdditionalEntries)
			: await buildProjectBase(rootDirectory, optionsOrWrite);
		registerProjectResult(result);
		if (cache !== undefined) currentModulesByCache.set(cache, checkedModules(result));
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
