import { createHash } from 'node:crypto';
import type { KernelInputV1 } from './contract.js';
import type { SelfhostMvpModule } from './mvp-adapter.js';
import {
	compileWithProjectCompilerBoundary,
	type ProjectCompilerEmittedModuleV1,
	type ProjectCompilerResultV1,
} from './project-compiler-adapter.js';

export const BOOTSTRAP_STAGE_EXECUTOR_VERSION = 1 as const;

export interface BootstrapStageCompiler {
	readonly compile: (input: KernelInputV1) => ProjectCompilerResultV1;
}

export interface BootstrapStageModule {
	readonly sourcePath: string;
	readonly outputPath: string;
	readonly code: string;
	readonly sourceMap: string;
}

export interface BootstrapStageArtifact {
	readonly executorVersion: typeof BOOTSTRAP_STAGE_EXECUTOR_VERSION;
	readonly stage: 'stage1' | 'stage2';
	readonly entryPath: string;
	readonly modules: readonly BootstrapStageModule[];
	readonly serializedPayload: string;
	readonly sha256: string;
}

export interface BootstrapStageDifference {
	readonly outputPath: string;
	readonly stage1Sha256: string | null;
	readonly stage2Sha256: string | null;
}

export interface BootstrapStageExecutionResult {
	readonly stage1: BootstrapStageArtifact;
	readonly stage2: BootstrapStageArtifact;
	readonly equivalent: boolean;
	readonly differences: readonly BootstrapStageDifference[];
}

export type BootstrapStageLoader = (
	artifact: BootstrapStageArtifact,
) => Promise<BootstrapStageCompiler>;

export function compilerFromSelfhostModule(module: SelfhostMvpModule): BootstrapStageCompiler {
	return {
		compile: input => compileWithProjectCompilerBoundary(module, input),
	};
}

export async function executeBootstrapStages(
	stage0: BootstrapStageCompiler,
	input: KernelInputV1,
	loadStage1: BootstrapStageLoader,
): Promise<BootstrapStageExecutionResult> {
	const stage1Result = requireAccepted(stage0.compile(input), 'Stage 1');
	const stage1 = stageArtifact('stage1', stage1Result);
	const stage1Compiler = await loadStage1(stage1);
	const stage2Result = requireAccepted(stage1Compiler.compile(input), 'Stage 2');
	const stage2 = stageArtifact('stage2', stage2Result);
	const differences = compareStageModules(stage1.modules, stage2.modules);
	return {
		stage1,
		stage2,
		equivalent: stage1.sha256 === stage2.sha256 && differences.length === 0,
		differences,
	};
}

export function stageArtifact(
	stage: BootstrapStageArtifact['stage'],
	result: ProjectCompilerResultV1,
): BootstrapStageArtifact {
	const accepted = requireAccepted(result, stage === 'stage1' ? 'Stage 1' : 'Stage 2');
	const modules = accepted.emittedModules.map(normalizeModule);
	const payload = {
		entryPath: accepted.entryPath,
		modules,
	};
	const serializedPayload = JSON.stringify(payload);
	return {
		executorVersion: BOOTSTRAP_STAGE_EXECUTOR_VERSION,
		stage,
		entryPath: accepted.entryPath,
		modules,
		serializedPayload,
		sha256: sha256(serializedPayload),
	};
}

export function compareStageModules(
	stage1: readonly BootstrapStageModule[],
	stage2: readonly BootstrapStageModule[],
): readonly BootstrapStageDifference[] {
	const left = new Map(stage1.map(module => [module.outputPath, module] as const));
	const right = new Map(stage2.map(module => [module.outputPath, module] as const));
	const outputPaths = [...new Set([...left.keys(), ...right.keys()])].sort();
	const differences: BootstrapStageDifference[] = [];
	for (const outputPath of outputPaths) {
		const leftModule = left.get(outputPath);
		const rightModule = right.get(outputPath);
		const stage1Sha256 = leftModule === undefined ? null : sha256(JSON.stringify(leftModule));
		const stage2Sha256 = rightModule === undefined ? null : sha256(JSON.stringify(rightModule));
		if (stage1Sha256 !== stage2Sha256) {
			differences.push({ outputPath, stage1Sha256, stage2Sha256 });
		}
	}
	return differences;
}

function requireAccepted(
	result: ProjectCompilerResultV1,
	label: string,
): ProjectCompilerResultV1 {
	if (!result.accepted) {
		const codes = result.diagnostics.map(diagnostic => diagnostic.code).join(', ') || 'none';
		throw new Error(`${label} project compilation was rejected (${codes})`);
	}
	if (result.emittedModules.length === 0) {
		throw new Error(`${label} project compilation emitted no modules`);
	}
	return result;
}

function normalizeModule(module: ProjectCompilerEmittedModuleV1): BootstrapStageModule {
	return {
		sourcePath: module.sourcePath,
		outputPath: module.outputPath,
		code: normalizeText(module.code),
		sourceMap: normalizeText(module.sourceMap),
	};
}

function normalizeText(value: string): string {
	return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
