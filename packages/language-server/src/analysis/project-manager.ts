import { access, readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { IncrementalProjectBuilder, type BuiltModule, type ProjectBuildResult, type ProjectHost, type SourceFile } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '@virune/js-interop';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { filePathToUri, uriToFilePath } from './position.js';
import { createProjectSemanticIndex, type ProjectSemanticIndex } from './semantic-index.js';

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

export interface ProjectManagerOptions {
	readonly getOpenDocuments: () => readonly TextDocument[];
	readonly workspaceFolders?: readonly string[];
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

interface PendingBuild {
	readonly key: string;
	readonly promise: Promise<ProjectCore>;
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
	readonly #cache = new Map<string, CachedProject>();
	readonly #pendingBuilds = new Map<string, PendingBuild>();
	readonly #builders = new Map<string, IncrementalProjectBuilder>();
	readonly #buildTails = new Map<string, Promise<void>>();
	readonly #interopProviders = new Map<string, TypeScriptInteropProvider>();
	readonly #workspaceEntries = new Map<string, readonly string[]>();
	#revision = 0;

	public constructor(options: ProjectManagerOptions) {
		this.#getOpenDocuments = options.getOpenDocuments;
		this.#workspaceFolders = (options.workspaceFolders ?? []).map(folder => resolve(folder));
	}

	public invalidate(): void {
		this.#revision++;
		this.#cache.clear();
		this.#pendingBuilds.clear();
		this.#workspaceEntries.clear();
	}

	/**
	 * Analyze only the requested document, its imports, and open overlays. This path intentionally skips the project-wide semantic
	 * index so latency-sensitive editor requests such as Hover remain responsive.
	 */
	public async analyzeDocument(uri: string): Promise<DocumentAnalysisSnapshot | undefined> {
		const analysis = await this.#analyzeCore(uri, 'document');
		return analysis === undefined ? undefined : this.#documentSnapshot(analysis);
	}

	/**
	 * Analyze the complete workspace and create the project-wide semantic index.
	 * Navigation, references, rename, CodeLens, workspace symbols, and auto-import
	 * use this path because they require symbols from files outside the import graph.
	 */
	public async analyzeDocumentIndexed(uri: string): Promise<AnalysisSnapshot | undefined> {
		return this.#analyzeIndexed(uri, 'document');
	}

	public async analyze(uri: string): Promise<AnalysisSnapshot | undefined> {
		return this.#analyzeIndexed(uri, 'workspace');
	}

	public async analyzeWorkspace(): Promise<readonly AnalysisSnapshot[]> {
		const snapshots = new Map<string, AnalysisSnapshot>();
		for (const folder of this.#workspaceFolders) {
			const entry = await findViruneEntry(folder);
			if (entry === undefined) continue;
			const snapshot = await this.analyze(filePathToUri(entry));
			if (snapshot !== undefined) snapshots.set(snapshot.root, snapshot);
		}
		for (const cached of this.#cache.values()) {
			if (snapshots.has(cached.core.root)) continue;
			const entry = cached.core.modulesByPath.keys().next().value as string | undefined;
			if (entry === undefined) continue;
			const snapshot = await this.analyze(filePathToUri(entry));
			if (snapshot !== undefined) snapshots.set(snapshot.root, snapshot);
		}
		return [...snapshots.values()];
	}

	async #analyzeIndexed(uri: string, scope: AnalysisScope): Promise<AnalysisSnapshot | undefined> {
		const analysis = await this.#analyzeCore(uri, scope);
		if (analysis === undefined) return undefined;
		const cached = this.#cache.get(analysis.cacheId);
		if (cached === undefined || cached.key !== analysis.cacheKey) return undefined;
		const existing = cached.snapshots.get(analysis.requestedPath);
		if (existing !== undefined) return existing;
		const index = await this.#semanticIndex(analysis, cached);
		const snapshot = { ...this.#documentSnapshot(analysis), index } satisfies AnalysisSnapshot;
		cached.snapshots.set(analysis.requestedPath, snapshot);
		return snapshot;
	}

	async #analyzeCore(uri: string, scope: AnalysisScope): Promise<ResolvedAnalysis | undefined> {
		const requestedPath = uriToFilePath(uri);
		if (requestedPath === undefined) return undefined;
		const normalizedPath = resolve(requestedPath);
		const { root, hasConfig } = await this.#findProjectRoot(normalizedPath);
		const openDocuments = this.#getOpenDocuments();
		const overlays = new Map<string, string>();
		const additionalEntries = new Set<string>([normalizedPath]);
		if (scope === 'workspace' && (hasConfig || this.#workspaceFolders.includes(root))) {
			for (const entry of await this.#projectEntries(root)) additionalEntries.add(entry);
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
		const cacheKey = `${hasConfig ? 'config' : 'standalone'}|${[...additionalEntries].sort().join('|')}|${documentVersions.sort().join('|')}`;
		const cached = this.#cache.get(cacheId);
		if (cached?.key === cacheKey) return { cacheId, cacheKey, requestedPath: normalizedPath, core: cached.core };
		const pending = this.#pendingBuilds.get(cacheId);
		if (pending?.key === cacheKey) {
			const core = await pending.promise;
			return { cacheId, cacheKey, requestedPath: normalizedPath, core };
		}

		const revision = this.#revision;
		const promise = this.#buildCore(cacheId, root, scope === 'workspace' && hasConfig, additionalEntries, overlays);
		this.#pendingBuilds.set(cacheId, { key: cacheKey, promise });
		try {
			const core = await promise;
			const current = this.#pendingBuilds.get(cacheId);
			if (this.#revision === revision && current?.key === cacheKey) {
				this.#cache.set(cacheId, {
					key: cacheKey,
					core,
					documentSnapshots: new Map(),
					snapshots: new Map(),
				});
			}
			return { cacheId, cacheKey, requestedPath: normalizedPath, core };
		} finally {
			if (this.#pendingBuilds.get(cacheId)?.key === cacheKey) this.#pendingBuilds.delete(cacheId);
		}
	}

	async #buildCore(
		cacheId: string,
		root: string,
		includeConfigEntry: boolean,
		additionalEntries: ReadonlySet<string>,
		overlays: ReadonlyMap<string, string>,
	): Promise<ProjectCore> {
		const previous = this.#buildTails.get(cacheId) ?? Promise.resolve();
		const promise = previous.then(
			() => this.#performBuild(cacheId, root, includeConfigEntry, additionalEntries, overlays),
			() => this.#performBuild(cacheId, root, includeConfigEntry, additionalEntries, overlays),
		);
		const tail = promise.then(() => undefined, () => undefined);
		this.#buildTails.set(cacheId, tail);
		void tail.then(() => {
			if (this.#buildTails.get(cacheId) === tail) this.#buildTails.delete(cacheId);
		});
		return promise;
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
		const builder = this.#builders.get(cacheId) ?? new IncrementalProjectBuilder();
		this.#builders.set(cacheId, builder);
		const jsInteropProvider = this.#interopProviders.get(root) ?? new TypeScriptInteropProvider({ projectRoot: root });
		this.#interopProviders.set(root, jsInteropProvider);
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

	async #semanticIndex(analysis: ResolvedAnalysis, cached: CachedProject): Promise<ProjectSemanticIndex> {
		if (cached.index !== undefined) return cached.index;
		if (cached.indexPromise !== undefined) return cached.indexPromise;
		const promise = createProjectSemanticIndex({
			root: analysis.core.root,
			modulesByPath: analysis.core.modulesByPath,
			sourcesById: analysis.core.sourcesById,
		});
		cached.indexPromise = promise;
		try {
			const index = await promise;
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
		const cached = this.#workspaceEntries.get(root);
		if (cached !== undefined) return cached;
		const entries = await findViruneEntries(root);
		this.#workspaceEntries.set(root, entries);
		return entries;
	}

	async #findProjectRoot(path: string): Promise<{ readonly root: string; readonly hasConfig: boolean }> {
		let current = dirname(path);
		while (true) {
			try {
				await access(join(current, 'virune.json'));
				return { root: current, hasConfig: true };
			} catch {
				const parent = dirname(current);
				if (parent === current) break;
				current = parent;
			}
		}
		const workspace = this.#workspaceFolders
			.filter(folder => isWithin(folder, path))
			.sort((left, right) => right.length - left.length)[0];
		return { root: workspace ?? dirname(path), hasConfig: false };
	}
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

function isWithin(parent: string, child: string): boolean {
	const value = relative(parent, child);
	return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

async function findViruneEntry(root: string): Promise<string | undefined> {
	return (await findViruneEntries(root))[0];
}

async function findViruneEntries(root: string): Promise<readonly string[]> {
	const result: string[] = [];
	const queue = [root];
	while (queue.length > 0) {
		const directory = queue.shift()!;
		let entries: Dirent[];
		try { entries = await readdir(directory, { withFileTypes: true }); }
		catch { continue; }
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'release') continue;
			const path = join(directory, entry.name);
			if (entry.isFile() && entry.name.endsWith('.virune')) result.push(resolve(path));
			if (entry.isDirectory()) queue.push(path);
		}
	}
	return result;
}
