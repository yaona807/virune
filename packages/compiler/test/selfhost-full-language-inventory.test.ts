import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { snapshotProjectBuild } from '../src/selfhost/bootstrap-artifact-snapshot.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from '../src/selfhost/bootstrap-execution-probe.js';
import { kernelInputFromProjectBuild } from '../src/selfhost/bootstrap-stage-runner.js';
import {
	hasSelfhostProjectCompilerExports,
	readProjectCompilerCapability,
} from '../src/selfhost/project-compiler-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const inventoryEvidencePath = join(
	repositoryRoot,
	'.cache',
	'ci-timings',
	'selfhost-full-language-inventory.json',
);
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'f'.repeat(64),
};

interface RawPosition {
	readonly offset: number;
	readonly line: number;
	readonly column: number;
}

interface RawSpan {
	readonly start: RawPosition;
	readonly end: RawPosition;
}

interface RawDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly sourcePath: string | null;
	readonly span: RawSpan;
}

interface RawDependency {
	readonly modulePath: string;
	readonly sourceKind: string;
	readonly specifier: string;
}

interface RawExportedSymbol {
	readonly modulePath: string;
	readonly name: string;
	readonly declarationKind: string;
}

interface RawProjectCompilerResult {
	readonly accepted: boolean;
	readonly diagnostics: readonly RawDiagnostic[];
	readonly emittedModules: readonly unknown[];
	readonly dependencies: readonly RawDependency[];
	readonly exportedSymbols: readonly RawExportedSymbol[];
	readonly stats: {
		readonly parsedModules: number;
		readonly checkedModules: number;
		readonly emittedModules: number;
	};
}

interface InventoryEntry {
	readonly code: string;
	readonly message: string;
	readonly count: number;
	readonly sourcePaths: readonly string[];
}

interface InventoryCodeCount {
	readonly code: string;
	readonly count: number;
}

interface InventoryFirstDiagnostic {
	readonly sourcePath: string;
	readonly code: string;
	readonly message: string;
	readonly span: RawSpan;
}

interface Inventory {
	readonly sourceCount: number;
	readonly parsedModules: number;
	readonly checkedModules: number;
	readonly diagnosticCount: number;
	readonly diagnosticSourceCount: number;
	readonly sourcesWithDiagnostics: readonly string[];
	readonly sourcesWithoutDiagnostics: readonly string[];
	readonly boundaryBlockers: readonly string[];
	readonly codeCounts: readonly InventoryCodeCount[];
	readonly entries: readonly InventoryEntry[];
	readonly firstDiagnostics: readonly InventoryFirstDiagnostic[];
}

function canonical<T>(values: readonly T[], key: (value: T) => string): boolean {
	let previous: string | null = null;
	for (const value of values) {
		const current = key(value);
		if (previous !== null && current < previous) return false;
		previous = current;
	}
	return true;
}

function boundaryBlockers(
	sourcePaths: readonly string[],
	result: RawProjectCompilerResult,
): readonly string[] {
	const blockers: string[] = [];
	const sourcePathSet = new Set(sourcePaths);
	if (result.stats.parsedModules !== sourcePaths.length) {
		blockers.push('parsed-module-coverage-mismatch');
	}
	if (result.stats.checkedModules > sourcePaths.length) {
		blockers.push('checked-module-count-exceeds-source-count');
	}
	if (result.diagnostics.some(item => item.sourcePath !== null && !sourcePathSet.has(item.sourcePath))) {
		blockers.push('diagnostic-references-unknown-source');
	}
	if (!canonical(
		result.dependencies,
		item => `${item.modulePath}\0${item.sourceKind}\0${item.specifier}`,
	)) {
		blockers.push('non-canonical-dependency-metadata');
	}
	if (!canonical(
		result.exportedSymbols,
		item => `${item.modulePath}\0${item.name}\0${item.declarationKind}`,
	)) {
		blockers.push('non-canonical-export-metadata');
	}
	return blockers.sort();
}

function diagnosticPositionKey(diagnostic: RawDiagnostic): string {
	return [
		diagnostic.span.start.offset.toString().padStart(12, '0'),
		diagnostic.span.end.offset.toString().padStart(12, '0'),
		diagnostic.code,
		diagnostic.message,
	].join('\0');
}

function inventoryFromResult(
	sourcePaths: readonly string[],
	result: RawProjectCompilerResult,
): Inventory {
	const groups = new Map<string, {
		message: string;
		count: number;
		sourcePaths: Set<string>;
	}>();
	const codeCounts = new Map<string, number>();
	const sourcesWithDiagnostics = new Set<string>();
	const firstDiagnosticBySource = new Map<string, RawDiagnostic>();
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
			sourcePaths: [...value.sourcePaths].sort(),
		}))
		.sort((left, right) => {
			const code = left.code.localeCompare(right.code);
			if (code !== 0) return code;
			return left.message.localeCompare(right.message);
		});
	const sortedSourcesWithDiagnostics = [...sourcesWithDiagnostics].sort();
	const sourcesWithoutDiagnostics = sourcePaths
		.filter(sourcePath => !sourcesWithDiagnostics.has(sourcePath))
		.sort();
	const firstDiagnostics = [...firstDiagnosticBySource.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([sourcePath, diagnostic]) => ({
			sourcePath,
			code: diagnostic.code,
			message: diagnostic.message,
			span: diagnostic.span,
		}));
	return {
		sourceCount: sourcePaths.length,
		parsedModules: result.stats.parsedModules,
		checkedModules: result.stats.checkedModules,
		diagnosticCount: result.diagnostics.length,
		diagnosticSourceCount: sortedSourcesWithDiagnostics.length,
		sourcesWithDiagnostics: sortedSourcesWithDiagnostics,
		sourcesWithoutDiagnostics,
		boundaryBlockers: boundaryBlockers(sourcePaths, result),
		codeCounts: [...codeCounts.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([code, count]) => ({ code, count })),
		entries,
		firstDiagnostics,
	};
}

test('full-language lowering blocker inventory is deterministic for the canonical self-host source set', { timeout: 420_000 }, async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const buildErrors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(buildErrors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		const capability = readProjectCompilerCapability(module);
		assert.ok(capability);
		assert.equal(capability.ready, false);
		assert.deepEqual(capability.blockers, ['full-language-lowering-not-implemented']);
		if (!hasSelfhostProjectCompilerExports(module)) {
			throw new Error('Generated compiler must export the project compiler boundary');
		}

		const input = kernelInputFromProjectBuild(build);
		const request = JSON.stringify({
			contractVersion: input.contractVersion,
			languageVersion: input.languageVersion,
			platform: input.platform,
			entryPath: input.entryPath,
			sources: input.sources.map(source => ({ path: source.path, text: source.text })),
			emit: input.emit,
		});
		const firstValue = module.compileProjectMvp(request);
		const secondValue = module.compileProjectMvp(request);
		assert.deepEqual(firstValue, secondValue);
		if (firstValue.$tag !== 'Ok') throw new Error('Generated project compiler rejected the inventory request transport');
		const encoded = firstValue.$values[0];
		if (typeof encoded !== 'string') {
			throw new Error('Generated project compiler returned a non-string Ok payload');
		}
		const first = JSON.parse(encoded) as RawProjectCompilerResult;
		assert.equal(first.accepted, false);
		assert.equal(first.stats.parsedModules, input.sources.length);
		assert.equal(first.stats.emittedModules, 0);
		assert.equal(first.emittedModules.length, 0);
		assert.ok(first.diagnostics.length > 0);
		assert.ok(first.diagnostics.every(item => item.code !== 'SHP2001'));

		const sourcePaths = input.sources.map(source => source.path);
		const inventory = inventoryFromResult(sourcePaths, first);
		assert.equal(inventory.sourceCount, input.sources.length);
		assert.equal(inventory.parsedModules, input.sources.length);
		assert.ok(inventory.entries.length > 0);
		assert.equal(
			inventory.sourcesWithDiagnostics.length + inventory.sourcesWithoutDiagnostics.length,
			inventory.sourceCount,
		);
		assert.equal(
			inventory.codeCounts.reduce((total, entry) => total + entry.count, 0),
			inventory.diagnosticCount,
		);
		assert.equal(inventory.firstDiagnostics.length, inventory.diagnosticSourceCount);
		assert.deepEqual(
			inventory.firstDiagnostics.map(item => item.sourcePath),
			inventory.sourcesWithDiagnostics,
		);
		assert.ok(inventory.firstDiagnostics.every(item => item.span.end.offset >= item.span.start.offset));
		assert.deepEqual(inventory.boundaryBlockers, []);
		await mkdir(dirname(inventoryEvidencePath), { recursive: true });
		await writeFile(inventoryEvidencePath, `${JSON.stringify(inventory)}\n`, 'utf8');
		console.log(`SELFHOST_FULL_LANGUAGE_INVENTORY ${JSON.stringify(inventory)}`);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});
