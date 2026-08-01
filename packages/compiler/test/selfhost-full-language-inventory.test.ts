import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm } from 'node:fs/promises';
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
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'f'.repeat(64),
};

interface RawDiagnostic {
	readonly code: string;
	readonly message: string;
	readonly sourcePath: string | null;
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

interface Inventory {
	readonly sourceCount: number;
	readonly parsedModules: number;
	readonly checkedModules: number;
	readonly diagnosticCount: number;
	readonly boundaryBlockers: readonly string[];
	readonly entries: readonly InventoryEntry[];
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

function boundaryBlockers(result: RawProjectCompilerResult): readonly string[] {
	const blockers: string[] = [];
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

function inventoryFromResult(
	sourceCount: number,
	result: RawProjectCompilerResult,
): Inventory {
	const groups = new Map<string, {
		message: string;
		count: number;
		sourcePaths: Set<string>;
	}>();
	for (const diagnostic of result.diagnostics) {
		const key = `${diagnostic.code}\u0000${diagnostic.message}`;
		const current = groups.get(key) ?? {
			message: diagnostic.message,
			count: 0,
			sourcePaths: new Set<string>(),
		};
		current.count += 1;
		if (diagnostic.sourcePath !== null) current.sourcePaths.add(diagnostic.sourcePath);
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
	return {
		sourceCount,
		parsedModules: result.stats.parsedModules,
		checkedModules: result.stats.checkedModules,
		diagnosticCount: result.diagnostics.length,
		boundaryBlockers: boundaryBlockers(result),
		entries,
	};
}

test('full-language lowering blocker inventory is deterministic for the canonical self-host source set', { timeout: 300_000 }, async () => {
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

		const inventory = inventoryFromResult(input.sources.length, first);
		assert.equal(inventory.sourceCount, input.sources.length);
		assert.equal(inventory.parsedModules, input.sources.length);
		assert.ok(inventory.entries.length > 0);
		assert.ok(inventory.boundaryBlockers.includes('non-canonical-dependency-metadata'));
		console.log(`SELFHOST_FULL_LANGUAGE_INVENTORY ${JSON.stringify(inventory)}`);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});
