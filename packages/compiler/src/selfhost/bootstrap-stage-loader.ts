import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeKernelPath, type KernelInputV1 } from './contract.js';
import {
	compileWithProjectCompilerBoundary,
	hasSelfhostProjectCompilerExports,
	readProjectCompilerCapability,
	type ProjectCompilerCapabilityV1,
} from './project-compiler-adapter.js';
import type { SelfhostMvpModule } from './mvp-adapter.js';
import {
	executeBootstrapStages,
	type BootstrapStageArtifact,
	type BootstrapStageCompiler,
	type BootstrapStageExecutionResult,
} from './bootstrap-stage-executor.js';

export interface MaterializedBootstrapStageCompiler {
	readonly root: string;
	readonly entryModulePath: string;
	readonly capability: ProjectCompilerCapabilityV1;
	readonly compiler: BootstrapStageCompiler;
	readonly dispose: () => Promise<void>;
}

export function verifyBootstrapStageArtifact(artifact: BootstrapStageArtifact): void {
	const serializedPayload = JSON.stringify({
		metadata: artifact.metadata,
		entryPath: artifact.entryPath,
		modules: artifact.modules,
		dependencies: artifact.dependencies,
		exportedSymbols: artifact.exportedSymbols,
	});
	if (artifact.serializedPayload !== serializedPayload) {
		throw new Error('Bootstrap stage artifact serialized payload does not match its fields');
	}
	const calculatedSha256 = createHash('sha256').update(serializedPayload, 'utf8').digest('hex');
	if (artifact.sha256 !== calculatedSha256) {
		throw new Error('Bootstrap stage artifact SHA-256 does not match its serialized payload');
	}
}

export async function materializeBootstrapStageCompiler(
	artifact: BootstrapStageArtifact,
	temporaryRoot: string,
): Promise<MaterializedBootstrapStageCompiler> {
	verifyBootstrapStageArtifact(artifact);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-stage-'));
	try {
		await writeFile(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
		const outputPaths = new Set<string>();
		const entrySourcePath = normalizeKernelPath(artifact.entryPath, '$.entryPath');
		const entryCandidates: string[] = [];
		for (const [index, module] of artifact.modules.entries()) {
			const sourcePath = normalizeKernelPath(module.sourcePath, `$.modules[${index}].sourcePath`);
			const outputPath = normalizeKernelPath(module.outputPath, `$.modules[${index}].outputPath`);
			if (!outputPath.endsWith('.js')) {
				throw new Error(`Bootstrap stage module ${outputPath} must be JavaScript`);
			}
			if (outputPaths.has(outputPath)) {
				throw new Error(`Bootstrap stage output path ${outputPath} must be unique`);
			}
			outputPaths.add(outputPath);
			if (sourcePath === entrySourcePath) entryCandidates.push(outputPath);
			const destination = join(root, outputPath);
			await mkdir(dirname(destination), { recursive: true });
			await writeFile(destination, module.code, 'utf8');
		}
		if (entryCandidates.length !== 1) {
			throw new Error(
				`Bootstrap stage entry ${entrySourcePath} must resolve to exactly one emitted module; found ${entryCandidates.length}`,
			);
		}
		const entryModulePath = entryCandidates[0]!;
		const moduleUrl = new URL(pathToFileURL(join(root, entryModulePath)).href);
		moduleUrl.searchParams.set('stage', `${artifact.sha256}-${Date.now()}-${Math.random()}`);
		const loaded = await import(moduleUrl.href) as unknown;
		if (loaded === null || typeof loaded !== 'object') {
			throw new Error('Bootstrap stage compiler candidate must be an ES module object');
		}
		const candidate = loaded as SelfhostMvpModule;
		if (typeof candidate.compileMvp !== 'function' || !hasSelfhostProjectCompilerExports(candidate)) {
			throw new Error(
				'Bootstrap stage compiler candidate must export compileMvp, projectCompilerCapability, and compileProjectMvp',
			);
		}
		const capability = readProjectCompilerCapability(candidate);
		if (capability === null) {
			throw new Error('Bootstrap stage compiler candidate must expose a project compiler capability');
		}
		if (!capability.ready) {
			throw new Error(
				`Bootstrap stage compiler candidate is not ready: ${capability.blockers.join(', ')}`,
			);
		}
		let disposed = false;
		return {
			root,
			entryModulePath,
			capability,
			compiler: {
				compile: input => compileWithProjectCompilerBoundary(candidate, input),
			},
			dispose: async () => {
				if (disposed) return;
				disposed = true;
				await rm(root, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await rm(root, { recursive: true, force: true });
		throw error;
	}
}

export async function executeBootstrapStagesWithArtifactLoader(
	stage0: BootstrapStageCompiler,
	input: KernelInputV1,
	temporaryRoot: string,
): Promise<BootstrapStageExecutionResult> {
	const candidates: MaterializedBootstrapStageCompiler[] = [];
	try {
		return await executeBootstrapStages(stage0, input, async artifact => {
			if (candidates.length > 0) {
				throw new Error('Bootstrap stage loader may materialize only one Stage 1 compiler');
			}
			const candidate = await materializeBootstrapStageCompiler(artifact, temporaryRoot);
			candidates.push(candidate);
			return candidate.compiler;
		});
	} finally {
		for (const candidate of candidates) await candidate.dispose();
		const remaining = await readdir(temporaryRoot).catch(() => [] as string[]);
		if (remaining.length === 0) {
			await rm(temporaryRoot, { recursive: true, force: true });
		}
	}
}
