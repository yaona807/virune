import type {
	ProjectCompilerCapabilityV1,
	ProjectCompilerDiagnosticV1,
	ProjectCompilerResultV1,
} from './project-compiler-adapter.js';

export interface FullLanguageInventoryEntry {
	readonly code: string;
	readonly message: string;
	readonly count: number;
	readonly sourcePaths: readonly string[];
}

export interface FullLanguageInventoryCodeCount {
	readonly code: string;
	readonly count: number;
}

export interface FullLanguageInventoryFirstDiagnostic {
	readonly sourcePath: string;
	readonly code: string;
	readonly message: string;
	readonly span: ProjectCompilerDiagnosticV1['span'];
}

export type FullLanguageInventoryStatus = 'incomplete' | 'ready';

export interface FullLanguageInventory {
	readonly schemaVersion: 1;
	readonly status: FullLanguageInventoryStatus;
	readonly capability: {
		readonly ready: boolean;
		readonly blockers: readonly string[];
	};
	readonly sourceCount: number;
	readonly parsedModules: number;
	readonly checkedModules: number;
	readonly emittedModules: number;
	readonly diagnosticCount: number;
	readonly diagnosticSourceCount: number;
	readonly sourcesWithDiagnostics: readonly string[];
	readonly sourcesWithoutDiagnostics: readonly string[];
	readonly boundaryBlockers: readonly string[];
	readonly codeCounts: readonly FullLanguageInventoryCodeCount[];
	readonly entries: readonly FullLanguageInventoryEntry[];
	readonly firstDiagnostics: readonly FullLanguageInventoryFirstDiagnostic[];
}

function compareText(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function isCanonical<T>(values: readonly T[], key: (value: T) => string): boolean {
	let previous: string | null = null;
	for (const value of values) {
		const current = key(value);
		if (previous !== null && current < previous) return false;
		previous = current;
	}
	return true;
}

function diagnosticPositionKey(diagnostic: ProjectCompilerDiagnosticV1): string {
	return [
		diagnostic.span.start.offset.toString().padStart(12, '0'),
		diagnostic.span.end.offset.toString().padStart(12, '0'),
		diagnostic.code,
		diagnostic.message,
	].join('\0');
}

function inventoryStatus(result: ProjectCompilerResultV1): FullLanguageInventoryStatus {
	return result.accepted && result.diagnostics.length === 0 ? 'ready' : 'incomplete';
}

function boundaryBlockers(
	sourcePaths: readonly string[],
	result: ProjectCompilerResultV1,
	capability: ProjectCompilerCapabilityV1,
	status: FullLanguageInventoryStatus,
): readonly string[] {
	const blockers: string[] = [];
	const sourcePathSet = new Set(sourcePaths);
	const parsedModules = result.stats.parsedModules + result.stats.reusedParsedModules;
	const checkedModules = result.stats.checkedModules + result.stats.reusedCheckedModules;
	if (sourcePathSet.size !== sourcePaths.length) blockers.push('duplicate-source-path');
	if (parsedModules !== sourcePaths.length) blockers.push('parsed-module-coverage-mismatch');
	if (checkedModules !== sourcePaths.length) blockers.push('checked-module-coverage-mismatch');
	if (result.stats.emittedModules !== result.emittedModules.length) {
		blockers.push('emitted-module-count-mismatch');
	}
	if (result.diagnostics.some(item => item.sourcePath !== null && !sourcePathSet.has(item.sourcePath))) {
		blockers.push('diagnostic-references-unknown-source');
	}
	if (!isCanonical(
		result.dependencies,
		item => `${item.modulePath}\0${item.sourceKind}\0${item.specifier}`,
	)) {
		blockers.push('non-canonical-dependency-metadata');
	}
	if (!isCanonical(
		result.exportedSymbols,
		item => `${item.modulePath}\0${item.name}\0${item.declarationKind}`,
	)) {
		blockers.push('non-canonical-export-metadata');
	}
	if (!isCanonical(capability.blockers, value => value)) {
		blockers.push('non-canonical-capability-blockers');
	}
	if (new Set(capability.blockers).size !== capability.blockers.length) {
		blockers.push('duplicate-capability-blocker');
	}
	if (result.accepted && result.diagnostics.length > 0) blockers.push('accepted-with-diagnostics');
	if (!result.accepted && result.diagnostics.length === 0) blockers.push('rejected-without-diagnostics');
	if (result.diagnostics.some(item => item.code === 'SHP2001')) {
		blockers.push('obsolete-project-linking-placeholder');
	}
	if (status === 'ready') {
		if (!capability.ready) blockers.push('capability-not-ready-for-ready-inventory');
		if (capability.blockers.length > 0) blockers.push('ready-capability-has-blockers');
		if (result.emittedModules.length === 0) blockers.push('ready-without-emitted-modules');
	} else {
		if (capability.ready) blockers.push('capability-ready-for-incomplete-inventory');
	}
	return blockers.sort(compareText);
}

export function inventoryFromFullLanguageResult(
	sourcePaths: readonly string[],
	result: ProjectCompilerResultV1,
	capability: ProjectCompilerCapabilityV1,
): FullLanguageInventory {
	const groups = new Map<string, {
		message: string;
		count: number;
		sourcePaths: Set<string>;
	}>();
	const codeCounts = new Map<string, number>();
	const sourcesWithDiagnostics = new Set<string>();
	const firstDiagnosticBySource = new Map<string, ProjectCompilerDiagnosticV1>();
	for (const diagnostic of result.diagnostics) {
		const key = `${diagnostic.code}\u0000${diagnostic.message}`;
		const current = groups.get(key) ?? {
			message: diagnostic.message,
			count: 0,
			sourcePaths: new Set<string>(),
		};
		current.count += 1;
		codeCounts.set(diagnostic.code, (codeCounts.get(diagnostic.code) ?? 0) + 1);
		if (diagnostic.sourcePath !== null) {
			current.sourcePaths.add(diagnostic.sourcePath);
			sourcesWithDiagnostics.add(diagnostic.sourcePath);
			const previous = firstDiagnosticBySource.get(diagnostic.sourcePath);
			if (previous === undefined || diagnosticPositionKey(diagnostic) < diagnosticPositionKey(previous)) {
				firstDiagnosticBySource.set(diagnostic.sourcePath, diagnostic);
			}
		}
		groups.set(key, current);
	}
	const entries = [...groups.entries()]
		.map(([key, value]) => ({
			code: key.slice(0, key.indexOf('\u0000')),
			message: value.message,
			count: value.count,
			sourcePaths: [...value.sourcePaths].sort(compareText),
		}))
		.sort((left, right) => compareText(left.code, right.code) || compareText(left.message, right.message));
	const sortedSourcesWithDiagnostics = [...sourcesWithDiagnostics].sort(compareText);
	const sourcesWithoutDiagnostics = sourcePaths
		.filter(sourcePath => !sourcesWithDiagnostics.has(sourcePath))
		.sort(compareText);
	const firstDiagnostics = [...firstDiagnosticBySource.entries()]
		.sort(([left], [right]) => compareText(left, right))
		.map(([sourcePath, diagnostic]) => ({
			sourcePath,
			code: diagnostic.code,
			message: diagnostic.message,
			span: diagnostic.span,
		}));
	const status = inventoryStatus(result);
	const parsedModules = result.stats.parsedModules + result.stats.reusedParsedModules;
	const checkedModules = result.stats.checkedModules + result.stats.reusedCheckedModules;
	return {
		schemaVersion: 1,
		status,
		capability: {
			ready: capability.ready,
			blockers: [...capability.blockers],
		},
		sourceCount: sourcePaths.length,
		parsedModules,
		checkedModules,
		emittedModules: result.stats.emittedModules,
		diagnosticCount: result.diagnostics.length,
		diagnosticSourceCount: sortedSourcesWithDiagnostics.length,
		sourcesWithDiagnostics: sortedSourcesWithDiagnostics,
		sourcesWithoutDiagnostics,
		boundaryBlockers: boundaryBlockers(sourcePaths, result, capability, status),
		codeCounts: [...codeCounts.entries()]
			.sort(([left], [right]) => compareText(left, right))
			.map(([code, count]) => ({ code, count })),
		entries,
		firstDiagnostics,
	};
}

export function serializeFullLanguageInventory(inventory: FullLanguageInventory): string {
	return `${JSON.stringify(inventory)}\n`;
}

export function formatFullLanguageInventorySummary(inventory: FullLanguageInventory): readonly string[] {
	const codeSummary = inventory.codeCounts.length === 0
		? 'none'
		: inventory.codeCounts.map(entry => `${entry.code}=${entry.count}`).join(', ');
	return [
		`Self-host full-language inventory: ${inventory.status.toUpperCase()}`,
		`Sources: ${inventory.sourceCount}; parsed: ${inventory.parsedModules}; checked: ${inventory.checkedModules}; emitted: ${inventory.emittedModules}`,
		`Diagnostics: ${inventory.diagnosticCount} across ${inventory.diagnosticSourceCount} source(s); codes: ${codeSummary}`,
		`Boundary blockers: ${inventory.boundaryBlockers.length === 0 ? 'none' : inventory.boundaryBlockers.join(', ')}`,
	];
}
