import { relative, resolve } from 'node:path';
import type * as A from '../ast/nodes.js';
import type { Diagnostic, DiagnosticFix, RelatedDiagnostic } from '../diagnostics/diagnostic.js';
import { buildProject, type BuiltModule, type ProjectBuildStats, type ProjectHost } from '../project/project.js';
import type { SourceSpan } from '../source.js';
import {
	KERNEL_CONTRACT_VERSION,
	KERNEL_LANGUAGE_VERSION,
	KernelContractError,
	normalizeKernelPath,
	validateKernelInput,
	validateKernelOutput,
	type KernelDependencyV1,
	type KernelDiagnosticFixV1,
	type KernelDiagnosticV1,
	type KernelExportedSymbolV1,
	type KernelInputV1,
	type KernelOutputV1,
	type KernelRelatedDiagnosticV1,
	type KernelSpanV1,
} from './contract.js';

const VIRTUAL_ROOT = resolve('/__virune_selfhost_kernel_v1__');
const VIRTUAL_OUT_DIR = '.selfhost-output';

/**
 * Execute the current TypeScript compiler behind the versioned, data-only
 * self-hosting contract. This is an internal comparison path and does not
 * change the production compiler facade or stable public API.
 */
export async function compileWithLegacyKernel(value: unknown): Promise<KernelOutputV1> {
	const input = validateKernelInput(value);
	if (input.interopManifest.modules.length > 0) {
		throw new KernelContractError(
			'$.interopManifest.modules',
			'non-empty Interop Manifest execution is deferred until the versioned manifest semantics are implemented',
		);
	}
	const host = createKernelProjectHost(input);
	const result = await buildProject(VIRTUAL_ROOT, {
		write: false,
		host,
		includeConfigEntry: true,
	});
	const sourcePaths = new Map(result.modules.map(module => [module.source.id, toKernelPath(module.source.path)]));
	const diagnostics = result.diagnostics.map(diagnostic => toKernelDiagnostic(diagnostic, sourcePaths)).sort(compareDiagnostics);
	const output: KernelOutputV1 = {
		contractVersion: KERNEL_CONTRACT_VERSION,
		languageVersion: KERNEL_LANGUAGE_VERSION,
		platform: input.platform,
		entryPath: input.entryPath,
		accepted: !diagnostics.some(diagnostic => diagnostic.severity === 'error'),
		diagnostics,
		emittedModules: result.modules
			.filter((module): module is BuiltModule & { readonly output: NonNullable<BuiltModule['output']>; readonly outputPath: string } => module.output !== undefined && module.outputPath !== undefined)
			.map(module => ({
				sourcePath: toKernelPath(module.source.path),
				outputPath: toKernelPath(module.outputPath),
				code: module.output.code,
				sourceMap: module.output.map,
			}))
			.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
		dependencies: collectDependencies(result.modules),
		exportedSymbols: collectExportedSymbols(result.modules),
		stats: copyStats(result.stats),
	};
	return validateKernelOutput(output);
}

function createKernelProjectHost(input: KernelInputV1): ProjectHost {
	const sources = new Map(input.sources.map(source => [toAbsolutePath(source.path), source.text]));
	const configPath = resolve(VIRTUAL_ROOT, 'virune.json');
	const config = JSON.stringify({
		languageVersion: input.languageVersion,
		platform: input.platform,
		sourceDir: '.',
		outDir: VIRTUAL_OUT_DIR,
		entry: input.entryPath,
		target: input.emit.target,
		sourceMap: input.emit.sourceMap,
		sourcesContent: input.emit.sourcesContent,
	});
	return {
		async readFile(path: string): Promise<string> {
			const absolute = resolve(path);
			if (absolute === configPath) return config;
			const source = sources.get(absolute);
			if (source !== undefined) return source;
			const error = new Error(`Virtual kernel source not found: ${toKernelPath(absolute)}`) as NodeJS.ErrnoException;
			error.code = 'ENOENT';
			throw error;
		},
	};
}

function collectDependencies(modules: readonly BuiltModule[]): readonly KernelDependencyV1[] {
	const dependencies: KernelDependencyV1[] = [];
	for (const module of modules) {
		const modulePath = toKernelPath(module.source.path);
		for (const declaration of module.ast?.imports ?? []) {
			const resolvedPath = declaration.sourceKind === 'virune'
				? resolveRelativeKernelImport(modulePath, declaration.source)
				: undefined;
			dependencies.push({
				modulePath,
				sourceKind: declaration.sourceKind,
				specifier: declaration.source,
				...(resolvedPath === undefined ? {} : { resolvedPath }),
				typeOnly: declaration.typeOnly,
				public: declaration.public,
			});
		}
	}
	return dependencies.sort((left, right) => compareTuple(
		[left.modulePath, left.sourceKind, left.specifier, left.typeOnly ? '1' : '0', left.public ? '1' : '0'],
		[right.modulePath, right.sourceKind, right.specifier, right.typeOnly ? '1' : '0', right.public ? '1' : '0'],
	));
}

function collectExportedSymbols(modules: readonly BuiltModule[]): readonly KernelExportedSymbolV1[] {
	const symbols: KernelExportedSymbolV1[] = [];
	for (const module of modules) {
		const modulePath = toKernelPath(module.source.path);
		for (const declaration of module.ast?.declarations ?? []) {
			if (!isPublicNamedDeclaration(declaration)) continue;
			symbols.push({ modulePath, name: declaration.name, declarationKind: declaration.kind });
		}
	}
	return symbols.sort((left, right) => compareTuple(
		[left.modulePath, left.name, left.declarationKind],
		[right.modulePath, right.name, right.declarationKind],
	));
}

function isPublicNamedDeclaration(declaration: A.Declaration): declaration is A.Declaration & { readonly public: true; readonly name: string } {
	return 'public' in declaration && declaration.public === true && 'name' in declaration && typeof declaration.name === 'string';
}

function toKernelDiagnostic(diagnostic: Diagnostic, sourcePaths: ReadonlyMap<number, string>): KernelDiagnosticV1 {
	const sourcePath = sourcePaths.get(diagnostic.span.fileId);
	return {
		code: diagnostic.code,
		severity: diagnostic.severity,
		message: diagnostic.message,
		...(sourcePath === undefined ? {} : { sourcePath }),
		span: toKernelSpan(diagnostic.span),
		...(diagnostic.related === undefined ? {} : { related: diagnostic.related.map(item => toKernelRelated(item, sourcePaths)) }),
		...(diagnostic.help === undefined ? {} : { help: diagnostic.help }),
		...(diagnostic.fixes === undefined ? {} : { fixes: diagnostic.fixes.map(item => toKernelFix(item, sourcePaths)) }),
		...(diagnostic.cause === undefined ? {} : { cause: { ...diagnostic.cause } }),
	};
}

function toKernelRelated(related: RelatedDiagnostic, sourcePaths: ReadonlyMap<number, string>): KernelRelatedDiagnosticV1 {
	const sourcePath = sourcePaths.get(related.span.fileId);
	return {
		message: related.message,
		...(sourcePath === undefined ? {} : { sourcePath }),
		span: toKernelSpan(related.span),
	};
}

function toKernelFix(fix: DiagnosticFix, sourcePaths: ReadonlyMap<number, string>): KernelDiagnosticFixV1 {
	const sourcePath = fix.span === undefined ? undefined : sourcePaths.get(fix.span.fileId);
	return {
		...(fix.id === undefined ? {} : { id: fix.id }),
		title: fix.title,
		kind: fix.kind,
		...(sourcePath === undefined ? {} : { sourcePath }),
		...(fix.span === undefined ? {} : { span: toKernelSpan(fix.span) }),
		...(fix.text === undefined ? {} : { text: fix.text }),
	};
}

function toKernelSpan(span: SourceSpan): KernelSpanV1 {
	return {
		start: { offset: span.start.offset, line: span.start.line, column: span.start.column },
		end: { offset: span.end.offset, line: span.end.line, column: span.end.column },
	};
}

function copyStats(stats: ProjectBuildStats): ProjectBuildStats {
	return {
		parsedModules: stats.parsedModules,
		reusedParsedModules: stats.reusedParsedModules,
		checkedModules: stats.checkedModules,
		reusedCheckedModules: stats.reusedCheckedModules,
		emittedModules: stats.emittedModules,
		reusedEmittedModules: stats.reusedEmittedModules,
		invalidatedModules: stats.invalidatedModules,
	};
}

function toAbsolutePath(path: string): string {
	return resolve(VIRTUAL_ROOT, ...path.split('/'));
}

function toKernelPath(path: string): string {
	return normalizeKernelPath(relative(VIRTUAL_ROOT, resolve(path)).replaceAll('\\', '/'), '$path');
}

function resolveRelativeKernelImport(modulePath: string, specifier: string): string | undefined {
	if (!specifier.startsWith('.')) return undefined;
	const parentSegments = modulePath.split('/').slice(0, -1);
	try { return normalizeKernelPath([...parentSegments, ...specifier.split('/')].join('/'), '$specifier'); }
	catch { return undefined; }
}

function compareDiagnostics(left: KernelDiagnosticV1, right: KernelDiagnosticV1): number {
	return compareTuple(
		[left.sourcePath ?? '', String(left.span.start.offset).padStart(12, '0'), left.code, left.message],
		[right.sourcePath ?? '', String(right.span.start.offset).padStart(12, '0'), right.code, right.message],
	);
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
	for (let index = 0; index < Math.max(left.length, right.length); index++) {
		const comparison = (left[index] ?? '').localeCompare(right[index] ?? '');
		if (comparison !== 0) return comparison;
	}
	return 0;
}
