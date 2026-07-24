import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IncrementalProjectBuilder, type BuiltModule, type ProjectBuildResult, type ProjectHost, type SourceFile } from '@virune/compiler/experimental';
import { CachedTypeScriptInteropProvider } from '@virune/js-interop/cached-provider';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { filePathToUri, uriToFilePath } from './position.js';
import { createProjectSemanticIndex, type ProjectSemanticIndex } from './semantic-index.js';
import { findProjectRoot, findViruneEntries, findViruneEntry, isWithin, type ResolvedProjectRoot } from './workspace-discovery.js';

export interface AnalysisCancellationToken {
	readonly isCancellationRequested: boolean;
}

export interface DocumentAnalysisSnapshot {
	readonly root: string;
	readonly requestedPath: string;
	readonly result: ProjectBuildResult;
	readonly modulesByPath: ReadonlyMap<string, BuiltModule>;
	readonly sourcesById: ReadonlyMap<number, SourceFile>;
}

export interface AnalysisSnapshot extends DocumentAnalysisSnapshot {
	readonly index: ProjectSemanticIndex;
}

type ProjectBuilder = Pick<IncrementalProjectBuilder, 'build'>;
type SemanticIndexFactory = typeof createProjectSemanticIndex;
type InteropProviderFactory = (root: string, generation: number) => CachedTypeScriptInteropProvider;

export interface ProjectManagerOptions {
	readonly getOpenDocuments: () => readonly TextDocument[];
	readonly workspaceFolders?: readonly string[];
	readonly createBuilder?: () => ProjectBuilder;
	readonly createSemanticIndex?: SemanticIndexFactory;
	readonly createInteropProvider?: InteropProviderFactory;
}

export interface ProjectInvalidationOptions {
	readonly workspaceEntries?: boolean;
	readonly interop?: boolean;
	readonly projectRoots?: boolean;
}

type AnalysisScope = 'document' | 'workspace';

interface ProjectCore {
	readonly root: string;
	readonly result: ProjectBuildResult;
	readonly modulesByPath: ReadonlyMap<string, BuiltModule>;
	readonly sourcesById: ReadonlyMap<number, SourceFile>;
}

interface CachedProject {
	readonly key: string;
	readonly core: ProjectCore;
	readonly documentSnapshots: Map<string, DocumentAnalysisSnapshot>;
	readonly snapshots: Map<string, AnalysisSnapshot>;
	index?: ProjectSemanticIndex;
	indexPromise?: Promise<ProjectSemanticIndex>;
}

interface BuildRequest {
	readonly key: string;
	readonly root: string;
	readonly includeConfigEntry: boolean;
	readonly additionalEntries: readonly string[];
	readonly overlays: ReadonlyMap<string, string>;
	readonly promise: Promise<ProjectCore | undefined>;
	readonly resolve: (core: ProjectCore | undefined) => void;
	readonly reject: (error: unknown) => void;
}

interface BuildLane {
	running: BuildRequest | undefined;
	queued: BuildRequest | undefined;
}

interface ResolvedAnalysis {
	readonly cacheId: string;
	readonly cacheKey: string;
	readonly requestedPath: string;
	readonly core: ProjectCore;
}

export class ProjectManager {
	readonly #getOpenDocuments: () => readonly TextDocument[];
	readonly #workspaceFolders: readonly string[];
	readonly #createBuilder: () => ProjectBuilder;
	readonly #createSemanticIndex: SemanticIndexFactory;
	readonly #createInteropProvider: InteropProviderFactory;
	readonly #cache = new Map<string, CachedProject>();
	readonly #builders = new Map<string, ProjectBuilder>();
	readonly #buildLanes = new Map<string, BuildLane>();
	readonly #latestBuildKeys = new Map<string, string>();
	readonly #interopProviders = new Map<string, CachedTypeScriptInteropProvider>();
	readonly #interopGenerations = new Map<string, number>();
	readonly #workspaceEntries = new Map<string, readonly string[]>();
	readonly #projectRoots = new Map<string, ResolvedProjectRoot>();
	#revision = 0;

	public constructor(options: ProjectManagerOptions) {
		this.#getOpenDocuments = options.getOpenDocuments;
		this.#workspaceFolders = (options.workspaceFolders ?? []).map(folder => resolve(folder));
		this.#createBuilder = options.createBuilder ?? (() => new IncrementalProjectBuilder());
		this.#createSemanticIndex = options.createSemanticIndex ?? createProjectSemanticIndex;
		this.#createInteropProvider = options.createInteropProvider
			?? ((root, generation) => new CachedTypeScriptInteropProvider({ projectRoot: root, generation }));
	}

	public invalidate(): void {
		this.#revision++;
		this.#cache.clear();
		this.#latestBuildKeys.clear();
		this.#workspaceEntries.clear();
		this.#projectRoots.clear();
		for (const lane of this.#buildLanes.values()) {
			lane.queued?.resolve(undefined);
			lane.queued = undefined;
		}
		for (const [root, provider] of this.#interopProviders) {
			provider.dispose();
			this.#interopGenerations.set(root, provider.generation + 1);
		}
		this.#interopProviders.clear();
	}

	public invalidateProject(root: string, options: ProjectInvalidationOptions = {}): void {
		const normalizedRoot = resolve(root);
		this.#revision++;
		for (const cacheId of [...this.#cache.keys()]) {
			if (cacheId.startsWith(`${normalizedRoot}\0`)) this.#cache.delete(cacheId);
		}
		for (const cacheId of [...this.#latestBuildKeys.keys()]) {
			if (cacheId.startsWith(`${normalizedRoot}\0`)) this.#latestBuildKeys.delete(cacheId);
		}
		for (const [cacheId, lane] of this.#buildLanes) {
			if (!cacheId.startsWith(`${normalizedRoot}\0`)) continue;
			lane.queued?.resolve(undefined);
			lane.queued = undefined;
		}
		if (options.workspaceEntries === true) this.#workspaceEntries.delete(normalizedRoot);
		if (options.projectRoots === true) {
			for (const [path, resolvedRoot] of this.#projectRoots) {
				if (resolvedRoot.root === normalizedRoot || isWithin(normalizedRoot, path)) this.#projectRoots.delete(path);
			}
		}
		if (options.interop === true) this.#rotateInteropGeneration(normalizedRoot);
	}

	public async projectRootForUri(uri: string): Promise<string | undefined> {
		const path = uriToFilePath(uri);
		return path === undefined ? undefined : this.projectRootForPath(path);
	}

	public async projectRootForPath(path: string): Promise<string> {
		return (await this.#findProjectRoot(resolve(path))).root;
	}

	public hasInteropProvider(root: string): boolean {
		return this.#interopProviders.has(resolve(root));
	}

	public interopGeneration(root: string): number {
		const normalizedRoot = resolve(root);
		return this.#interopProviders.get(normalizedRoot)?.generation ?? this.#interopGenerations.get(normalizedRoot) ?? 1;
	}

	public async analyzeDocument(uri: string, token?: AnalysisCancellationToken): Promise<DocumentAnalysisSnapshot | undefined> {
		const analysis = await this.#analyzeCore(uri, 'document', token);
		return analysis === undefined || isCancelled(token) ? undefined : this.#documentSnapshot(analysis);
	}

	public async analyzeDocumentIndexed(uri: string, token?: AnalysisCancellationToken): Promise<AnalysisSnapshot | undefined> {
		return this.#analyzeIndexed(uri, 'document', token);
	}

	public async analyzeWorkspaceDocument(uri: string, token?: AnalysisCancellationToken): Promise<DocumentAnalysisSnapshot | undefined> {
		const analysis = await this.#analyzeCore(uri, 'workspace', token);
		return analysis === undefined || isCancelled(token) ? undefined : this.#documentSnapshot(analysis);
	}

	public async analyze(uri: string, token?: AnalysisCancellationToken): Promise<AnalysisSnapshot | undefined> {
		return this.#analyzeIndexed(uri, 'workspace', token);
	}

	public async analyzeWorkspace(token?: AnalysisCancellationToken): Promise<readonly AnalysisSnapshot[]> {
		const snapshots = new Map<string, AnalysisSnapshot>();
		for (const folder of this.#workspaceFolders) {
			if (isCancelled(token)) break;
			const entry = await findViruneEntry(folder);
			if (entry === undefined || isCancelled(token)) continue;
			const snapshot = await this.analyze(filePathToUri(entry), token);
			if (snapshot !== undefined) snapshots.set(snapshot.root, snapshot);
		}
		for (const cached of this.#cache.values()) {
			if (isCancelled(token)) break;
			if (snapshots.has(cached.core.root)) continue;
			const entry = cached.core.modulesByPath.keys().next().value as string | undefined;
			if (entry === undefined) continue;
			const snapshot = await this.analyze(filePathToUri(entry), token);
			if (snapshot !== undefined) snapshots.set(snapshot.root, snapshot);
		}
		return [...snapshots.values()];
	}

	async #analyzeIndexed(uri: string, scope: AnalysisScope, token?: AnalysisCancellationToken): Promise<AnalysisSnapshot | undefined> {
		const analysis = await this.#analyzeCore(uri, scope, token);
		if (analysis === undefined || isCancelled(token)) return undefined;
		const cached = this.#cache.get(analysis.cacheId);
		if (cached === undefined || cached.key !== analysis.cacheKey) return undefined;
		const existing = cached.snapshots.get(analysis.requestedPath);
		if (existing !== undefined) return existing;
		const index = await this.#semanticIndex(analysis, cached, token);
		if (index === undefined || isCancelled(token)) return undefined;
		const snapshot = { ...this.#documentSnapshot(analysis), index } satisfies AnalysisSnapshot;
		cached.snapshots.set(analysis.requestedPath, snapshot);
		return snapshot;
	}

	async #analyzeCore(uri: string, scope: AnalysisScope, token?: AnalysisCancellationToken): Promise<ResolvedAnalysis | undefined> {
		if (isCancelled(token)) return undefined;
		const requestedPath = uriToFilePath(uri);
		if (requestedPath === undefined) return undefined;
		const normalizedPath = resolve(requestedPath);
		const { root, hasConfig } = await this.#findProjectRoot(normalizedPath);
		if (isCancelled(token)) return undefined;
		const openDocuments = this.#getOpenDocuments();
		const overlays = new Map<string, string>();
		const additionalEntries = new Set<string>([normalizedPath]);
		if (scope === 'workspace' && (hasConfig || this.#workspaceFolders.includes(root))) {
			for (const entry of await this.#projectEntries(root)) additionalEntries.add(entry);
			if (isCancelled(token)) return undefined;
		}
		const documentVersions: string[] = [];
		for (const document of openDocuments) {
			const path = uriToFilePath(document.uri);
			if (path === undefined) continue;
			const normalizedDocumentPath = resolve(path);
			if (!isWithin(root, normalizedDocumentPath)) continue;
			overlays.set(normalizedDocumentPath, document.getText());
			additionalEntries.add(normalizedDocumentPath);
			documentVersions.push(`${normalizedDocumentPath}:${document.version}`);
		}
		const cacheId = `${root}\0${scope}`;
		const cacheKey = `${hasConfig ? 'config' : 'standalone'}|${this.interopGeneration(root)}|${[...additionalEntries].sort().join('|')}|${documentVersions.sort().join('|')}`;
		const cached = this.#cache.get(cacheId);
		if (cached?.key === cacheKey) return { cacheId, cacheKey, requestedPath: normalizedPath, core: cached.core };
		if (isCancelled(token)) return undefined;

		const revision = this.#revision;
		const core = await this.#scheduleBuild(cacheId, cacheKey, root, scope === 'workspace' && hasConfig, additionalEntries, overlays);
		if (core === undefined || isCancelled(token) || this.#latestBuildKeys.get(cacheId) !== cacheKey) return undefined;
		if (this.#revision === revision) {
			this.#cache.set(cacheId, {
				key: cacheKey,
				core,
				documentSnapshots: new Map(),
				snapshots: new Map(),
			});
		}
		return { cacheId, cacheKey, requestedPath: normalizedPath, core };
	}

	#scheduleBuild(
		cacheId: string,
		key: string,
		root: string,
		includeConfigEntry: boolean,
		additionalEntries: ReadonlySet<string>,
		overlays: ReadonlyMap<string, string>,
	): Promise<ProjectCore | undefined> {
		this.#latestBuildKeys.set(cacheId, key);
		const lane = this.#buildLanes.get(cacheId) ?? { running: undefined, queued: undefined };
		this.#buildLanes.set(cacheId, lane);
		if (lane.running?.key === key) return lane.running.promise;
		if (lane.queued?.key === key) return lane.queued.promise;
		let resolveRequest!: (core: ProjectCore | undefined) => void;
		let rejectRequest!: (error: unknown) => void;
		const promise = new Promise<ProjectCore | undefined>((resolvePromise, rejectPromise) => {
			resolveRequest = resolvePromise;
			rejectRequest = rejectPromise;
		});
		const request: BuildRequest = {
			key,
			root,
			includeConfigEntry,
			additionalEntries: [...additionalEntries],
			overlays: new Map(overlays),
			promise,
			resolve: resolveRequest,
			reject: rejectRequest,
		};
		if (lane.running === undefined) {
			lane.running = request;
			void this.#runBuild(cacheId, lane, request);
		} else {
			lane.queued?.resolve(undefined);
			lane.queued = request;
		}
		return promise;
	}

	async #runBuild(cacheId: string, lane: BuildLane, request: BuildRequest): Promise<void> {
		try {
			const core = await this.#performBuild(
				cacheId,
				request.root,
				request.includeConfigEntry,
				new Set(request.additionalEntries),
				request.overlays,
			);
			request.resolve(core);
		} catch (error) {
			request.reject(error);
		} finally {
			if (lane.running === request) lane.running = undefined;
			const next = lane.queued;
			lane.queued = undefined;
			if (next !== undefined) {
				lane.running = next;
				void this.#runBuild(cacheId, lane, next);
			} else if (this.#buildLanes.get(cacheId) === lane) {
				this.#buildLanes.delete(cacheId);
			}
		}
	}

	async #performBuild(
		cacheId: string,
		root: string,
		includeConfigEntry: boolean,
		additionalEntries: ReadonlySet<string>,
		overlays: ReadonlyMap<string, string>,
	): Promise<ProjectCore> {
		const host: ProjectHost = {
			readFile: async path => overlays.get(resolve(path)) ?? readFile(path, 'utf8'),
		};
		const builder = this.#builders.get(cacheId) ?? this.#createBuilder();
		this.#builders.set(cacheId, builder);
		const normalizedRoot = resolve(root);
		const generation = this.#interopGenerations.get(normalizedRoot) ?? 1;
		const jsInteropProvider = this.#interopProviders.get(normalizedRoot) ?? this.#createInteropProvider(normalizedRoot, generation);
		this.#interopProviders.set(normalizedRoot, jsInteropProvider);
		const result = await builder.build(root, {
			write: false,
			additionalEntries: [...additionalEntries],
			host,
			includeConfigEntry,
			jsInteropProvider,
		});
		const modulesByPath = new Map<string, BuiltModule>();
		const sourcesById = new Map<number, SourceFile>();
		for (const module of result.modules) {
			modulesByPath.set(resolve(module.source.path), module);
			sourcesById.set(module.source.id, module.source);
		}
		return { root, result, modulesByPath, sourcesById };
	}

	async #semanticIndex(
		analysis: ResolvedAnalysis,
		cached: CachedProject,
		token?: AnalysisCancellationToken,
	): Promise<ProjectSemanticIndex | undefined> {
		if (isCancelled(token)) return undefined;
		if (cached.index !== undefined) return cached.index;
		if (cached.indexPromise !== undefined) {
			const index = await cached.indexPromise;
			return isCancelled(token) ? undefined : index;
		}
		const promise = this.#createSemanticIndex({
			root: analysis.core.root,
			modulesByPath: analysis.core.modulesByPath,
			sourcesById: analysis.core.sourcesById,
		});
		cached.indexPromise = promise;
		try {
			const index = await promise;
			if (isCancelled(token)) return undefined;
			const current = this.#cache.get(analysis.cacheId);
			if (current?.key === analysis.cacheKey) {
				current.index = index;
				delete current.indexPromise;
			}
			return index;
		} catch (error) {
			if (this.#cache.get(analysis.cacheId)?.key === analysis.cacheKey) delete cached.indexPromise;
			throw error;
		}
	}

	#documentSnapshot(analysis: ResolvedAnalysis): DocumentAnalysisSnapshot {
		const cached = this.#cache.get(analysis.cacheId);
		if (cached?.key === analysis.cacheKey) {
			const existing = cached.documentSnapshots.get(analysis.requestedPath);
			if (existing !== undefined) return existing;
			const snapshot = createDocumentSnapshot(analysis);
			cached.documentSnapshots.set(analysis.requestedPath, snapshot);
			return snapshot;
		}
		return createDocumentSnapshot(analysis);
	}

	async #projectEntries(root: string): Promise<readonly string[]> {
		const normalizedRoot = resolve(root);
		const cached = this.#workspaceEntries.get(normalizedRoot);
		if (cached !== undefined) return cached;
		const entries = await findViruneEntries(normalizedRoot);
		this.#workspaceEntries.set(normalizedRoot, entries);
		return entries;
	}

	async #findProjectRoot(path: string): Promise<ResolvedProjectRoot> {
		const normalizedPath = resolve(path);
		const cached = this.#projectRoots.get(normalizedPath);
		if (cached !== undefined) return cached;
		const result = await findProjectRoot(normalizedPath, this.#workspaceFolders);
		this.#projectRoots.set(normalizedPath, result);
		return result;
	}

	#rotateInteropGeneration(root: string): void {
		const provider = this.#interopProviders.get(root);
		const generation = provider?.generation ?? this.#interopGenerations.get(root) ?? 1;
		provider?.dispose();
		this.#interopProviders.delete(root);
		this.#interopGenerations.set(root, generation + 1);
	}
}

function isCancelled(token: AnalysisCancellationToken | undefined): boolean {
	return token?.isCancellationRequested === true;
}

function createDocumentSnapshot(analysis: ResolvedAnalysis): DocumentAnalysisSnapshot {
	return {
		root: analysis.core.root,
		requestedPath: analysis.requestedPath,
		result: analysis.core.result,
		modulesByPath: analysis.core.modulesByPath,
		sourcesById: analysis.core.sourcesById,
	};
}
