import {
	KERNEL_CONTRACT_VERSION,
	KERNEL_LANGUAGE_VERSION,
	validateKernelInput,
	validateKernelOutput,
	type KernelDiagnosticV1,
	type KernelInputV1,
	type KernelOutputV1,
} from './contract.js';
import type { DifferentialKernelV1 } from './differential-harness.js';
import type { SelfhostMvpModule } from './mvp-adapter.js';
import {
	compileWithProjectCompilerBoundary,
	type ProjectCompilerResultV1,
} from './project-compiler-adapter.js';

/**
 * Adapt the integrated Self-host Project Compiler boundary to the existing
 * versioned differential harness. The project boundary currently carries one
 * project-only diagnostic field (`notes`) that has no Kernel v1 equivalent;
 * this adapter deliberately compares the shared compiler/runtime contract and
 * leaves project-only metadata to its dedicated contract tests.
 */
export function createSelfhostProjectKernel(module: SelfhostMvpModule): DifferentialKernelV1 {
	return {
		name: 'selfhost-project',
		compile: input => compileWithSelfhostProject(module, input),
	};
}

export async function compileWithSelfhostProject(
	module: SelfhostMvpModule,
	value: unknown,
): Promise<KernelOutputV1> {
	const input = validateProjectDifferentialInput(value);
	return projectCompilerResultToKernelOutput(compileWithProjectCompilerBoundary(module, input));
}

export function projectCompilerResultToKernelOutput(result: ProjectCompilerResultV1): KernelOutputV1 {
	return validateKernelOutput({
		contractVersion: KERNEL_CONTRACT_VERSION,
		languageVersion: KERNEL_LANGUAGE_VERSION,
		platform: result.platform,
		entryPath: result.entryPath,
		accepted: result.accepted,
		diagnostics: result.diagnostics.map(toKernelDiagnostic),
		emittedModules: result.emittedModules.map(module => ({ ...module })),
		dependencies: result.dependencies.map(dependency => ({
			modulePath: dependency.modulePath,
			sourceKind: dependency.sourceKind,
			specifier: dependency.specifier,
			...(dependency.resolvedPath === null ? {} : { resolvedPath: dependency.resolvedPath }),
			typeOnly: dependency.typeOnly,
			public: dependency.public,
		})),
		exportedSymbols: result.exportedSymbols.map(symbol => ({ ...symbol })),
		stats: { ...result.stats },
	});
}

function validateProjectDifferentialInput(value: unknown): KernelInputV1 {
	const input = validateKernelInput(value);
	if (input.platform !== 'node') throw new Error('Project differential currently requires the node platform');
	if (input.interopManifest.modules.length !== 0) {
		throw new Error('Project differential v1 does not compare JavaScript interop yet');
	}
	return input;
}

function toKernelDiagnostic(
	diagnostic: ProjectCompilerResultV1['diagnostics'][number],
): KernelDiagnosticV1 {
	return {
		code: diagnostic.code,
		severity: diagnostic.severity,
		message: diagnostic.message,
		...(diagnostic.sourcePath === null ? {} : { sourcePath: diagnostic.sourcePath }),
		span: diagnostic.span,
	};
}
