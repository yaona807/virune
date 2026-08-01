import { normalizeKernelPath } from './contract.js';

export const MODULE_GRAPH_VERSION = 1 as const;

export type ModuleGraphSourceKind = 'virune' | 'javascript';

export interface ModuleGraphImportInput {
	readonly specifier: string;
	readonly sourceKind: ModuleGraphSourceKind;
	readonly resolvedPath?: string;
	readonly typeOnly: boolean;
	readonly public: boolean;
}

export interface ModuleGraphModuleInput {
	readonly path: string;
	readonly imports: readonly ModuleGraphImportInput[];
}

export interface ModuleGraphInput {
	readonly version: number;
	readonly entryPath: string;
	readonly modules: readonly ModuleGraphModuleInput[];
}

export interface CanonicalModuleGraphModule {
	readonly id: number;
	readonly path: string;
	readonly reachable: boolean;
}

export interface CanonicalModuleGraphEdge {
	readonly id: number;
	readonly fromModuleId: number;
	readonly sourceKind: ModuleGraphSourceKind;
	readonly specifier: string;
	readonly resolvedPath?: string;
	readonly targetModuleId?: number;
	readonly typeOnly: boolean;
	readonly public: boolean;
}

export type ModuleGraphIssueCode =
	| 'DUPLICATE_IMPORT'
	| 'IMPORT_CYCLE'
	| 'MISSING_ENTRY'
	| 'MISSING_TARGET'
	| 'SELF_IMPORT';

export interface ModuleGraphIssue {
	readonly code: ModuleGraphIssueCode;
	readonly modulePath: string;
	readonly specifier?: string;
	readonly cycle?: readonly string[];
}

export interface CanonicalModuleGraph {
	readonly version: typeof MODULE_GRAPH_VERSION;
	readonly accepted: boolean;
	readonly entryModuleId: number | null;
	readonly modules: readonly CanonicalModuleGraphModule[];
	readonly edges: readonly CanonicalModuleGraphEdge[];
	readonly reachableModuleIds: readonly number[];
	readonly unreachableModuleIds: readonly number[];
	readonly issues: readonly ModuleGraphIssue[];
}

export class ModuleGraphContractError extends Error {
	public override readonly name = 'ModuleGraphContractError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

type NormalizedImport = {
	readonly fromPath: string;
	readonly sourceKind: ModuleGraphSourceKind;
	readonly specifier: string;
	readonly resolvedPath?: string;
	readonly typeOnly: boolean;
	readonly public: boolean;
};

type NormalizedModule = {
	readonly path: string;
	readonly imports: readonly NormalizedImport[];
};

export function buildCanonicalModuleGraph(value: unknown): CanonicalModuleGraph {
	const input = record(value, '$');
	exactKeys(input, ['version', 'entryPath', 'modules'], '$');
	if (input.version !== MODULE_GRAPH_VERSION) {
		throw new ModuleGraphContractError('$.version', `expected ${MODULE_GRAPH_VERSION}`);
	}
	const entryPath = normalizePath(input.entryPath, '$.entryPath');
	const modules = array(input.modules, '$.modules')
		.map((module, index) => normalizeModule(module, `$.modules[${index}]`))
		.sort((left, right) => compareText(left.path, right.path));
	assertUnique(modules.map(module => module.path), '$.modules', 'module path');

	const moduleIds = new Map(modules.map((module, index) => [module.path, index] as const));
	const issues: ModuleGraphIssue[] = [];
	const normalizedEdges = modules.flatMap(module => module.imports);
	collectDuplicateImportIssues(modules, issues);

	const edges = [...normalizedEdges]
		.sort(compareImport)
		.map((edge, id): CanonicalModuleGraphEdge => {
			const fromModuleId = requiredModuleId(moduleIds, edge.fromPath);
			const targetModuleId = edge.sourceKind === 'virune' && edge.resolvedPath !== undefined
				? moduleIds.get(edge.resolvedPath)
				: undefined;
			if (edge.sourceKind === 'virune') {
				if (edge.resolvedPath === edge.fromPath) {
					issues.push({ code: 'SELF_IMPORT', modulePath: edge.fromPath, specifier: edge.specifier });
				} else if (targetModuleId === undefined) {
					issues.push({ code: 'MISSING_TARGET', modulePath: edge.fromPath, specifier: edge.specifier });
				}
			}
			return {
				id,
				fromModuleId,
				sourceKind: edge.sourceKind,
				specifier: edge.specifier,
				...(edge.resolvedPath === undefined ? {} : { resolvedPath: edge.resolvedPath }),
				...(targetModuleId === undefined ? {} : { targetModuleId }),
				typeOnly: edge.typeOnly,
				public: edge.public,
			};
		});

	const entryModuleId = moduleIds.get(entryPath) ?? null;
	if (entryModuleId === null) issues.push({ code: 'MISSING_ENTRY', modulePath: entryPath });
	const adjacency = buildAdjacency(modules.length, edges);
	for (const cycle of findCycles(adjacency, modules)) {
		issues.push({ code: 'IMPORT_CYCLE', modulePath: cycle[0]!, cycle });
	}
	const reachable = entryModuleId === null ? new Set<number>() : collectReachable(entryModuleId, adjacency);
	const canonicalModules = modules.map((module, id): CanonicalModuleGraphModule => ({
		id,
		path: module.path,
		reachable: reachable.has(id),
	}));
	const reachableModuleIds = canonicalModules.filter(module => module.reachable).map(module => module.id);
	const unreachableModuleIds = canonicalModules.filter(module => !module.reachable).map(module => module.id);
	const canonicalIssues = [...issues].sort(compareIssue);
	return {
		version: MODULE_GRAPH_VERSION,
		accepted: canonicalIssues.length === 0,
		entryModuleId,
		modules: canonicalModules,
		edges,
		reachableModuleIds,
		unreachableModuleIds,
		issues: canonicalIssues,
	};
}

function normalizeModule(value: unknown, path: string): NormalizedModule {
	const module = record(value, path);
	exactKeys(module, ['path', 'imports'], path);
	const modulePath = normalizePath(module.path, `${path}.path`);
	const imports = array(module.imports, `${path}.imports`).map((item, index) => {
		const importPath = `${path}.imports[${index}]`;
		const entry = record(item, importPath);
		exactKeys(entry, ['specifier', 'sourceKind', 'resolvedPath', 'typeOnly', 'public'], importPath, ['resolvedPath']);
		const sourceKind = oneOf(entry.sourceKind, ['virune', 'javascript'] as const, `${importPath}.sourceKind`);
		const specifier = nonEmptyString(entry.specifier, `${importPath}.specifier`);
		const resolvedPath = entry.resolvedPath === undefined
			? undefined
			: normalizePath(entry.resolvedPath, `${importPath}.resolvedPath`);
		if (sourceKind === 'virune' && resolvedPath === undefined) {
			throw new ModuleGraphContractError(`${importPath}.resolvedPath`, 'Virune imports require a resolvedPath');
		}
		return {
			fromPath: modulePath,
			sourceKind,
			specifier,
			...(resolvedPath === undefined ? {} : { resolvedPath }),
			typeOnly: boolean(entry.typeOnly, `${importPath}.typeOnly`),
			public: boolean(entry.public, `${importPath}.public`),
		};
	});
	return { path: modulePath, imports };
}

function collectDuplicateImportIssues(modules: readonly NormalizedModule[], issues: ModuleGraphIssue[]): void {
	for (const module of modules) {
		const keys = module.imports.map(importKey).sort(compareText);
		for (let index = 1; index < keys.length; index += 1) {
			if (keys[index] === keys[index - 1]) {
				const specifier = keys[index]!.split('\u0000', 1)[0]!;
				issues.push({ code: 'DUPLICATE_IMPORT', modulePath: module.path, specifier });
			}
		}
	}
}

function importKey(value: NormalizedImport): string {
	return [value.specifier, value.sourceKind, value.resolvedPath ?? '', String(value.typeOnly), String(value.public)].join('\u0000');
}

function compareImport(left: NormalizedImport, right: NormalizedImport): number {
	return compareText(left.fromPath, right.fromPath)
		|| compareText(left.sourceKind, right.sourceKind)
		|| compareText(left.specifier, right.specifier)
		|| compareText(left.resolvedPath ?? '', right.resolvedPath ?? '')
		|| Number(left.typeOnly) - Number(right.typeOnly)
		|| Number(left.public) - Number(right.public);
}

function buildAdjacency(moduleCount: number, edges: readonly CanonicalModuleGraphEdge[]): readonly number[][] {
	const adjacency = Array.from({ length: moduleCount }, () => [] as number[]);
	for (const edge of edges) {
		if (edge.sourceKind === 'virune' && edge.targetModuleId !== undefined) {
			adjacency[edge.fromModuleId]!.push(edge.targetModuleId);
		}
	}
	for (const targets of adjacency) targets.sort((left, right) => left - right);
	return adjacency;
}

function collectReachable(entryModuleId: number, adjacency: readonly number[][]): Set<number> {
	const reachable = new Set<number>();
	const stack = [entryModuleId];
	while (stack.length > 0) {
		const current = stack.pop()!;
		if (reachable.has(current)) continue;
		reachable.add(current);
		for (const target of [...adjacency[current]!].reverse()) stack.push(target);
	}
	return reachable;
}

function findCycles(adjacency: readonly number[][], modules: readonly NormalizedModule[]): readonly (readonly string[])[] {
	const indexByNode = new Array<number>(adjacency.length).fill(-1);
	const lowLink = new Array<number>(adjacency.length).fill(-1);
	const onStack = new Array<boolean>(adjacency.length).fill(false);
	const stack: number[] = [];
	const components: number[][] = [];
	let nextIndex = 0;
	const visit = (node: number): void => {
		indexByNode[node] = nextIndex;
		lowLink[node] = nextIndex;
		nextIndex += 1;
		stack.push(node);
		onStack[node] = true;
		for (const target of adjacency[node]!) {
			if (indexByNode[target] === -1) {
				visit(target);
				lowLink[node] = Math.min(lowLink[node]!, lowLink[target]!);
			} else if (onStack[target]) {
				lowLink[node] = Math.min(lowLink[node]!, indexByNode[target]!);
			}
		}
		if (lowLink[node] !== indexByNode[node]) return;
		const component: number[] = [];
		while (stack.length > 0) {
			const member = stack.pop()!;
			onStack[member] = false;
			component.push(member);
			if (member === node) break;
		}
		components.push(component);
	};
	for (let node = 0; node < adjacency.length; node += 1) {
		if (indexByNode[node] === -1) visit(node);
	}
	return components
		.filter(component => component.length > 1)
		.map(component => component.map(id => modules[id]!.path).sort(compareText))
		.sort((left, right) => compareText(left[0]!, right[0]!));
}

function compareIssue(left: ModuleGraphIssue, right: ModuleGraphIssue): number {
	return compareText(left.code, right.code)
		|| compareText(left.modulePath, right.modulePath)
		|| compareText(left.specifier ?? '', right.specifier ?? '')
		|| compareText(left.cycle?.join('\u0000') ?? '', right.cycle?.join('\u0000') ?? '');
}

function requiredModuleId(moduleIds: ReadonlyMap<string, number>, path: string): number {
	const id = moduleIds.get(path);
	if (id === undefined) throw new Error(`Internal module graph error: missing ${path}`);
	return id;
}

function normalizePath(value: unknown, path: string): string {
	try {
		return normalizeKernelPath(string(value, path), path);
	} catch (error) {
		throw new ModuleGraphContractError(path, error instanceof Error ? error.message.replace(/^.*?: /u, '') : 'invalid path');
	}
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ModuleGraphContractError(path, 'expected an object');
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new ModuleGraphContractError(path, 'expected an array');
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new ModuleGraphContractError(path, 'expected a string');
	return value;
}

function nonEmptyString(value: unknown, path: string): string {
	const result = string(value, path);
	if (result.length === 0) throw new ModuleGraphContractError(path, 'string must not be empty');
	return result;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new ModuleGraphContractError(path, 'expected a boolean');
	return value;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
	if (typeof value !== 'string' || !allowed.includes(value)) {
		throw new ModuleGraphContractError(path, `expected one of ${allowed.join(', ')}`);
	}
	return value as T[number];
}

function exactKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	path: string,
	optional: readonly string[] = [],
): void {
	const allowedSet = new Set(allowed);
	const optionalSet = new Set(optional);
	for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new ModuleGraphContractError(`${path}.${key}`, 'unknown property');
	for (const key of allowed) {
		if (!optionalSet.has(key) && !Object.hasOwn(value, key)) throw new ModuleGraphContractError(`${path}.${key}`, 'missing property');
	}
}

function assertUnique(values: readonly string[], path: string, name: string): void {
	for (let index = 1; index < values.length; index += 1) {
		if (values[index] === values[index - 1]) throw new ModuleGraphContractError(path, `duplicate ${name} ${values[index]}`);
	}
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
