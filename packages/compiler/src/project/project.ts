import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type * as A from '../ast/nodes.js';
import { checkModule, type SemanticModel } from '../checker/checker.js';
import { emitJavaScript, type EmitResult } from '../codegen/emitter.js';
import { DiagnosticBag, type Diagnostic } from '../diagnostics/diagnostic.js';
import { lowerToHir } from '../hir/lower.js';
import { buildAst } from '../syntax/cst-to-ast.js';
import { attachDocumentation } from '../syntax/documentation.js';
import { parse } from '../syntax/parser.js';
import { lex } from '../syntax/tokens.js';
import type { JsInteropProvider } from '../interop/types.js';
import type { FileId, SourceFile, SourceSpan } from '../source.js';

export interface ViruneConfig {
	readonly languageVersion: '1.0';
	readonly platform: 'node' | 'browser' | 'neutral';
	readonly sourceDir: string;
	readonly outDir: string;
	readonly entry: string;
	readonly target: 'es2022';
	readonly sourceMap: boolean;
	readonly sourcesContent: boolean;
	readonly test?: { readonly include?: readonly string[] };
}

export interface ParsedModule {
	readonly source: SourceFile;
	readonly ast?: A.ModuleNode;
	readonly diagnostics: readonly Diagnostic[];
}

export interface BuiltModule extends ParsedModule {
	readonly semantic?: SemanticModel;
	readonly output?: EmitResult;
	readonly outputPath?: string;
}

export interface ProjectBuildStats {
	readonly parsedModules: number;
	readonly reusedParsedModules: number;
	readonly checkedModules: number;
	readonly reusedCheckedModules: number;
	readonly emittedModules: number;
	readonly reusedEmittedModules: number;
	readonly invalidatedModules: number;
}

export interface ProjectBuildResult {
	readonly root: string;
	readonly config: ViruneConfig;
	readonly modules: readonly BuiltModule[];
	readonly diagnostics: readonly Diagnostic[];
	readonly stats: ProjectBuildStats;
}

interface CachedProjectModule {
	readonly sourceHash: string;
	readonly parsed: ParsedModule;
	readonly interfaceHash: string;
	readonly buildFingerprint: string;
	readonly built: BuiltModule;
}

/**
 * Reusable state for incremental project builds. The cache is intentionally
 * explicit so one-shot CLI builds remain deterministic and side-effect free.
 */
export class ProjectBuildCache {
	readonly #entries = new Map<string, CachedProjectModule>();
	readonly #fileIds = new Map<string, number>();
	#nextFileId = 1;

	public clear(): void {
		this.#entries.clear();
	}

	public invalidate(path?: string): void {
		if (path === undefined) this.clear();
		else this.#entries.delete(resolve(path));
	}

	public fileId(path: string): number {
		const normalized = resolve(path);
		const existing = this.#fileIds.get(normalized);
		if (existing !== undefined) return existing;
		const id = this.#nextFileId++;
		this.#fileIds.set(normalized, id);
		return id;
	}

	public get(path: string): CachedProjectModule | undefined { return this.#entries.get(resolve(path)); }
	public set(path: string, value: CachedProjectModule): void { this.#entries.set(resolve(path), value); }

	public prune(paths: ReadonlySet<string>): number {
		let removed = 0;
		for (const path of this.#entries.keys()) {
			if (paths.has(path)) continue;
			this.#entries.delete(path);
			removed++;
		}
		return removed;
	}
}

export interface ProjectHost {
	readFile(path: string): Promise<string>;
}

export interface BuildProjectOptions {
	readonly write?: boolean;
	readonly additionalEntries?: readonly string[];
	readonly host?: ProjectHost;
	readonly includeConfigEntry?: boolean;
	readonly incrementalCache?: ProjectBuildCache;
	readonly jsInteropProvider?: JsInteropProvider;
}

export interface EntryPointValidationResult {
	readonly main?: A.FunctionDeclaration;
	readonly diagnostics: readonly Diagnostic[];
}

const nodeProjectHost: ProjectHost = {
	readFile: path => readFile(path, 'utf8'),
};

const defaultConfig: ViruneConfig = {
	languageVersion: '1.0', platform: 'node', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022', sourceMap: true, sourcesContent: true,
};

export async function loadConfig(root: string, host: ProjectHost = nodeProjectHost): Promise<ViruneConfig> {
	let value: unknown;
	try { value = JSON.parse(await host.readFile(join(root, 'virune.json'))); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig;
		throw new Error(`Invalid virune.json: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid virune.json: root value must be an object');
	const raw = value as Record<string, unknown>;
	const merged = { ...defaultConfig, ...raw } as Record<string, unknown>;
	if (merged.languageVersion !== '1.0') throw new Error('Invalid virune.json: languageVersion must be "1.0"');
	if (!['node', 'browser', 'neutral'].includes(String(merged.platform))) throw new Error('Invalid virune.json: platform must be node, browser, or neutral');
	if (merged.target !== 'es2022') throw new Error('Invalid virune.json: target must be "es2022"');
	for (const key of ['sourceDir', 'outDir', 'entry'] as const) if (typeof merged[key] !== 'string' || merged[key].length === 0) throw new Error(`Invalid virune.json: ${key} must be a non-empty string`);
	for (const key of ['sourceMap', 'sourcesContent'] as const) if (typeof merged[key] !== 'boolean') throw new Error(`Invalid virune.json: ${key} must be boolean`);
	return merged as unknown as ViruneConfig;
}

export function parseSource(source: SourceFile): ParsedModule {
	const diagnostics = new DiagnosticBag();
	const lexed = lex(source.text);
	for (const error of lexed.errors) diagnostics.error('L0001', error.message, spanAt(source.id, error.offset, error.length, error.line ?? 1, error.column ?? 1));
	const parsed = parse(lexed.tokens);
	for (const error of parsed.errors) {
		const token = error.token;
		const offset = finitePosition(token.startOffset, source.text.length);
		const endOffset = Math.min(source.text.length, Math.max(offset, finitePosition(token.endOffset, offset)));
		const line = finitePosition(token.startLine, lineAt(source.text, offset));
		const column = finitePosition(token.startColumn, columnAt(source.text, offset));
		diagnostics.error('L0002', error.message, spanAt(source.id, offset, endOffset - offset, line, column));
	}
	if (diagnostics.hasErrors) return { source, diagnostics: diagnostics.items };
	try {
		const ast = attachDocumentation(buildAst(source.id, parsed.cst), source, lexed.comments, lexed.tokens, diagnostics);
		return { source, ast, diagnostics: diagnostics.items };
	}
	catch (error) { diagnostics.error('L9001', `AST construction failed: ${error instanceof Error ? error.message : String(error)}`, spanAt(source.id, 0, 1, 1, 1)); return { source, diagnostics: diagnostics.items }; }
}

export async function buildProject(rootDirectory: string, options?: BuildProjectOptions): Promise<ProjectBuildResult>;
export async function buildProject(rootDirectory: string, write?: boolean, additionalEntries?: readonly string[]): Promise<ProjectBuildResult>;
export async function buildProject(
	rootDirectory: string,
	optionsOrWrite: BuildProjectOptions | boolean = true,
	legacyAdditionalEntries: readonly string[] = [],
): Promise<ProjectBuildResult> {
	const options: BuildProjectOptions = typeof optionsOrWrite === 'boolean'
		? { write: optionsOrWrite, additionalEntries: legacyAdditionalEntries }
		: optionsOrWrite;
	const write = options.write ?? true;
	const additionalEntries = options.additionalEntries ?? [];
	const host = options.host ?? nodeProjectHost;
	const includeConfigEntry = options.includeConfigEntry ?? true;
	const root = resolve(rootDirectory);
	const projectDiagnostics = new DiagnosticBag();
	const cache = options.incrementalCache;
	const jsInteropProvider = options.jsInteropProvider;
	const mutableStats = { parsedModules: 0, reusedParsedModules: 0, checkedModules: 0, reusedCheckedModules: 0, emittedModules: 0, reusedEmittedModules: 0, invalidatedModules: 0 };
	let config: ViruneConfig;
	try { config = await loadConfig(root, host); }
	catch (error) {
		config = defaultConfig;
		projectDiagnostics.error('L5002', error instanceof Error ? error.message : String(error), spanAt(0, 0, 1, 1, 1));
		return { root, config, modules: [], diagnostics: projectDiagnostics.items, stats: mutableStats };
	}
	const entry = resolve(root, config.entry);
	const parsedByPath = new Map<string, ParsedModule>();
	const sourceHashes = new Map<string, string>();
	const dependenciesByPath = new Map<string, string[]>();
	let nextFileId = 1;
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const order: string[] = [];

	const visit = async (path: string, fromImport?: A.ImportDeclaration): Promise<void> => {
		const normalized = resolve(path);
		if (visiting.has(normalized)) {
			projectDiagnostics.error('L4002', `Module cycle detected at ${normalized}`, fromImport?.span ?? spanAt(0, 0, 1, 1, 1)); return;
		}
		if (visited.has(normalized)) return;
		visiting.add(normalized);
		let text: string;
		try { text = await host.readFile(normalized); }
		catch (error) { projectDiagnostics.error('L5001', `Cannot read module ${normalized}: ${error instanceof Error ? error.message : String(error)}`, fromImport?.span ?? spanAt(0, 0, 1, 1, 1)); visiting.delete(normalized); return; }
		const sourceHash = contentHash(text);
		sourceHashes.set(normalized, sourceHash);
		const cached = cache?.get(normalized);
		let parsed: ParsedModule;
		if (cached?.sourceHash === sourceHash) {
			parsed = cached.parsed;
			mutableStats.reusedParsedModules++;
		} else {
			parsed = parseSource({ id: cache?.fileId(normalized) ?? nextFileId++, path: normalized, text });
			mutableStats.parsedModules++;
		}
		parsedByPath.set(normalized, parsed);
		const dependencies: string[] = [];
		if (parsed.ast !== undefined) {
			validateModulePolicy(root, config, normalized, parsed.ast, projectDiagnostics);
			validatePublicApi(parsed.ast, projectDiagnostics);
			for (const declaration of parsed.ast.imports) {
				if (declaration.sourceKind === 'javascript') continue;
				const dependency = await resolveImport(root, normalized, declaration.source, host);
				if (dependency === undefined) projectDiagnostics.error('L4003', `Cannot resolve import ${declaration.source}`, declaration.span);
				else { dependencies.push(resolve(dependency)); await visit(dependency, declaration); }
			}
		}
		dependenciesByPath.set(normalized, dependencies);
		visiting.delete(normalized); visited.add(normalized); order.push(normalized);
	};
	if (includeConfigEntry) await visit(entry);
	for (const additionalEntry of additionalEntries) await visit(isAbsolute(additionalEntry) ? additionalEntry : resolve(root, additionalEntry));
	const moduleInterfaces = await buildModuleInterfaces(root, order, parsedByPath, projectDiagnostics, host);
	const interfaceHashes = new Map<string, string>();
	for (const path of order) interfaceHashes.set(path, moduleInterfaceHash(moduleInterfaces.get(path)));
	const configFingerprint = contentHash(JSON.stringify({ config, jsInterop: jsInteropProvider === undefined ? null : { id: jsInteropProvider.id, version: jsInteropProvider.version, generation: jsInteropProvider.generation } }));

	const builtByPath = new Map<string, BuiltModule>();
	let cloneId = -1;
	for (const path of order) {
		const parsed = parsedByPath.get(path)!;
		const dependencySignature = contentHash((dependenciesByPath.get(path) ?? []).map(dependency => `${dependency}:${interfaceHashes.get(dependency) ?? ''}`).sort().join('|'));
		const buildFingerprint = contentHash(`${sourceHashes.get(path) ?? ''}|${dependencySignature}|${configFingerprint}`);
		const cached = cache?.get(path);
		if (cached?.buildFingerprint === buildFingerprint) {
			builtByPath.set(path, cached.built);
			mutableStats.reusedCheckedModules++;
			if (cached.built.output !== undefined) {
				mutableStats.reusedEmittedModules++;
				if (write && cached.built.outputPath !== undefined) await writeEmitOutput(cached.built.outputPath, cached.built.output, config.sourceMap);
			}
			continue;
		}
		let built: BuiltModule;
		if (parsed.ast === undefined || parsed.diagnostics.some(item => item.severity === 'error')) {
			built = parsed;
		} else {
			const importModel = await buildImportModel(root, path, parsed.ast, parsedByPath, moduleInterfaces, projectDiagnostics, cloneId, host);
			cloneId = importModel.nextId;
			const { signatureOnly, typeOnlyNodeIds, importedDeclarations, emissionImports } = importModel;
			const synthetic: A.ModuleNode = { ...parsed.ast, imports: parsed.ast.imports.filter(item => item.sourceKind === 'javascript'), declarations: [...importedDeclarations, ...parsed.ast.declarations] };
			const semantic = checkModule(synthetic, { signatureOnlyNodeIds: signatureOnly, typeOnlyNodeIds, platform: config.platform, moduleId: moduleIdentity(root, path), containingFile: path, ...(jsInteropProvider === undefined ? {} : { jsInteropProvider }) });
			mutableStats.checkedModules++;
			const diagnostics = [...parsed.diagnostics, ...semantic.diagnostics.items];
			let output: EmitResult | undefined; let outputPath: string | undefined;
			if (!diagnostics.some(item => item.severity === 'error') && isWithin(resolve(root, config.sourceDir), path)) {
				const relativePath = relative(resolve(root, config.sourceDir), path);
				outputPath = resolve(root, config.outDir, relativePath.replace(/\.virune$/u, '.js'));
				const emissionModule: A.ModuleNode = { ...parsed.ast, imports: emissionImports };
				output = emitJavaScript(lowerToHir(emissionModule, semantic), parsed.source, outputPath, { sourceMap: config.sourceMap, sourcesContent: config.sourcesContent, sourcePath: relative(root, path).replaceAll('\\', '/') });
				mutableStats.emittedModules++;
				if (write) await writeEmitOutput(outputPath, output, config.sourceMap);
			}
			built = { ...parsed, semantic, ...(output === undefined ? {} : { output }), ...(outputPath === undefined ? {} : { outputPath }), diagnostics };
		}
		builtByPath.set(path, built);
		cache?.set(path, { sourceHash: sourceHashes.get(path)!, parsed, interfaceHash: interfaceHashes.get(path) ?? '', buildFingerprint, built });
	}
	const modules = order.map(path => builtByPath.get(path) ?? parsedByPath.get(path)!).filter((item): item is BuiltModule => item !== undefined);
	const diagnostics = [...projectDiagnostics.items, ...modules.flatMap(item => item.diagnostics)];
	mutableStats.invalidatedModules = cache?.prune(new Set(order)) ?? 0;
	return { root, config, modules, diagnostics, stats: mutableStats };
}

function contentHash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function moduleInterfaceHash(moduleInterface: ModuleInterface | undefined): string {
	if (moduleInterface === undefined) return contentHash('missing');
	const entries = [...moduleInterface.exports.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, entry]) => ({ name, originPath: entry.originPath, declaration: canonicalAst(publicSignatureAst(entry.declaration)) }));
	return contentHash(JSON.stringify(entries));
}

function publicSignatureAst(declaration: A.Declaration): unknown {
	switch (declaration.kind) {
		case 'FunctionDeclaration': {
			const { body: _body, expressionBody: _expressionBody, attributes: _attributes, ...signature } = declaration;
			return signature;
		}
		case 'TopLevelLetDeclaration': {
			const { value: _value, attributes: _attributes, ...signature } = declaration;
			return signature;
		}
		default: {
			const { attributes: _attributes, ...signature } = declaration;
			return signature;
		}
	}
}

function canonicalAst(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalAst);
	if (value === null || typeof value !== 'object') return value;
	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))) {
		if (['id', 'span', 'documentation', 'symbolId', 'inferredTypeId', 'resolvedTypeId'].includes(key)) continue;
		result[key] = canonicalAst(child);
	}
	return result;
}

async function writeEmitOutput(outputPath: string, output: EmitResult, sourceMap: boolean): Promise<void> {
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, output.code, 'utf8');
	if (sourceMap) await writeFile(`${outputPath}.map`, output.map, 'utf8');
}

/**
 * Validate the executable entry point without making library builds depend on
 * the presence of `main`. The CLI invokes this only for `virune run`.
 */
export function validateEntryPoint(module: BuiltModule): EntryPointValidationResult {
	const diagnostics = new DiagnosticBag();
	const moduleSpan = module.ast?.span ?? spanAt(module.source.id, 0, 1, 1, 1);
	if (module.ast === undefined || module.semantic === undefined) {
		diagnostics.error('L5010', 'Entry module could not be analyzed', moduleSpan);
		return { diagnostics: diagnostics.items };
	}

	const namedMain = module.ast.declarations.find(declaration => 'name' in declaration && declaration.name === 'main');
	if (namedMain === undefined || namedMain.kind !== 'FunctionDeclaration') {
		diagnostics.error('L5011', 'Entry module must declare pub fn main', namedMain?.span ?? moduleSpan);
		return { diagnostics: diagnostics.items };
	}
	if (!namedMain.public) diagnostics.error('L5012', 'Entry function main must be public', namedMain.span);
	if (namedMain.typeParameters.length > 0) diagnostics.error('L5013', 'Entry function main cannot be generic', namedMain.span);

	if (namedMain.parameters.length > 1) {
		diagnostics.error('L5014', 'Entry function main accepts zero parameters or one List<String> parameter', namedMain.span);
	} else if (namedMain.parameters.length === 1) {
		const parameter = namedMain.parameters[0]!;
		const typeId = parameter.type.resolvedTypeId;
		const type = typeId === undefined ? undefined : module.semantic.arena.get(typeId);
		const valid = type?.kind === 'list' && module.semantic.arena.equals(type.element, module.semantic.arena.string);
		if (!valid) diagnostics.error('L5015', 'Entry function main parameter must be List<String>', parameter.span);
	}

	const returnTypeId = namedMain.inferredTypeId;
	const returnType = returnTypeId === undefined ? undefined : module.semantic.arena.get(returnTypeId);
	const validReturn = returnTypeId !== undefined && (
		module.semantic.arena.equals(returnTypeId, module.semantic.arena.unit)
		|| (returnType?.kind === 'result' && module.semantic.arena.equals(returnType.value, module.semantic.arena.unit))
	);
	if (!validReturn) diagnostics.error('L5016', 'Entry function main must return Unit or Result<Unit, E>', namedMain.returnType?.span ?? namedMain.span);

	return diagnostics.hasErrors ? { diagnostics: diagnostics.items } : { main: namedMain, diagnostics: diagnostics.items };
}

async function resolveImport(projectRoot: string, importer: string, specifier: string, host: ProjectHost): Promise<string | undefined> {
	if (specifier.startsWith('.')) {
		if (extname(specifier) !== '.virune') return undefined;
		return resolve(dirname(importer), specifier);
	}
	const segments = specifier.split('/');
	const packageName = specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
	const subpathSegments = specifier.startsWith('@') ? segments.slice(2) : segments.slice(1);
	const exportKey = subpathSegments.length === 0 ? '.' : `./${subpathSegments.join('/')}`;
	const packageRoot = join(projectRoot, 'node_modules', packageName);
	try {
		const packageJson = JSON.parse(await host.readFile(join(packageRoot, 'package.json'))) as { exports?: unknown; virune?: string };
		if (exportKey === '.' && typeof packageJson.virune === 'string') return resolve(packageRoot, packageJson.virune);
		const target = resolveViruneExport(packageJson.exports, exportKey);
		return target === undefined ? undefined : resolve(packageRoot, target);
	} catch { return undefined; }
}

function resolveViruneExport(exportsValue: unknown, key: string): string | undefined {
	if (typeof exportsValue === 'string') return key === '.' ? undefined : undefined;
	if (exportsValue === null || typeof exportsValue !== 'object' || Array.isArray(exportsValue)) return undefined;
	const record = exportsValue as Record<string, unknown>;
	const selected = Object.keys(record).some(item => item.startsWith('.')) ? record[key] : key === '.' ? exportsValue : undefined;
	if (typeof selected === 'string') return undefined;
	if (selected === null || typeof selected !== 'object' || Array.isArray(selected)) return undefined;
	const virune = (selected as Record<string, unknown>).virune;
	return typeof virune === 'string' ? virune : undefined;
}

function isWithin(parent: string, child: string): boolean {
	const value = relative(parent, child);
	return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

function validateModulePolicy(root: string, config: ViruneConfig, path: string, module: A.ModuleNode, diagnostics: DiagnosticBag): void {
	const sourceRelative = relative(resolve(root, config.sourceDir), path).replaceAll('\\', '/');
	const inFfiDirectory = sourceRelative === 'ffi' || sourceRelative.startsWith('ffi/');
	for (const declaration of module.declarations) {
		if (declaration.kind !== 'ExternDeclaration') continue;
		if (declaration.module.startsWith('node:') && config.platform !== 'node') diagnostics.error('L4006', `Node.js module ${declaration.module} is not available for platform ${config.platform}`, declaration.span);
		if (declaration.unsafe && !module.unsafe) diagnostics.error('L4007', 'unsafe extern requires an unsafe module declaration', declaration.span);
		if (declaration.unsafe && !inFfiDirectory) diagnostics.error('L4008', 'unsafe extern is allowed only under the source ffi/ directory', declaration.span);
	}
	if (module.unsafe && !inFfiDirectory) diagnostics.error('L4009', 'unsafe module is allowed only under the source ffi/ directory', module.span);
}

function declarationHasRuntimeExport(declaration: A.Declaration): boolean {
	return declaration.kind === 'FunctionDeclaration' || declaration.kind === 'RecordDeclaration' || declaration.kind === 'EnumDeclaration' || declaration.kind === 'NewtypeDeclaration' || (declaration.kind === 'TopLevelLetDeclaration' && declaration.public);
}

interface ExportEntry {
	readonly declaration: A.Declaration;
	readonly originPath: string;
	readonly originModule: A.ModuleNode;
}

interface ModuleInterface { readonly exports: ReadonlyMap<string, ExportEntry>; }

async function buildModuleInterfaces(
	root: string,
	order: readonly string[],
	parsedByPath: ReadonlyMap<string, ParsedModule>,
	diagnostics: DiagnosticBag,
	host: ProjectHost,
): Promise<ReadonlyMap<string, ModuleInterface>> {
	const interfaces = new Map<string, ModuleInterface>();
	for (const path of order) {
		const module = parsedByPath.get(path)?.ast;
		if (module === undefined) continue;
		const exports = new Map<string, ExportEntry>();
		for (const declaration of module.declarations) {
			if (!('name' in declaration) || !('public' in declaration) || declaration.public !== true) continue;
			exports.set(declaration.name, { declaration, originPath: path, originModule: module });
		}
		for (const importDeclaration of module.imports.filter(item => item.public && item.sourceKind === 'virune')) {
			const dependencyPath = await resolveImport(root, path, importDeclaration.source, host);
			const dependencyInterface = dependencyPath === undefined ? undefined : interfaces.get(dependencyPath);
			if (dependencyInterface === undefined) continue;
			for (const item of importDeclaration.items) {
				const exported = dependencyInterface.exports.get(item.imported);
				if (exported === undefined) { diagnostics.error('L4004', `Module ${importDeclaration.source} does not export ${item.imported}`, item.span); continue; }
				if (importDeclaration.typeOnly && !isTypeDeclaration(exported.declaration)) {
					diagnostics.error('L4015', `Type-only re-export ${item.local} must refer to a type`, item.span);
					continue;
				}
				if (exports.has(item.local)) { diagnostics.error('L4016', `Duplicate public export ${item.local}`, item.span); continue; }
				exports.set(item.local, exported);
			}
		}
		interfaces.set(path, { exports });
	}
	return interfaces;
}

interface ImportModel {
	readonly signatureOnly: ReadonlySet<number>;
	readonly typeOnlyNodeIds: ReadonlySet<number>;
	readonly importedDeclarations: readonly A.Declaration[];
	readonly emissionImports: readonly A.ImportDeclaration[];
	readonly nextId: number;
}

const builtinTypeNames = new Set([
	'Bool', 'Int', 'Float', 'BigInt', 'String', 'Unit', 'Unknown', 'Never', 'Option', 'Result', 'List', 'Map', 'Set', 'Stream',
	'JsError', 'JsonError', 'Duration', 'TaskTimeoutError', 'SupervisorRestartLimitError', 'HttpResponse', 'HttpBody', 'FileHandle', 'Bytes', 'MutableBytes', 'ByteOrder', 'BytesError', 'IntegerRangeError', 'Byte', 'Int8', 'UInt8', 'Int16', 'UInt16', 'Int32', 'UInt32', 'Int64', 'UInt64',
]);

async function buildImportModel(
	root: string,
	importerPath: string,
	module: A.ModuleNode,
	parsedByPath: ReadonlyMap<string, ParsedModule>,
	moduleInterfaces: ReadonlyMap<string, ModuleInterface>,
	diagnostics: DiagnosticBag,
	initialId: number,
	host: ProjectHost,
): Promise<ImportModel> {
	let nextId = initialId;
	const next = (): number => nextId--;
	const signatureOnly = new Set<number>();
	const typeOnlyNodeIds = new Set<number>();
	const importedDeclarations: A.Declaration[] = [];
	const emissionImports: A.ImportDeclaration[] = [];
	const emittedTypeDefinitions = new Set<string>();

	for (const importDeclaration of module.imports) {
		if (importDeclaration.sourceKind === 'javascript') { emissionImports.push(importDeclaration); continue; }
		const dependencyPath = await resolveImport(root, importerPath, importDeclaration.source, host);
		const dependencyInterface = dependencyPath === undefined ? undefined : moduleInterfaces.get(dependencyPath);
		if (dependencyPath === undefined || dependencyInterface === undefined) continue;
		const runtimeItems: A.ImportItem[] = [];
		const groups = new Map<string, { readonly module: A.ModuleNode; readonly entries: Array<{ readonly item: A.ImportItem; readonly exported: ExportEntry }> }>();

		for (const item of importDeclaration.items) {
			const exported = dependencyInterface.exports.get(item.imported);
			if (exported === undefined) { diagnostics.error('L4004', `Module ${importDeclaration.source} does not export ${item.imported}`, item.span); continue; }
			const group = groups.get(exported.originPath) ?? { module: exported.originModule, entries: [] };
			group.entries.push({ item, exported });
			groups.set(exported.originPath, group);
			if (!importDeclaration.typeOnly && declarationHasRuntimeExport(exported.declaration)) runtimeItems.push(item);
		}

		for (const [originPath, group] of groups) {
			const explicitAliases = new Map<string, string>();
			const roots = new Set<string>();
			const valueImports: Array<{ readonly declaration: A.Declaration; readonly localName: string }> = [];

			for (const entry of group.entries) {
				const declaration = entry.exported.declaration;
				if (isTypeDeclaration(declaration)) {
					const previous = explicitAliases.get(declaration.name);
					if (previous !== undefined && previous !== entry.item.local) diagnostics.error('L4012', `Type ${declaration.name} cannot be imported under multiple local names`, entry.item.span);
					else explicitAliases.set(declaration.name, entry.item.local);
					roots.add(declaration.name);
				} else valueImports.push({ declaration, localName: entry.item.local });
				for (const name of referencedTypeNames(declaration)) if (!builtinTypeNames.has(name)) roots.add(name);
			}

			const requiredTypes = collectTypeClosure(group.module, roots, diagnostics, importDeclaration.span);
			const rename = new Map<string, string>();
			for (const name of requiredTypes) rename.set(name, explicitAliases.get(name) ?? hiddenImportName(root, originPath, name));

			for (const name of requiredTypes) {
				const declaration = group.module.declarations.find(candidate => isTypeDeclaration(candidate) && candidate.name === name);
				if (declaration === undefined || !isTypeDeclaration(declaration)) continue;
				const definitionId = `${moduleIdentity(root, originPath)}#${name}`;
				const emittedKey = `${definitionId}:${rename.get(name)}`;
				if (emittedTypeDefinitions.has(emittedKey)) continue;
				emittedTypeDefinitions.add(emittedKey);
				const clone = cloneTypeSignature(declaration, rename.get(name)!, definitionId, rename, next);
				signatureOnly.add(clone.id);
				if (!explicitAliases.has(name) || importDeclaration.typeOnly) typeOnlyNodeIds.add(clone.id);
				importedDeclarations.push(clone);
			}

			for (const valueImport of valueImports) {
				const clone = cloneValueSignature(valueImport.declaration, valueImport.localName, rename, next);
				signatureOnly.add(clone.id);
				if (importDeclaration.typeOnly) typeOnlyNodeIds.add(clone.id);
				importedDeclarations.push(clone);
			}
		}
		if (runtimeItems.length > 0) emissionImports.push({ ...importDeclaration, items: runtimeItems });
	}

	return { signatureOnly, typeOnlyNodeIds, importedDeclarations, emissionImports, nextId };
}

function isTypeDeclaration(declaration: A.Declaration): declaration is A.RecordDeclaration | A.EnumDeclaration | A.NewtypeDeclaration | A.TypeAliasDeclaration {
	return declaration.kind === 'RecordDeclaration' || declaration.kind === 'EnumDeclaration' || declaration.kind === 'NewtypeDeclaration' || declaration.kind === 'TypeAliasDeclaration';
}

function collectTypeClosure(module: A.ModuleNode, roots: ReadonlySet<string>, diagnostics: DiagnosticBag, span: SourceSpan): ReadonlySet<string> {
	const declarations = new Map(module.declarations.filter(isTypeDeclaration).map(declaration => [declaration.name, declaration]));
	const result = new Set<string>();
	const visit = (name: string): void => {
		if (builtinTypeNames.has(name) || result.has(name)) return;
		const declaration = declarations.get(name);
		if (declaration === undefined) {
			diagnostics.error('L4011', `Public signature refers to imported or unavailable type ${name}; re-exported signature types are not supported in Virune 1.0`, span);
			return;
		}
		result.add(name);
		for (const dependency of referencedTypeNames(declaration)) visit(dependency);
	};
	for (const root of roots) visit(root);
	return result;
}

function referencedTypeNames(declaration: A.Declaration): ReadonlySet<string> {
	const result = new Set<string>();
	const addReference = (reference: A.TypeReferenceNode, typeParameters: ReadonlySet<string>): void => {
		if (reference.functionType !== undefined) {
			for (const parameter of reference.functionType.parameters) addReference(parameter, typeParameters);
			addReference(reference.functionType.result, typeParameters);
			return;
		}
		if (!typeParameters.has(reference.name)) result.add(reference.name);
		for (const argument of reference.arguments) addReference(argument, typeParameters);
	};
	if (declaration.kind === 'FunctionDeclaration') {
		const parameters = new Set(declaration.typeParameters.map(item => item.name));
		for (const parameter of declaration.parameters) addReference(parameter.type, parameters);
		if (declaration.returnType !== undefined) addReference(declaration.returnType, parameters);
	} else if (declaration.kind === 'RecordDeclaration') {
		const parameters = new Set(declaration.typeParameters.map(item => item.name));
		for (const field of declaration.fields) addReference(field.type, parameters);
	} else if (declaration.kind === 'EnumDeclaration') {
		const parameters = new Set(declaration.typeParameters.map(item => item.name));
		for (const variant of declaration.variants) for (const value of variant.values) addReference(value, parameters);
	} else if (declaration.kind === 'NewtypeDeclaration') addReference(declaration.underlying, new Set());
	else if (declaration.kind === 'TypeAliasDeclaration') addReference(declaration.target, new Set(declaration.typeParameters.map(item => item.name)));
	return result;
}

function cloneValueSignature(declaration: A.Declaration, localName: string, rename: ReadonlyMap<string, string>, next: () => number): A.Declaration {
	if (declaration.kind === 'TopLevelLetDeclaration') {
		const id = next();
		return {
			...declaration,
			id,
			name: localName,
			public: false,
			attributes: [],
			...(declaration.annotation === undefined ? {} : { annotation: cloneTypeReference(declaration.annotation, rename, next) }),
			value: { id: next(), kind: 'LiteralExpression', span: declaration.span, literalKind: 'Bool', value: false },
		};
	}
	if (declaration.kind !== 'FunctionDeclaration') throw new Error(`Declaration ${declaration.kind} cannot be imported as a value signature`);
	const id = next();
	return {
		...declaration,
		id,
		name: localName,
		public: false,
		attributes: [],
		parameters: declaration.parameters.map(parameter => ({ ...parameter, type: cloneTypeReference(parameter.type, rename, next) })),
		...(declaration.returnType === undefined ? {} : { returnType: cloneTypeReference(declaration.returnType, rename, next) }),
		effects: declaration.effects,
		body: { id: next(), kind: 'LiteralExpression', span: declaration.span, literalKind: 'Bool', value: false },
		expressionBody: true,
	};
}

function cloneTypeSignature(
	declaration: A.RecordDeclaration | A.EnumDeclaration | A.NewtypeDeclaration | A.TypeAliasDeclaration,
	localName: string,
	definitionId: string,
	rename: ReadonlyMap<string, string>,
	next: () => number,
): A.Declaration {
	const id = next();
	switch (declaration.kind) {
		case 'RecordDeclaration': return { ...declaration, id, name: localName, definitionId, public: false, attributes: [], fields: declaration.fields.map(field => ({ ...field, type: cloneTypeReference(field.type, rename, next), attributes: [] })) };
		case 'EnumDeclaration': return { ...declaration, id, name: localName, definitionId, public: false, attributes: [], variants: declaration.variants.map(variant => ({ ...variant, values: variant.values.map(value => cloneTypeReference(value, rename, next)) })) };
		case 'NewtypeDeclaration': return { ...declaration, id, name: localName, definitionId, public: false, attributes: [], underlying: cloneTypeReference(declaration.underlying, rename, next) };
		case 'TypeAliasDeclaration': return { ...declaration, id, name: localName, definitionId, public: false, attributes: [], target: cloneTypeReference(declaration.target, rename, next) };
	}
}

function cloneTypeReference(reference: A.TypeReferenceNode, rename: ReadonlyMap<string, string>, next: () => number): A.TypeReferenceNode {
	return {
		id: next(), kind: 'TypeReference', span: reference.span, name: rename.get(reference.name) ?? reference.name,
		arguments: reference.arguments.map(argument => cloneTypeReference(argument, rename, next)), optional: reference.optional,
		...(reference.functionType === undefined ? {} : { functionType: {
			async: reference.functionType.async,
			parameters: reference.functionType.parameters.map(parameter => cloneTypeReference(parameter, rename, next)),
			result: cloneTypeReference(reference.functionType.result, rename, next),
			effects: reference.functionType.effects,
		} }),
	};
}

function hiddenImportName(root: string, dependencyPath: string, name: string): string {
	const hash = createHash('sha256').update(moduleIdentity(root, dependencyPath)).digest('hex').slice(0, 10);
	return `$import_${hash}_${name}`;
}

function moduleIdentity(root: string, path: string): string {
	const relativePath = relative(root, path).replaceAll('\\', '/');
	return relativePath.startsWith('../') ? `external:${createHash('sha256').update(path).digest('hex').slice(0, 16)}` : `project:${relativePath}`;
}

function validatePublicApi(module: A.ModuleNode, diagnostics: DiagnosticBag): void {
	const localTypes = new Map(module.declarations.filter(isTypeDeclaration).map(declaration => [declaration.name, declaration]));
	for (const declaration of module.declarations) {
		if (!('public' in declaration) || declaration.public !== true || declaration.kind === 'NewtypeDeclaration') continue;
		for (const name of referencedTypeNames(declaration)) {
			const local = localTypes.get(name);
			if (local !== undefined && !local.public) diagnostics.error('L4010', `Public declaration ${declaration.name} exposes private type ${name}`, declaration.span);
		}
	}
}


function finitePosition(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function lineAt(text: string, offset: number): number {
	let line = 1;
	for (let index = 0; index < offset; index++) if (text[index] === '\n') line++;
	return line;
}

function columnAt(text: string, offset: number): number {
	return offset - text.lastIndexOf('\n', Math.max(0, offset - 1));
}

function spanAt(fileId: FileId, offset: number, length: number, line: number, column: number): SourceSpan {
	return { fileId, start: { offset, line, column }, end: { offset: offset + length, line, column: column + length } };
}
