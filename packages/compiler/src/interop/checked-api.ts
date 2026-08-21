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
import {
	buildProject as buildProjectBase,
	ProjectBuildCache,
	type BuildProjectOptions,
	type ProjectBuildResult,
} from '../project/project.js';
import { IncrementalProjectBuilder as BaseIncrementalProjectBuilder } from '../project/incremental.js';
import type { SourceFile } from '../source.js';
import { invalidateCheckedSemantic, registerCheckedSemantic } from './check-session.js';

const currentModulesByCache = new WeakMap<ProjectBuildCache, ReadonlySet<A.ModuleNode>>();
const activeCaches = new WeakSet<ProjectBuildCache>();

function checkedModules(result: ProjectBuildResult): ReadonlySet<A.ModuleNode> {
	const modules = new Set<A.ModuleNode>();
	for (const module of result.modules) {
		if (module.ast !== undefined && module.semantic !== undefined) modules.add(module.ast);
	}
	return modules;
}

function invalidateModules(modules: ReadonlySet<A.ModuleNode> | undefined): void {
	if (modules === undefined) return;
	for (const module of modules) invalidateCheckedSemantic(module);
}

function registerCompileResult(result: CompileResult): CompileResult {
	if (result.ast !== undefined && result.semantic !== undefined) registerCheckedSemantic(result.ast, result.semantic);
	return result;
}

function registerProjectResult(result: ProjectBuildResult): ProjectBuildResult {
	for (const module of result.modules) {
		if (module.ast !== undefined && module.semantic !== undefined) registerCheckedSemantic(module.ast, module.semantic);
	}
	return result;
}

function beginCachedBuild(cache: ProjectBuildCache): void {
	if (activeCaches.has(cache)) throw new Error('Concurrent experimental project builds cannot share one ProjectBuildCache');
	activeCaches.add(cache);
	invalidateModules(currentModulesByCache.get(cache));
}

/** Experimental compiler entry point with ephemeral checked-AST session binding. */
export function compileSource(source: SourceFile, options: CompileOptions = {}): CompileResult {
	return registerCompileResult(compileSourceBase(source, options));
}

/** Experimental checker entry point with ephemeral checked-AST session binding. */
export function checkModule(module: A.ModuleNode, options: TypeCheckerOptions = {}): SemanticModel {
	invalidateCheckedSemantic(module);
	const semantic = checkModuleBase(module, options);
	registerCheckedSemantic(module, semantic);
	return semantic;
}

/** Experimental checker class that keeps direct class users on the same session boundary. */
export class TypeChecker extends BaseTypeChecker {
	public override check(module: A.ModuleNode): SemanticModel {
		invalidateCheckedSemantic(module);
		const semantic = super.check(module);
		registerCheckedSemantic(module, semantic);
		return semantic;
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
	} finally {
		if (cache !== undefined) activeCaches.delete(cache);
	}
}

/** Stateful experimental project compiler that registers each returned checked module. */
export class IncrementalProjectBuilder extends BaseIncrementalProjectBuilder {
	readonly #currentModules = new Set<A.ModuleNode>();
	#building = false;

	public override async build(
		rootDirectory: string,
		options: Omit<BuildProjectOptions, 'incrementalCache'> = {},
	): Promise<ProjectBuildResult> {
		if (this.#building) throw new Error('Concurrent experimental builds cannot share one IncrementalProjectBuilder');
		this.#building = true;
		invalidateModules(this.#currentModules);
		try {
			const result = registerProjectResult(await super.build(rootDirectory, options));
			this.#currentModules.clear();
			for (const module of checkedModules(result)) this.#currentModules.add(module);
			return result;
		} finally {
			this.#building = false;
		}
	}
}
