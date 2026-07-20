import { compileSource as compileSourceDetailed } from './compiler.js';
import { buildProject as buildProjectDetailed, loadConfig, type ViruneConfig } from './project/project.js';
import { diagnosticsToJson, renderDiagnostic } from './diagnostics/render.js';
import type { Diagnostic } from './diagnostics/diagnostic.js';
import type { SourceFile } from './source.js';

export interface CompileOptions {
	readonly outputFile?: string;
	readonly emit?: boolean;
	readonly sourceMap?: boolean;
	readonly sourcesContent?: boolean;
	readonly sourcePath?: string;
	readonly platform?: 'node' | 'browser' | 'neutral';
}

export interface EmitOutput {
	readonly code: string;
	readonly map: string;
}

export interface CompileResult {
	readonly source: SourceFile;
	readonly diagnostics: readonly Diagnostic[];
	readonly output?: EmitOutput;
}

export interface ProjectModuleResult {
	readonly source: SourceFile;
	readonly diagnostics: readonly Diagnostic[];
	readonly output?: EmitOutput;
	readonly outputPath?: string;
}

export interface ProjectBuildResult {
	readonly root: string;
	readonly config: ViruneConfig;
	readonly modules: readonly ProjectModuleResult[];
	readonly diagnostics: readonly Diagnostic[];
}

export function compileSource(source: SourceFile, options: CompileOptions = {}): CompileResult {
	const result = compileSourceDetailed(source, options);
	return {
		source: result.source,
		diagnostics: result.diagnostics,
		...(result.output === undefined ? {} : { output: result.output }),
	};
}

export async function buildProject(
	rootDirectory: string,
	write = true,
	additionalEntries: readonly string[] = [],
): Promise<ProjectBuildResult> {
	const result = await buildProjectDetailed(rootDirectory, write, additionalEntries);
	return {
		root: result.root,
		config: result.config,
		modules: result.modules.map(module => ({
			source: module.source,
			diagnostics: module.diagnostics,
			...(module.output === undefined ? {} : { output: module.output }),
			...(module.outputPath === undefined ? {} : { outputPath: module.outputPath }),
		})),
		diagnostics: result.diagnostics,
	};
}

export function formatDiagnostics(
	diagnostics: readonly Diagnostic[],
	files: ReadonlyMap<number, SourceFile>,
	format: 'text' | 'json' = 'text',
): string {
	if (format === 'json') return diagnosticsToJson(diagnostics, files);
	return diagnostics.map(diagnostic => {
		const file = files.get(diagnostic.span.fileId);
		return file === undefined ? `${diagnostic.severity}[${diagnostic.code}]: ${diagnostic.message}` : renderDiagnostic(diagnostic, file);
	}).join('\n\n');
}

export { loadConfig, diagnosticsToJson, renderDiagnostic };
export type { ViruneConfig } from './project/project.js';
export type { Diagnostic, DiagnosticFix, DiagnosticSeverity, RelatedDiagnostic } from './diagnostics/diagnostic.js';
export type { FileId, NodeId, SourceFile, SourcePosition, SourceSpan, SymbolId, TypeId } from './source.js';
