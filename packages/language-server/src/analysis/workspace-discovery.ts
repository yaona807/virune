import { access, readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export interface ResolvedProjectRoot {
	readonly root: string;
	readonly hasConfig: boolean;
}

interface WorkspaceDiscoveryConfig {
	readonly sourceDir?: unknown;
	readonly sourceRoots?: unknown;
	readonly additionalSourceDirs?: unknown;
	readonly testSourceDirs?: unknown;
	readonly exclude?: unknown;
}

const defaultExcludedDirectories = new Set([
	'.git',
	'.cache',
	'.turbo',
	'coverage',
	'dist',
	'node_modules',
	'out',
	'release',
	'temp',
	'tmp',
]);

export async function findProjectRoot(path: string, workspaceFolders: readonly string[]): Promise<ResolvedProjectRoot> {
	let current = dirname(resolve(path));
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
	const workspace = workspaceFolders
		.filter(folder => isWithin(folder, path))
		.sort((left, right) => right.length - left.length)[0];
	return { root: workspace ?? dirname(resolve(path)), hasConfig: false };
}

export async function findViruneEntry(root: string): Promise<string | undefined> {
	return (await findViruneEntries(root))[0];
}

export async function findViruneEntries(root: string): Promise<readonly string[]> {
	const normalizedRoot = resolve(root);
	const config = await readDiscoveryConfig(normalizedRoot);
	const sourceRoots = configuredSourceRoots(normalizedRoot, config);
	const exclusions = configuredExclusions(config);
	const result: string[] = [];
	const visited = new Set<string>();
	const queue = [...sourceRoots];
	while (queue.length > 0) {
		const directory = queue.shift()!;
		if (visited.has(directory) || !isWithin(normalizedRoot, directory)) continue;
		visited.add(directory);
		let entries: Dirent[];
		try { entries = await readdir(directory, { withFileTypes: true }); }
		catch { continue; }
		for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
			const path = resolve(directory, entry.name);
			const relativePath = normalizeRelative(relative(normalizedRoot, path));
			if (entry.isDirectory() && isExcludedDirectory(entry.name, relativePath, exclusions)) continue;
			if (entry.isFile() && entry.name.endsWith('.virune')) result.push(path);
			if (entry.isDirectory()) queue.push(path);
		}
	}
	return result.sort((left, right) => left.localeCompare(right));
}

export function isWithin(parent: string, child: string): boolean {
	const value = relative(resolve(parent), resolve(child));
	return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

async function readDiscoveryConfig(root: string): Promise<WorkspaceDiscoveryConfig | undefined> {
	try {
		const value: unknown = JSON.parse(await readFile(join(root, 'virune.json'), 'utf8'));
		return typeof value === 'object' && value !== null ? value as WorkspaceDiscoveryConfig : undefined;
	} catch {
		return undefined;
	}
}

function configuredSourceRoots(root: string, config: WorkspaceDiscoveryConfig | undefined): readonly string[] {
	const configured = new Set<string>();
	if (typeof config?.sourceDir === 'string' && config.sourceDir.length > 0) configured.add(config.sourceDir);
	for (const candidate of [config?.sourceRoots, config?.additionalSourceDirs, config?.testSourceDirs]) {
		if (!Array.isArray(candidate)) continue;
		for (const item of candidate) if (typeof item === 'string' && item.length > 0) configured.add(item);
	}
	if (configured.size === 0) configured.add('.');
	return [...configured]
		.map(path => resolve(root, path))
		.filter(path => isWithin(root, path));
}

function configuredExclusions(config: WorkspaceDiscoveryConfig | undefined): ReadonlySet<string> {
	const values = new Set<string>();
	if (Array.isArray(config?.exclude)) {
		for (const item of config.exclude) {
			if (typeof item !== 'string') continue;
			const normalized = normalizeRelative(item).replace(/\/$/u, '');
			if (normalized.length > 0) values.add(normalized);
		}
	}
	return values;
}

function isExcludedDirectory(name: string, relativePath: string, exclusions: ReadonlySet<string>): boolean {
	if (defaultExcludedDirectories.has(name)) return true;
	for (const exclusion of exclusions) {
		if (relativePath === exclusion || relativePath.startsWith(`${exclusion}/`)) return true;
	}
	return false;
}

function normalizeRelative(path: string): string {
	return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}
