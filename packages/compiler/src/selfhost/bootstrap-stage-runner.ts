import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { relative } from 'node:path';
import { buildProject, type ProjectBuildResult } from '../project/project.js';
import {
	KERNEL_CONTRACT_VERSION,
	KERNEL_INTEROP_MANIFEST_VERSION,
	KERNEL_LANGUAGE_VERSION,
	normalizeKernelPath,
	validateKernelInput,
	type KernelInputV1,
} from './contract.js';
import {
	snapshotProjectBuild,
	type BootstrapArtifactSnapshotOptions,
} from './bootstrap-artifact-snapshot.js';
import type { NormalizedBootstrapArtifactResult } from './bootstrap-artifact-normalizer.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from './bootstrap-execution-probe.js';
import type { SelfhostMvpModule, ViruneResultValue } from './mvp-adapter.js';
import {
	createKernelSourceManifest,
	type KernelSourceManifestResultV1,
} from './source-manifest.js';

export const BOOTSTRAP_STAGE_READINESS_POLICY_VERSION = 1 as const;

export interface SelfhostProjectCompilerModule extends SelfhostMvpModule {
	readonly compileProjectMvp: (request: string) => ViruneResultValue<string>;
}

export type BootstrapStageReadinessBlocker =
	| 'multi-module-project-requires-project-compiler'
	| 'project-compiler-export-missing';

export interface BootstrapStageReadinessOptions
	extends Omit<BootstrapArtifactSnapshotOptions, 'stage'> {
	readonly temporaryRoot: string;
	readonly stage0EntryModulePath?: string;
}

export interface BootstrapStageReadinessEvidence {
	readonly policyVersion: typeof BOOTSTRAP_STAGE_READINESS_POLICY_VERSION;
	readonly claim: 'stage1-stage2-bootstrap-readiness';
	readonly productionEligible: false;
	readonly ready: boolean;
	readonly compilerArtifactSha256: string;
	readonly sourceManifestSha256: string;
	readonly sourceCount: number;
	readonly entryPath: string;
	readonly requiredExport: 'compileProjectMvp';
	readonly blockers: readonly BootstrapStageReadinessBlocker[];
}

export interface BootstrapStageReadinessResult {
	readonly stage0Compiler: NormalizedBootstrapArtifactResult;
	readonly sourceManifest: KernelSourceManifestResultV1;
	readonly evidence: BootstrapStageReadinessEvidence;
	readonly serialized: string;
	readonly sha256: string;
}

/**
 * Evaluate the last honest precondition before Stage 1／Stage 2 generation.
 *
 * The existing Self-host MVP exports compileMvp(source), whose Host adapter is
 * intentionally single-source. The compiler project itself is multi-module.
 * Therefore Stage 1 must not be claimed until the generated candidate exports a
 * project compiler boundary that consumes the complete canonical source set.
 */
export async function evaluateSelfhostStageBootstrapReadiness(
	projectRoot: string,
	options: BootstrapStageReadinessOptions,
): Promise<BootstrapStageReadinessResult> {
	const build = await buildProject(projectRoot, { write: false });
	const input = kernelInputFromBuild(build);
	const sourceManifest = createKernelSourceManifest(input);
	const stage0Compiler = snapshotProjectBuild(build, {
		...options,
		stage: 'stage0',
	});
	const temporaryDirectory = await materializeBootstrapCompilerCandidate(
		stage0Compiler,
		options.temporaryRoot,
	);
	try {
		const module = await loadBootstrapCompilerCandidate(
			temporaryDirectory,
			options.stage0EntryModulePath ?? 'dist/main.js',
		);
		const blockers = readinessBlockers(module, input.sources.length);
		const evidence: BootstrapStageReadinessEvidence = {
			policyVersion: BOOTSTRAP_STAGE_READINESS_POLICY_VERSION,
			claim: 'stage1-stage2-bootstrap-readiness',
			productionEligible: false,
			ready: blockers.length === 0,
			compilerArtifactSha256: stage0Compiler.sha256,
			sourceManifestSha256: sourceManifest.sha256,
			sourceCount: input.sources.length,
			entryPath: input.entryPath,
			requiredExport: 'compileProjectMvp',
			blockers,
		};
		const serialized = JSON.stringify(evidence);
		return {
			stage0Compiler,
			sourceManifest,
			evidence,
			serialized,
			sha256: sha256(serialized),
		};
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

export function hasSelfhostProjectCompiler(
	module: SelfhostMvpModule,
): module is SelfhostProjectCompilerModule {
	return typeof (module as { readonly compileProjectMvp?: unknown }).compileProjectMvp === 'function';
}

export function readinessBlockers(
	module: SelfhostMvpModule,
	sourceCount: number,
): readonly BootstrapStageReadinessBlocker[] {
	if (!Number.isSafeInteger(sourceCount) || sourceCount <= 0) {
		throw new Error('sourceCount must be a positive safe integer');
	}
	const projectCompilerAvailable = hasSelfhostProjectCompiler(module);
	const blockers = new Set<BootstrapStageReadinessBlocker>();
	if (sourceCount > 1 && !projectCompilerAvailable) {
		blockers.add('multi-module-project-requires-project-compiler');
	}
	if (!projectCompilerAvailable) blockers.add('project-compiler-export-missing');
	return [...blockers].sort();
}

export function kernelInputFromProjectBuild(build: ProjectBuildResult): KernelInputV1 {
	if (build.config.platform !== 'node') throw new Error('Self-host bootstrap requires the node platform');
	const errors = build.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
	if (errors.length > 0) {
		throw new Error(`Self-host project build failed with ${errors.length} error diagnostic(s)`);
	}
	const sources = build.modules.map(module => ({
		path: normalizeKernelPath(relative(build.root, module.source.path).replaceAll('\\', '/')),
		text: module.source.text,
	}));
	return validateKernelInput({
		contractVersion: KERNEL_CONTRACT_VERSION,
		languageVersion: KERNEL_LANGUAGE_VERSION,
		platform: 'node',
		entryPath: normalizeKernelPath(build.config.entry),
		sources,
		interopManifest: { version: KERNEL_INTEROP_MANIFEST_VERSION, modules: [] },
		emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
	});
}

function kernelInputFromBuild(build: ProjectBuildResult): KernelInputV1 {
	return kernelInputFromProjectBuild(build);
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
