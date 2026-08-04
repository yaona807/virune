import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatFullLanguageInventorySummary,
	inventoryFromFullLanguageResult,
	serializeFullLanguageInventory,
} from '../src/selfhost/full-language-inventory.js';
import type {
	ProjectCompilerCapabilityV1,
	ProjectCompilerDiagnosticV1,
	ProjectCompilerResultV1,
} from '../src/selfhost/project-compiler-adapter.js';

const span = (start: number, end = start + 1) => ({
	start: { offset: start, line: 1, column: start + 1 },
	end: { offset: end, line: 1, column: end + 1 },
});

function diagnostic(
	code: string,
	message: string,
	sourcePath: string | null,
	start: number,
): ProjectCompilerDiagnosticV1 {
	return { code, severity: 'error', message, sourcePath, span: span(start), notes: [] };
}

function result(overrides: Partial<ProjectCompilerResultV1> = {}): ProjectCompilerResultV1 {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: 'src/a.virune',
		accepted: false,
		diagnostics: [diagnostic('L1010', 'unsupported', 'src/a.virune', 2)],
		emittedModules: [],
		dependencies: [],
		exportedSymbols: [],
		stats: {
			parsedModules: 2,
			reusedParsedModules: 0,
			checkedModules: 2,
			reusedCheckedModules: 0,
			emittedModules: 0,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
		...overrides,
	};
}

const incompleteCapability: ProjectCompilerCapabilityV1 = {
	contractVersion: '1',
	ready: false,
	requestSchema: 'virune.selfhost.project-compiler.request.v1',
	resultSchema: 'virune.selfhost.project-compiler.result.v2',
	blockers: ['full-language-lowering-not-implemented'],
};

test('inventory groups and sorts diagnostics deterministically', () => {
	const inventory = inventoryFromFullLanguageResult(
		['src/b.virune', 'src/a.virune'],
		result({
			diagnostics: [
				diagnostic('L2020', 'expected type', 'src/b.virune', 9),
				diagnostic('L1010', 'unsupported', 'src/a.virune', 4),
				diagnostic('L1010', 'unsupported', 'src/b.virune', 2),
			],
		}),
		incompleteCapability,
	);
	assert.equal(inventory.status, 'incomplete');
	assert.deepEqual(inventory.codeCounts, [
		{ code: 'L1010', count: 2 },
		{ code: 'L2020', count: 1 },
	]);
	assert.deepEqual(inventory.sourcesWithDiagnostics, ['src/a.virune', 'src/b.virune']);
	assert.deepEqual(inventory.firstDiagnostics.map(item => `${item.sourcePath}:${item.code}`), [
		'src/a.virune:L1010',
		'src/b.virune:L1010',
	]);
	assert.deepEqual(inventory.boundaryBlockers, []);
	assert.equal(serializeFullLanguageInventory(inventory), `${JSON.stringify(inventory)}\n`);
});

test('inventory reports boundary regressions without hiding diagnostics', () => {
	const inventory = inventoryFromFullLanguageResult(
		['src/a.virune', 'src/b.virune'],
		result({
			diagnostics: [diagnostic('SHP2001', 'obsolete', 'src/unknown.virune', 0)],
			dependencies: [
				{ modulePath: 'z', sourceKind: 'virune', specifier: 'z', resolvedPath: 'z', typeOnly: false, public: false },
				{ modulePath: 'a', sourceKind: 'virune', specifier: 'a', resolvedPath: 'a', typeOnly: false, public: false },
			],
			stats: {
				parsedModules: 1,
				reusedParsedModules: 0,
				checkedModules: 2,
				reusedCheckedModules: 0,
				emittedModules: 0,
				reusedEmittedModules: 0,
				invalidatedModules: 0,
			},
		}),
		incompleteCapability,
	);
	assert.deepEqual(inventory.boundaryBlockers, [
		'diagnostic-references-unknown-source',
		'non-canonical-dependency-metadata',
		'obsolete-project-linking-placeholder',
		'parsed-module-coverage-mismatch',
	]);
});

test('ready inventory requires a ready capability and emitted modules', () => {
	const inventory = inventoryFromFullLanguageResult(
		['src/a.virune'],
		result({
			accepted: true,
			diagnostics: [],
			emittedModules: [{ sourcePath: 'src/a.virune', outputPath: 'dist/a.js', code: '', sourceMap: '' }],
			stats: {
				parsedModules: 1,
				reusedParsedModules: 0,
				checkedModules: 1,
				reusedCheckedModules: 0,
				emittedModules: 1,
				reusedEmittedModules: 0,
				invalidatedModules: 0,
			},
		}),
		{
			...incompleteCapability,
			ready: true,
			blockers: [],
		},
	);
	assert.equal(inventory.status, 'ready');
	assert.deepEqual(inventory.boundaryBlockers, []);
	assert.match(formatFullLanguageInventorySummary(inventory)[0] ?? '', /READY/);
});

test('capability contradictions are explicit boundary blockers', () => {
	const inventory = inventoryFromFullLanguageResult(
		['src/a.virune', 'src/b.virune'],
		result(),
		{
			...incompleteCapability,
			ready: true,
			blockers: [],
		},
	);
	assert.deepEqual(inventory.boundaryBlockers, [
		'capability-ready-for-incomplete-inventory',
	]);
});
