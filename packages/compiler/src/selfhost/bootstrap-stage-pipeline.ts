import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
	validateKernelInput,
	type KernelInputV1,
} from './contract.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from './bootstrap-execution-probe.js';
import {
	compilerFromSelfhostModule,
	type BootstrapStageExecutionResult,
} from './bootstrap-stage-executor.js';
import {
	executeBootstrapStagesWithArtifactLoader,
} from './bootstrap-stage-loader.js';
import type { BootstrapStageReadinessResult } from './bootstrap-stage-runner.js';
import { createKernelSourceManifest } from './source-manifest.js';

export interface ReadyBootstrapStagePipelineOptions {
	readonly temporaryRoot: string;
	readonly stage0EntryModulePath?: string;
}

export async function executeReadyBootstrapStages(
	readiness: BootstrapStageReadinessResult,
	inputValue: unknown,
	options: ReadyBootstrapStagePipelineOptions,
): Promise<BootstrapStageExecutionResult> {
	const input = validateKernelInput(inputValue);
	assertReadyEvidence(readiness, input);
	await mkdir(options.temporaryRoot, { recursive: true });
	const pipelineRoot = await mkdtemp(join(options.temporaryRoot, 'selfhost-stage-pipeline-'));
	try {
		const stage0Root = join(pipelineRoot, 'stage0');
		const stageRoot = join(pipelineRoot, 'stages');
		const stage0CandidateRoot = await materializeBootstrapCompilerCandidate(
			readiness.stage0Compiler,
			stage0Root,
		);
		try {
			const stage0Module = await loadBootstrapCompilerCandidate(
				stage0CandidateRoot,
				options.stage0EntryModulePath ?? 'dist/main.js',
			);
			return await executeBootstrapStagesWithArtifactLoader(
				compilerFromSelfhostModule(stage0Module),
				input,
				stageRoot,
			);
		} finally {
			await rm(stage0CandidateRoot, { recursive: true, force: true });
		}
	} finally {
		await rm(pipelineRoot, { recursive: true, force: true });
	}
}

function assertReadyEvidence(
	readiness: BootstrapStageReadinessResult,
	input: KernelInputV1,
): void {
	const evidence = readiness.evidence;
	if (
		!evidence.ready
		|| !evidence.capabilityReady
		|| evidence.blockers.length > 0
		|| evidence.capabilityBlockers.length > 0
	) {
		const blockers = [...new Set([
			...evidence.blockers,
			...evidence.capabilityBlockers,
		])].sort();
		throw new Error(
			`Stage 1/Stage 2 bootstrap is not ready (${blockers.join(', ') || 'unknown blocker'})`,
		);
	}
	if (evidence.compilerArtifactSha256 !== readiness.stage0Compiler.sha256) {
		throw new Error('Bootstrap readiness compiler artifact witness does not match Stage 0');
	}
	if (evidence.sourceManifestSha256 !== readiness.sourceManifest.sha256) {
		throw new Error('Bootstrap readiness source manifest witness does not match the manifest');
	}
	const actualManifest = createKernelSourceManifest(input);
	if (actualManifest.sha256 !== readiness.sourceManifest.sha256) {
		throw new Error('Bootstrap readiness source manifest does not match the requested input');
	}
	if (evidence.sourceCount !== input.sources.length) {
		throw new Error(
			`Bootstrap readiness source count mismatch: expected ${evidence.sourceCount}, received ${input.sources.length}`,
		);
	}
	if (evidence.entryPath !== input.entryPath) {
		throw new Error(
			`Bootstrap readiness entry path mismatch: expected ${evidence.entryPath}, received ${input.entryPath}`,
		);
	}
}
