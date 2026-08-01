import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildProject, type ProjectBuildResult } from '../project/project.js';
import {
	normalizeKernelPath,
	validateKernelInput,
	type JsonValue,
	type KernelInputV1,
	type KernelOutputV1,
} from './contract.js';
import {
	snapshotProjectBuild,
	type BootstrapArtifactSnapshotOptions,
} from './bootstrap-artifact-snapshot.js';
import type { NormalizedBootstrapArtifactResult } from './bootstrap-artifact-normalizer.js';
import {
	compileWithSelfhostMvp,
	type SelfhostMvpModule,
} from './mvp-adapter.js';

export const BOOTSTRAP_EXECUTION_PROBE_VERSION = 1 as const;

export interface BootstrapExecutionProbeOptions
	extends Omit<BootstrapArtifactSnapshotOptions, 'stage'> {
	readonly temporaryRoot: string;
	readonly entryModulePath?: string;
}

export interface BootstrapExecutionProbeArtifact {
	readonly policyVersion: typeof BOOTSTRAP_EXECUTION_PROBE_VERSION;
	readonly claim: 'stage0-compiler-execution-probe';
	readonly productionEligible: false;
	readonly compilerArtifactSha256: string;
	readonly inputSha256: string;
	readonly outputSha256: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly emittedModulePaths: readonly string[];
}

export interface BootstrapExecutionProbeResult {
	readonly compilerArtifact: NormalizedBootstrapArtifactResult;
	readonly output: KernelOutputV1;
	readonly artifact: BootstrapExecutionProbeArtifact;
	readonly serialized: string;
	readonly sha256: string;
}

/**
 * Build the current Self-host MVP with Stage 0, load the emitted compiler as an
 * executable candidate, and compile one canonical Kernel Contract input.
 *
 * This is deliberately an execution probe. It does not claim that the emitted
 * compiler rebuilt its own multi-module source tree, produced Stage 1／2, or is
 * eligible for production promotion.
 */
export async function runBootstrapExecutionProbe(
	projectRoot: string,
	value: unknown,
	options: BootstrapExecutionProbeOptions,
): Promise<BootstrapExecutionProbeResult> {
	const input = validateKernelInput(value);
	const build = await buildProject(projectRoot, { write: false });
	const compilerArtifact = snapshotProjectBuild(build, {
		...options,
		stage: 'stage0',
	});
	const temporaryDirectory = await materializeCompilerCandidate(
		build,
		compilerArtifact,
		options.temporaryRoot,
	);
	try {
		const module = await loadCompilerCandidate(
			temporaryDirectory,
			options.entryModulePath ?? 'dist/main.js',
		);
		const output = await compileWithSelfhostMvp(module, input);
		const artifact = createProbeArtifact(compilerArtifact, input, output);
		const serialized = JSON.stringify(canonicalizeJson(artifact as unknown as JsonValue));
		return {
			compilerArtifact,
			output,
			artifact,
			serialized,
			sha256: sha256(serialized),
		};
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

export function validateSelfhostMvpModule(value: unknown): SelfhostMvpModule {
	if (value === null || typeof value !== 'object') {
		throw new Error('Bootstrap compiler candidate must be an ES module object');
	}
	const compileMvp = (value as { readonly compileMvp?: unknown }).compileMvp;
	if (typeof compileMvp !== 'function') {
		throw new Error('Bootstrap compiler candidate must export compileMvp');
	}
	return value as SelfhostMvpModule;
}

async function materializeCompilerCandidate(
	build: ProjectBuildResult,
	compilerArtifact: NormalizedBootstrapArtifactResult,
	temporaryRoot: string,
): Promise<string> {
	const errors = build.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
	if (errors.length > 0) {
		throw new Error(`Cannot materialize a failed compiler build: ${errors.length} error diagnostic(s)`);
	}
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-bootstrap-probe-'));
	try {
		for (const module of compilerArtifact.artifact.modules) {
			const outputPath = join(root, module.path);
			await mkdir(dirname(outputPath), { recursive: true });
			await writeFile(outputPath, module.code, 'utf8');
		}
		return root;
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}

async function loadCompilerCandidate(root: string, entryModulePath: string): Promise<SelfhostMvpModule> {
	const canonicalEntryPath = normalizeKernelPath(entryModulePath, '$.entryModulePath');
	if (!canonicalEntryPath.endsWith('.js')) throw new Error('Bootstrap compiler entry module must be JavaScript');
	const moduleUrl = new URL(pathToFileURL(join(root, canonicalEntryPath)).href);
	moduleUrl.searchParams.set('probe', `${Date.now()}-${Math.random()}`);
	return validateSelfhostMvpModule(await import(moduleUrl.href) as unknown);
}

function createProbeArtifact(
	compilerArtifact: NormalizedBootstrapArtifactResult,
	input: KernelInputV1,
	output: KernelOutputV1,
): BootstrapExecutionProbeArtifact {
	return {
		policyVersion: BOOTSTRAP_EXECUTION_PROBE_VERSION,
		claim: 'stage0-compiler-execution-probe',
		productionEligible: false,
		compilerArtifactSha256: compilerArtifact.sha256,
		inputSha256: sha256(JSON.stringify(canonicalizeJson(input as unknown as JsonValue))),
		outputSha256: sha256(JSON.stringify(canonicalizeJson(output as unknown as JsonValue))),
		accepted: output.accepted,
		diagnosticCodes: output.diagnostics.map(diagnostic => diagnostic.code),
		emittedModulePaths: output.emittedModules.map(module => module.outputPath),
	};
}

function canonicalizeJson(value: JsonValue): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error('Probe evidence contains a non-finite number');
		return value;
	}
	if (Array.isArray(value)) return value.map(item => canonicalizeJson(item));
	const objectValue = value as { readonly [key: string]: JsonValue };
	const output: Record<string, JsonValue> = {};
	for (const key of Object.keys(objectValue).sort()) {
		const child = objectValue[key];
		if (child === undefined) throw new Error(`Probe evidence field ${key} is undefined`);
		output[key] = canonicalizeJson(child);
	}
	return output;
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
