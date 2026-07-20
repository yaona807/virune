import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { IncrementalProjectBuilder, type BuiltModule, type ProjectBuildResult, type ProjectHost, type SourceFile } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '@virune/js-interop';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { uriToFilePath } from './position.js';

export interface AnalysisSnapshot {
	readonly root: string;
	readonly requestedPath: string;
	readonly result: ProjectBuildResult;
	readonly modulesByPath: ReadonlyMap<string, BuiltModule>;
	readonly sourcesById: ReadonlyMap<number, SourceFile>;
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

	public constructor(options: ProjectManagerOptions) {
		this.#getOpenDocuments = options.getOpenDocuments;
		this.#workspaceFolders = (options.workspaceFolders ?? []).map(folder => resolve(folder));
	}

	public invalidate(): void {
		this.#cache.clear();
	}

	public async analyze(uri: string): Promise<AnalysisSnapshot | undefined> {
		const requestedPath = uriToFilePath(uri);
		if (requestedPath === undefined) return undefined;
		const normalizedPath = resolve(requestedPath);
		const { root, hasConfig } = await this.#findProjectRoot(normalizedPath);
		const openDocuments = this.#getOpenDocuments();
		const overlays = new Map<string, string>();
		const additionalEntries = new Set<string>([normalizedPath]);
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
		const snapshot = { root, requestedPath: normalizedPath, result, modulesByPath, sourcesById } satisfies AnalysisSnapshot;
		this.#cache.set(root, { key: cacheKey, snapshot });
		return snapshot;
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
