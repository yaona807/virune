import { createHash } from 'node:crypto';
import type { KernelInputV1 } from './contract.js';
import type { SelfhostMvpModule } from './mvp-adapter.js';
import {
	PROJECT_COMPILER_RESULT_SCHEMA,
	compileWithProjectCompilerBoundary,
	type ProjectCompilerDependencyV1,
	type ProjectCompilerEmittedModuleV1,
	type ProjectCompilerExportedSymbolV1,
	type ProjectCompilerResultV1,
} from './project-compiler-adapter.js';

export const BOOTSTRAP_STAGE_EXECUTOR_VERSION = 3 as const;
export const BOOTSTRAP_STAGE_DIAGNOSTIC_SCHEMA = `${PROJECT_COMPILER_RESULT_SCHEMA}#diagnostics` as const;

export interface BootstrapStageCompiler {
	readonly compile: (input: KernelInputV1) => ProjectCompilerResultV1;
}

export interface BootstrapStageMetadata {
	readonly contractVersion: ProjectCompilerResultV1['contractVersion'];
	readonly languageVersion: ProjectCompilerResultV1['languageVersion'];
	readonly platform: ProjectCompilerResultV1['platform'];
	readonly accepted: true;
	readonly resultSchema: typeof PROJECT_COMPILER_RESULT_SCHEMA;
	readonly diagnosticSchema: typeof BOOTSTRAP_STAGE_DIAGNOSTIC_SCHEMA;
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
	readonly metadata: BootstrapStageMetadata;
	readonly entryPath: string;
	readonly modules: readonly BootstrapStageModule[];
	readonly dependencies: readonly ProjectCompilerDependencyV1[];
	readonly exportedSymbols: readonly ProjectCompilerExportedSymbolV1[];
	readonly serializedPayload: string;
	readonly sha256: string;
}

export interface BootstrapStageDifference {
	readonly section: 'metadata' | 'module' | 'dependency' | 'exported-symbol';
	readonly path: string;
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
	const differences = compareStageArtifacts(stage1, stage2);
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
	const metadata: BootstrapStageMetadata = {
		contractVersion: accepted.contractVersion,
		languageVersion: accepted.languageVersion,
		platform: accepted.platform,
		accepted: true,
		resultSchema: PROJECT_COMPILER_RESULT_SCHEMA,
		diagnosticSchema: BOOTSTRAP_STAGE_DIAGNOSTIC_SCHEMA,
	};
	const modules = accepted.emittedModules
		.map(normalizeModule)
		.sort((left, right) => compareText(left.outputPath, right.outputPath)
			|| compareText(left.sourcePath, right.sourcePath));
	assertUnique(modules, module => module.outputPath, 'emitted module outputPath');
	const dependencies = [...accepted.dependencies]
		.sort((left, right) => compareText(dependencyKey(left), dependencyKey(right)));
	assertUnique(dependencies, dependencyKey, 'dependency metadata');
	const exportedSymbols = [...accepted.exportedSymbols]
		.sort((left, right) => compareText(exportedSymbolKey(left), exportedSymbolKey(right)));
	assertUnique(exportedSymbols, exportedSymbolKey, 'export metadata');
	const payload = {
		metadata,
		entryPath: accepted.entryPath,
		modules,
		dependencies,
		exportedSymbols,
	};
	const serializedPayload = JSON.stringify(payload);
	return {
		executorVersion: BOOTSTRAP_STAGE_EXECUTOR_VERSION,
		stage,
		metadata,
		entryPath: accepted.entryPath,
		modules,
		dependencies,
		exportedSymbols,
		serializedPayload,
		sha256: sha256(serializedPayload),
	};
}

export function compareStageArtifacts(
	stage1: BootstrapStageArtifact,
	stage2: BootstrapStageArtifact,
): readonly BootstrapStageDifference[] {
	return [
		...compareStageMetadata(stage1.metadata, stage2.metadata),
		...compareSingleton('metadata', 'entryPath', stage1.entryPath, stage2.entryPath),
		...compareStageModules(stage1.modules, stage2.modules),
		...compareCollections(
			'dependency',
			stage1.dependencies,
			stage2.dependencies,
			dependencyKey,
		),
		...compareCollections(
			'exported-symbol',
			stage1.exportedSymbols,
			stage2.exportedSymbols,
			exportedSymbolKey,
		),
	].sort(compareDifference);
}

export function compareStageMetadata(
	stage1: BootstrapStageMetadata,
	stage2: BootstrapStageMetadata,
): readonly BootstrapStageDifference[] {
	return [
		...compareSingleton('metadata', 'accepted', stage1.accepted, stage2.accepted),
		...compareSingleton('metadata', 'contractVersion', stage1.contractVersion, stage2.contractVersion),
		...compareSingleton('metadata', 'diagnosticSchema', stage1.diagnosticSchema, stage2.diagnosticSchema),
		...compareSingleton('metadata', 'languageVersion', stage1.languageVersion, stage2.languageVersion),
		...compareSingleton('metadata', 'platform', stage1.platform, stage2.platform),
		...compareSingleton('metadata', 'resultSchema', stage1.resultSchema, stage2.resultSchema),
	];
}

export function compareStageModules(
	stage1: readonly BootstrapStageModule[],
	stage2: readonly BootstrapStageModule[],
): readonly BootstrapStageDifference[] {
	return compareCollections('module', stage1, stage2, module => module.outputPath);
}

function compareCollections<T>(
	section: BootstrapStageDifference['section'],
	stage1: readonly T[],
	stage2: readonly T[],
	key: (value: T) => string,
): readonly BootstrapStageDifference[] {
	const left = new Map(stage1.map(value => [key(value), value] as const));
	const right = new Map(stage2.map(value => [key(value), value] as const));
	const paths = [...new Set([...left.keys(), ...right.keys()])].sort(compareText);
	const differences: BootstrapStageDifference[] = [];
	for (const path of paths) {
		const leftValue = left.get(path);
		const rightValue = right.get(path);
		const stage1Sha256 = leftValue === undefined ? null : sha256(JSON.stringify(leftValue));
		const stage2Sha256 = rightValue === undefined ? null : sha256(JSON.stringify(rightValue));
		if (stage1Sha256 !== stage2Sha256) {
			differences.push({ section, path, stage1Sha256, stage2Sha256 });
		}
	}
	return differences;
}

function compareSingleton(
	section: BootstrapStageDifference['section'],
	path: string,
	stage1: unknown,
	stage2: unknown,
): readonly BootstrapStageDifference[] {
	const stage1Sha256 = sha256(JSON.stringify(stage1));
	const stage2Sha256 = sha256(JSON.stringify(stage2));
	return stage1Sha256 === stage2Sha256
		? []
		: [{ section, path, stage1Sha256, stage2Sha256 }];
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

function dependencyKey(value: ProjectCompilerDependencyV1): string {
	return [
		value.modulePath,
		value.sourceKind,
		value.specifier,
		value.resolvedPath ?? '',
		value.typeOnly ? '1' : '0',
		value.public ? '1' : '0',
	].join('\0');
}

function exportedSymbolKey(value: ProjectCompilerExportedSymbolV1): string {
	return [value.modulePath, value.name, value.declarationKind].join('\0');
}

function assertUnique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
	const keys = values.map(key);
	if (new Set(keys).size !== keys.length) throw new Error(`Bootstrap stage ${label} values must be unique`);
}

function compareDifference(left: BootstrapStageDifference, right: BootstrapStageDifference): number {
	return compareText(left.section, right.section) || compareText(left.path, right.path);
}

function normalizeText(value: string): string {
	return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
