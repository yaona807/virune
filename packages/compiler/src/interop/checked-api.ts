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
	type BuildProjectOptions,
	type ProjectBuildResult,
} from '../project/project.js';
import { IncrementalProjectBuilder as BaseIncrementalProjectBuilder } from '../project/incremental.js';
import type { SourceFile } from '../source.js';
import { registerExternalOperationSnapshot } from './operation-api.js';

function registerProjectResult(result: ProjectBuildResult): ProjectBuildResult {
	for (const module of result.modules) {
		if (module.ast !== undefined && module.semantic !== undefined) registerExternalOperationSnapshot(module.ast, module.semantic);
	}
	return result;
}

/** Experimental compiler entry point that attaches provider-independent operation evidence. */
export function compileSource(source: SourceFile, options: CompileOptions = {}): CompileResult {
	const result = compileSourceBase(source, options);
	if (result.ast !== undefined && result.semantic !== undefined) registerExternalOperationSnapshot(result.ast, result.semantic);
	return result;
}

/** Experimental checker entry point that attaches provider-independent operation evidence. */
export function checkModule(module: A.ModuleNode, options: TypeCheckerOptions = {}): SemanticModel {
	const semantic = checkModuleBase(module, options);
	registerExternalOperationSnapshot(module, semantic);
	return semantic;
}

/** Experimental checker class for callers that construct the checker directly. */
export class TypeChecker extends BaseTypeChecker {
	public override check(module: A.ModuleNode): SemanticModel {
		const semantic = super.check(module);
		registerExternalOperationSnapshot(module, semantic);
		return semantic;
	}
}

export function buildProject(rootDirectory: string, options?: BuildProjectOptions): Promise<ProjectBuildResult>;
export function buildProject(rootDirectory: string, write?: boolean, additionalEntries?: readonly string[]): Promise<ProjectBuildResult>;
export async function buildProject(
	rootDirectory: string,
	optionsOrWrite: BuildProjectOptions | boolean = true,
	legacyAdditionalEntries: readonly string[] = [],
): Promise<ProjectBuildResult> {
	const result = typeof optionsOrWrite === 'boolean'
		? await buildProjectBase(rootDirectory, optionsOrWrite, legacyAdditionalEntries)
		: await buildProjectBase(rootDirectory, optionsOrWrite);
	return registerProjectResult(result);
}

/** Stateful experimental project compiler; caching semantics remain owned by ProjectBuildCache. */
export class IncrementalProjectBuilder extends BaseIncrementalProjectBuilder {
	public override async build(
		rootDirectory: string,
		options: Omit<BuildProjectOptions, 'incrementalCache'> = {},
	): Promise<ProjectBuildResult> {
		return registerProjectResult(await super.build(rootDirectory, options));
	}
}
