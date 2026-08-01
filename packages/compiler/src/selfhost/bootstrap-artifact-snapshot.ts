import { createHash } from 'node:crypto';
import type { ProjectBuildResult } from '../project/project.js';
import {
	BOOTSTRAP_ARTIFACT_POLICY_VERSION,
	normalizeBootstrapArtifact,
	type JsonValue,
	type NormalizedBootstrapArtifactResult,
} from './bootstrap-artifact-normalizer.js';

export type BootstrapStage = 'stage0' | 'stage1' | 'stage2';

export interface BootstrapArtifactSnapshotOptions {
	readonly stage: BootstrapStage;
	readonly compilerVersion: string;
	readonly runtimeAbi: string;
	readonly interopAbi: string;
	readonly seedSha256?: string;
	readonly generatedAt?: string;
	readonly runId?: string;
	readonly metadata?: Readonly<Record<string, JsonValue>>;
	readonly diagnosticsSchema?: JsonValue;
}

const defaultDiagnosticsSchema: JsonValue = {
	type: 'object',
	required: ['code', 'severity', 'message', 'span'],
	properties: {
		code: { type: 'string' },
		severity: { enum: ['error', 'warning'] },
		message: { type: 'string' },
		span: {
			type: 'object',
			required: ['file', 'start', 'end'],
		},
	},
};

/**
 * Convert an actual project build into the versioned bootstrap artifact model.
 * The snapshot is data-only and is suitable for Stage 1／Stage 2 comparison,
 * but it does not perform either stage or select a production compiler.
 */
export function snapshotProjectBuild(
	result: ProjectBuildResult,
	options: BootstrapArtifactSnapshotOptions,
): NormalizedBootstrapArtifactResult {
	const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
	if (errors.length > 0) {
		throw new Error(`Cannot snapshot a failed project build: ${errors.length} error diagnostic(s)`);
	}
	assertNonEmpty(options.compilerVersion, 'compilerVersion');
	assertNonEmpty(options.runtimeAbi, 'runtimeAbi');
	assertNonEmpty(options.interopAbi, 'interopAbi');
	if (options.seedSha256 !== undefined) assertSha256(options.seedSha256, 'seedSha256');

	const modules = result.modules.flatMap(module => {
		if (module.output === undefined && module.outputPath === undefined) return [];
		if (module.output === undefined || module.outputPath === undefined) {
			throw new Error(`Incomplete emitted module snapshot for ${module.source.path}`);
		}
		return [{
			path: module.outputPath,
			code: module.output.code,
			sourceMap: parseSourceMap(module.output.map, module.outputPath),
			exports: extractGeneratedModuleExports(module.output.code),
		}];
	});
	if (modules.length === 0) throw new Error('Cannot snapshot a project build with no emitted modules');

	const checksumManifest = modules.flatMap(module => {
		const codeEntry = { path: module.path, sha256: sha256(module.code) };
		if (!result.config.sourceMap) return [codeEntry];
		const sourceModule = result.modules.find(item => item.outputPath === module.path);
		if (sourceModule?.output === undefined) throw new Error(`Missing source map for ${module.path}`);
		return [codeEntry, { path: `${module.path}.map`, sha256: sha256(sourceModule.output.map) }];
	});

	return normalizeBootstrapArtifact({
		policyVersion: BOOTSTRAP_ARTIFACT_POLICY_VERSION,
		root: result.root,
		modules,
		diagnosticsSchema: options.diagnosticsSchema ?? defaultDiagnosticsSchema,
		metadata: {
			...options.metadata,
			stage: options.stage,
			compilerVersion: options.compilerVersion,
			languageVersion: result.config.languageVersion,
			platform: result.config.platform,
			target: result.config.target,
			runtimeAbi: options.runtimeAbi,
			interopAbi: options.interopAbi,
			sourceMap: result.config.sourceMap,
			sourcesContent: result.config.sourcesContent,
			...(options.seedSha256 === undefined ? {} : { seedSha256: options.seedSha256.toLowerCase() }),
			...(options.generatedAt === undefined ? {} : { generatedAt: options.generatedAt }),
			...(options.runId === undefined ? {} : { runId: options.runId }),
		},
		checksumManifest,
	});
}

/** Extract the finite ES module export forms emitted by Virune's emitter. */
export function extractGeneratedModuleExports(code: string): readonly string[] {
	const exports: string[] = [];
	const declarationPattern = /(?:^|\n)export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu;
	for (const match of code.matchAll(declarationPattern)) {
		const name = match[1];
		if (name !== undefined) exports.push(name);
	}
	const listPattern = /(?:^|\n)export\s*\{([^}]*)\};/gu;
	for (const match of code.matchAll(listPattern)) {
		for (const entry of (match[1] ?? '').split(',')) {
			const value = entry.trim();
			if (value.length === 0) continue;
			const parts = value.split(/\s+as\s+/u);
			const name = parts.at(-1);
			if (name === undefined || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) {
				throw new Error(`Unsupported generated export entry: ${value}`);
			}
			exports.push(name);
		}
	}
	return exports;
}

function parseSourceMap(value: string, outputPath: string): JsonValue {
	try {
		return JSON.parse(value) as JsonValue;
	} catch (error) {
		throw new Error(`Invalid source map for ${outputPath}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function assertNonEmpty(value: string, name: string): void {
	if (value.length === 0) throw new Error(`${name} must not be empty`);
}

function assertSha256(value: string, name: string): void {
	if (!/^[0-9a-f]{64}$/iu.test(value)) throw new Error(`${name} must be a SHA-256 value`);
}
