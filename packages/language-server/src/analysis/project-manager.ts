import { access, readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { IncrementalProjectBuilder, type BuiltModule, type ProjectBuildResult, type ProjectHost, type SourceFile } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '@virune/js-interop';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { filePathToUri, uriToFilePath } from './position.js';
import { createProjectSemanticIndex, type ProjectSemanticIndex } from './semantic-index.js';

export interface AnalysisSnapshot {
	readonly root: string;
	readonly requestedPath: string;
	readonly result: ProjectBuildResult;
	readonly modulesByPath: ReadonlyMap<string, BuiltModule>;
	readonly sourcesById: ReadonlyMap<number, SourceFile>;
	readonly index: ProjectSemanticIndex;
}

export interface ProjectManagerOptions {
	readonly getOpenDocuments: () => readonly TextDocument[];
	readonly workspaceFolders?: readonly string[];
}

export class ProjectManager {
	readonly #getOpenDocuments: () => readonly TextDocument[];
	readonly #workspaceFolders: readonly string[];
	readonly #cache = new Map<string, { readonly key: string; readonly snapshot: AnalysisSnapshot }>();
	readonly #builders = new Map<string, IncrementalProjectBuilder>();
	readonly #interopProviders = new Map<string, TypeScriptInteropProvider>();
	readonly #workspaceEntries = new Map<string, readonly string[]>();

	public constructor(options: ProjectManagerOptions) {
		this.#getOpenDocuments = options.getOpenDocuments;
		this.#workspaceFolders = (options.workspaceFolders ?? []).map(folder => resolve(folder));
	}

	public invalidate(): void {
		this.#cache.clear();
		this.#workspaceEntries.clear();
	}

	public async analyze(uri: string): Promise<AnalysisSnapshot | undefined> {
		const requestedPath = uriToFilePath(uri);
		if (requestedPath === undefined) return undefined;
		const normalizedPath = resolve(requestedPath);
		const { root, hasConfig } = await this.#findProjectRoot(normalizedPath);
		const openDocuments = this.#getOpenDocuments();
		const overlays = new Map<string, string>();
		const additionalEntries = new Set<string>([normalizedPath]);
		const discoverWorkspaceSources = hasConfig || this.#workspaceFolders.includes(root);
		if (discoverWorkspaceSources) {
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
		const cacheKey = `${hasConfig ? 'config' : 'standalone'}|${[...additionalEntries].sort().join('|')}|${documentVersions.sort().join('|')}`;
		const cached = this.#cache.get(root);
		if (cached?.key === cacheKey) return cached.snapshot;
		const host: ProjectHost = {
			readFile: async path => overlays.get(resolve(path)) ?? readFile(path, 'utf8'),
		};
		const builder = this.#builders.get(root) ?? new IncrementalProjectBuilder();
		this.#builders.set(root, builder);
		const jsInteropProvider = this.#interopProviders.get(root) ?? new TypeScriptInteropProvider({ projectRoot: root });
		this.#interopProviders.set(root, jsInteropProvider);
		const result = await builder.build(root, {
			write: false,
			additionalEntries: [...additionalEntries],
			host,
			includeConfigEntry: hasConfig,
			jsInteropProvider,
		});
		const modulesByPath = new Map<string, BuiltModule>();
		const sourcesById = new Map<number, SourceFile>();
		for (const module of result.modules) {
			modulesByPath.set(resolve(module.source.path), module);
			sourcesById.set(module.source.id, module.source);
		}
		const index = await createProjectSemanticIndex({ root, modulesByPath, sourcesById });
		const snapshot = { root, requestedPath: normalizedPath, result, modulesByPath, sourcesById, index } satisfies AnalysisSnapshot;
		this.#cache.set(root, { key: cacheKey, snapshot });
		return snapshot;
	}

	public async analyzeWorkspace(): Promise<readonly AnalysisSnapshot[]> {
		const snapshots = new Map<string, AnalysisSnapshot>();
		for (const cached of this.#cache.values()) snapshots.set(cached.snapshot.root, cached.snapshot);
		for (const folder of this.#workspaceFolders) {
			if (snapshots.has(folder)) continue;
			const entry = await findViruneEntry(folder);
			if (entry === undefined) continue;
			const snapshot = await this.analyze(filePathToUri(entry));
			if (snapshot !== undefined) snapshots.set(snapshot.root, snapshot);
		}
		return [...snapshots.values()];
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
