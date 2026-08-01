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
	type JsonValue,
	type KernelInputV1,
	type KernelOutputV1,
} from './contract.js';
import {
	BOOTSTRAP_ARTIFACT_POLICY_VERSION,
	normalizeBootstrapArtifact,
	type NormalizedBootstrapArtifactResult,
} from './bootstrap-artifact-normalizer.js';
import { snapshotProjectBuild } from './bootstrap-artifact-snapshot.js';
import {
	createBootstrapShadowReport,
	type BootstrapShadowReportResult,
} from './bootstrap-shadow-report.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from './bootstrap-execution-probe.js';
import { compileWithSelfhostMvp } from './mvp-adapter.js';
import {
	createKernelSourceManifest,
	type KernelSourceManifestResultV1,
} from './source-manifest.js';

export const BOOTSTRAP_STAGE_GENERATION_EVIDENCE_VERSION = 1 as const;

export interface SelfhostStageBootstrapOptions {
	readonly temporaryRoot: string;
	readonly compilerVersion: string;
	readonly runtimeAbi: string;
	readonly interopAbi: string;
	readonly seedSha256?: string;
	readonly stage0EntryModulePath?: string;
}

export interface BootstrapStageGenerationEvidence {
	readonly policyVersion: typeof BOOTSTRAP_STAGE_GENERATION_EVIDENCE_VERSION;
	readonly claim: 'selfhost-compiler-stage-generation';
	readonly productionEligible: false;
	readonly stage: 'stage1' | 'stage2';
	readonly compilerArtifactSha256: string;
	readonly sourceManifestSha256: string;
	readonly outputArtifactSha256: string;
	readonly entryModulePath: string;
}

export interface BootstrapGeneratedStage {
	readonly artifact: NormalizedBootstrapArtifactResult;
	readonly evidence: BootstrapStageGenerationEvidence;
	readonly serializedEvidence: string;
	readonly evidenceSha256: string;
}

export interface SelfhostStageBootstrapResult {
	readonly stage0Compiler: NormalizedBootstrapArtifactResult;
	readonly sourceManifest: KernelSourceManifestResultV1;
	readonly stage1: BootstrapGeneratedStage;
	readonly stage2: BootstrapGeneratedStage;
	readonly shadowReport: BootstrapShadowReportResult;
}

export class BootstrapStageMismatchError extends Error {
	public override readonly name = 'BootstrapStageMismatchError';
	public constructor(public readonly shadowReport: BootstrapShadowReportResult) {
		super(`Stage 1／Stage 2 bootstrap mismatch: ${shadowReport.report.unexpectedChanges.length} unexpected change(s)`);
	}
}

const diagnosticsSchema: JsonValue = {
	type: 'object',
	required: ['code', 'severity', 'message', 'span'],
	properties: {
		code: { type: 'string' },
		severity: { enum: ['error', 'warning', 'information', 'hint'] },
		message: { type: 'string' },
		span: { type: 'object', required: ['start', 'end'] },
	},
};

/**
 * Generate the current MVP compiler twice through the executable self-host
 * boundary. Stage 1 is produced by the Stage 0 artifact; Stage 2 is produced by
 * loading Stage 1. The normalized artifacts may differ only by metadata.stage.
 */
export async function runSelfhostStageBootstrap(
	projectRoot: string,
	options: SelfhostStageBootstrapOptions,
): Promise<SelfhostStageBootstrapResult> {
	const build = await buildProject(projectRoot, { write: false });
	const input = kernelInputFromBuild(build);
	const sourceManifest = createKernelSourceManifest(input);
	const stage0Compiler = snapshotProjectBuild(build, {
		stage: 'stage0',
		compilerVersion: options.compilerVersion,
		runtimeAbi: options.runtimeAbi,
		interopAbi: options.interopAbi,
		...(options.seedSha256 === undefined ? {} : { seedSha256: options.seedSha256 }),
	});

	const stage1 = await generateStage(
		stage0Compiler,
		options.stage0EntryModulePath ?? 'dist/main.js',
		input,
		'stage1',
		sourceManifest.sha256,
		options,
	);
	const stage1Entry = compilerEntryModulePath(stage1.artifact);
	const stage2 = await generateStage(
		stage1.artifact,
		stage1Entry,
		input,
		'stage2',
		sourceManifest.sha256,
		options,
	);
	const shadowReport = createBootstrapShadowReport({
		baseline: {
			label: 'stage1',
			stage: 'stage1',
			compilerVersion: options.compilerVersion,
			artifact: stage1.artifact,
		},
		candidate: {
			label: 'stage2',
			stage: 'stage2',
			compilerVersion: options.compilerVersion,
			artifact: stage2.artifact,
		},
	});
	if (shadowReport.report.status !== 'equivalent') throw new BootstrapStageMismatchError(shadowReport);
	return { stage0Compiler, sourceManifest, stage1, stage2, shadowReport };
}

export function snapshotKernelOutputAsBootstrapArtifact(
	output: KernelOutputV1,
	stage: 'stage1' | 'stage2',
	sourceManifestSha256: string,
	options: Pick<SelfhostStageBootstrapOptions, 'compilerVersion' | 'runtimeAbi' | 'interopAbi' | 'seedSha256'>,
): NormalizedBootstrapArtifactResult {
	assertSuccessfulCompilerOutput(output, stage);
	assertSha256(sourceManifestSha256, 'sourceManifestSha256');
	const modules = output.emittedModules.map(module => {
		if (module.sourceMap !== '') throw new Error(`${stage} emitted an unexpected source map for ${module.outputPath}`);
		return {
			path: module.outputPath,
			code: module.code,
			sourceMap: '',
			exports: output.exportedSymbols
				.filter(symbol => symbol.modulePath === module.sourcePath)
				.map(symbol => symbol.name),
		};
	});
	return normalizeBootstrapArtifact({
		policyVersion: BOOTSTRAP_ARTIFACT_POLICY_VERSION,
		root: '.selfhost-output',
		modules,
		diagnosticsSchema,
		metadata: {
			stage,
			compilerVersion: options.compilerVersion,
			languageVersion: output.languageVersion,
			platform: output.platform,
			target: 'es2022',
			runtimeAbi: options.runtimeAbi,
			interopAbi: options.interopAbi,
			sourceMap: false,
			sourcesContent: true,
			sourceManifestSha256,
			...(options.seedSha256 === undefined ? {} : { seedSha256: options.seedSha256.toLowerCase() }),
		},
		checksumManifest: modules.map(module => ({
			path: module.path,
			sha256: sha256(module.code),
		})),
	});
}

function kernelInputFromBuild(build: ProjectBuildResult): KernelInputV1 {
	if (build.config.platform !== 'node') throw new Error('Self-host MVP bootstrap requires the node platform');
	const sources = build.modules.map(module => ({
		path: normalizeKernelPath(relative(build.root, module.source.path).replaceAll('\\', '/')),
		text: module.source.text,
	}));
	if (sources.length !== 1) {
		throw new Error(`Self-host MVP bootstrap requires exactly one source module, received ${sources.length}`);
	}
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

async function generateStage(
	compilerArtifact: NormalizedBootstrapArtifactResult,
	compilerEntryModulePath: string,
	input: KernelInputV1,
	stage: 'stage1' | 'stage2',
	sourceManifestSha256: string,
	options: SelfhostStageBootstrapOptions,
): Promise<BootstrapGeneratedStage> {
	const temporaryDirectory = await materializeBootstrapCompilerCandidate(compilerArtifact, options.temporaryRoot);
	try {
		const compiler = await loadBootstrapCompilerCandidate(temporaryDirectory, compilerEntryModulePath);
		const output = await compileWithSelfhostMvp(compiler, input);
		const artifact = snapshotKernelOutputAsBootstrapArtifact(output, stage, sourceManifestSha256, options);
		const entryModulePath = compilerEntryModulePathForOutput(artifact);
		const evidence: BootstrapStageGenerationEvidence = {
			policyVersion: BOOTSTRAP_STAGE_GENERATION_EVIDENCE_VERSION,
			claim: 'selfhost-compiler-stage-generation',
			productionEligible: false,
			stage,
			compilerArtifactSha256: compilerArtifact.sha256,
			sourceManifestSha256,
			outputArtifactSha256: artifact.sha256,
			entryModulePath,
		};
		const serializedEvidence = JSON.stringify(evidence);
		return {
			artifact,
			evidence,
			serializedEvidence,
			evidenceSha256: sha256(serializedEvidence),
		};
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

function assertSuccessfulCompilerOutput(output: KernelOutputV1, stage: string): void {
	const errors = output.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
	if (!output.accepted || errors.length > 0) {
		throw new Error(`${stage} compiler generation failed with ${errors.length} error diagnostic(s)`);
	}
	if (output.emittedModules.length !== 1) {
		throw new Error(`${stage} compiler generation must emit exactly one module, received ${output.emittedModules.length}`);
	}
}

function compilerEntryModulePath(artifact: NormalizedBootstrapArtifactResult): string {
	return compilerEntryModulePathForOutput(artifact);
}

function compilerEntryModulePathForOutput(artifact: NormalizedBootstrapArtifactResult): string {
	const entries = artifact.artifact.modules.filter(module => module.exports.includes('compileMvp'));
	if (entries.length !== 1) {
		throw new Error(`Bootstrap compiler artifact must contain exactly one compileMvp entry module, received ${entries.length}`);
	}
	return entries[0]!.path;
}

function assertSha256(value: string, name: string): void {
	if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${name} must be a lowercase SHA-256 value`);
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
