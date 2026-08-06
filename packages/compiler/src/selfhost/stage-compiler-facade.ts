import {
	materializeBootstrapStageCompiler,
	type MaterializedBootstrapStageCompiler,
} from './bootstrap-stage-loader.js';
import type { BootstrapStageArtifact } from './bootstrap-stage-executor.js';
import {
	createInternalCompilerFacade,
	InternalCompilerFacadeError,
	type InternalCompilerFacade,
	type InternalCompilerFacadeDependencies,
	type InternalCompilerFacadeOptions,
	type InternalKernelCompiler,
} from './compiler-facade.js';
import {
	validateKernelOutput,
	type KernelDiagnosticV1,
	type KernelOutputV1,
} from './contract.js';
import type { ProjectCompilerResultV1 } from './project-compiler-adapter.js';

export interface StageCompilerFacadeDependencies {
	readonly legacyCompiler?: InternalKernelCompiler;
}

export interface MaterializedStageCompilerFacade extends InternalCompilerFacade {
	readonly artifactSha256: string;
	readonly candidateRoot: string;
	readonly dispose: () => Promise<void>;
}

/**
 * Materialize one verified Stage compiler artifact behind the internal compiler
 * facade. Legacy remains the immutable default; the Stage compiler runs only
 * through an explicit per-call `selection: "self-host"` option.
 *
 * The returned facade owns the candidate directory. Once disposed, every
 * compile call fails closed, including the Legacy path, so callers cannot keep
 * using a resource whose Self-host candidate has already been removed.
 */
export async function materializeStageCompilerFacade(
	artifact: BootstrapStageArtifact,
	temporaryRoot: string,
	dependencies: StageCompilerFacadeDependencies = {},
): Promise<MaterializedStageCompilerFacade> {
	const candidate = await materializeBootstrapStageCompiler(artifact, temporaryRoot);
	let disposed = false;
	const selfHostCompiler: InternalKernelCompiler = input => {
		assertActive(disposed);
		return projectCompilerResultToKernelOutput(candidate.compiler.compile(input));
	};
	const facadeDependencies: InternalCompilerFacadeDependencies = {
		...(dependencies.legacyCompiler === undefined ? {} : { legacyCompiler: dependencies.legacyCompiler }),
		selfHostCompiler,
	};
	const facade = createInternalCompilerFacade(facadeDependencies);
	return Object.freeze({
		version: facade.version,
		defaultSelection: facade.defaultSelection,
		selfHostAvailable: facade.selfHostAvailable,
		artifactSha256: artifact.sha256,
		candidateRoot: candidate.root,
		async compile(value: unknown, options?: InternalCompilerFacadeOptions): Promise<KernelOutputV1> {
			assertActive(disposed);
			return facade.compile(value, options);
		},
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			await candidate.dispose();
		},
	});
}

/** Convert the validated project-compiler result into the versioned Kernel output contract. */
export function projectCompilerResultToKernelOutput(
	result: ProjectCompilerResultV1,
): KernelOutputV1 {
	return validateKernelOutput({
		contractVersion: result.contractVersion,
		languageVersion: result.languageVersion,
		platform: result.platform,
		entryPath: result.entryPath,
		accepted: result.accepted,
		diagnostics: result.diagnostics.map(toKernelDiagnostic),
		emittedModules: result.emittedModules.map(module => ({
			sourcePath: module.sourcePath,
			outputPath: module.outputPath,
			code: module.code,
			sourceMap: module.sourceMap,
		})),
		dependencies: result.dependencies.map(dependency => ({
			modulePath: dependency.modulePath,
			sourceKind: dependency.sourceKind,
			specifier: dependency.specifier,
			...(dependency.resolvedPath === null ? {} : { resolvedPath: dependency.resolvedPath }),
			typeOnly: dependency.typeOnly,
			public: dependency.public,
		})),
		exportedSymbols: result.exportedSymbols.map(symbol => ({
			modulePath: symbol.modulePath,
			name: symbol.name,
			declarationKind: symbol.declarationKind,
		})),
		stats: {
			parsedModules: result.stats.parsedModules,
			reusedParsedModules: result.stats.reusedParsedModules,
			checkedModules: result.stats.checkedModules,
			reusedCheckedModules: result.stats.reusedCheckedModules,
			emittedModules: result.stats.emittedModules,
			reusedEmittedModules: result.stats.reusedEmittedModules,
			invalidatedModules: result.stats.invalidatedModules,
		},
	});
}

function toKernelDiagnostic(
	diagnostic: ProjectCompilerResultV1['diagnostics'][number],
): KernelDiagnosticV1 {
	return {
		code: diagnostic.code,
		severity: diagnostic.severity,
		message: diagnostic.message,
		...(diagnostic.sourcePath === null ? {} : { sourcePath: diagnostic.sourcePath }),
		span: {
			start: { ...diagnostic.span.start },
			end: { ...diagnostic.span.end },
		},
		...(diagnostic.notes.length === 0 ? {} : { help: diagnostic.notes.join('\n') }),
	};
}

function assertActive(disposed: boolean): void {
	if (disposed) {
		throw new InternalCompilerFacadeError(
			'facade',
			'materialized Stage compiler facade has been disposed',
		);
	}
}
