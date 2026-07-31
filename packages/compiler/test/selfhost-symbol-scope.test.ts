import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type Scope = {
	readonly id: number;
	readonly kind: string;
	readonly ownerNodeId: number;
	readonly parentScopeId: number | null;
};
type SymbolValue = {
	readonly id: number;
	readonly scopeId: number;
	readonly space: string;
	readonly name: string;
	readonly sourceNodeId: number;
	readonly shadowsSymbolId: number | null;
};
type Lookup = {
	readonly scopeId: number;
	readonly space: string;
	readonly name: string;
	readonly symbolId: number | null;
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly scopeId: number | null;
	readonly name: string | null;
};
type ScopeResult = {
	readonly accepted: boolean;
	readonly scopes: readonly Scope[];
	readonly symbols: readonly SymbolValue[];
	readonly lookups: readonly Lookup[];
	readonly diagnostics: readonly Diagnostic[];
};
type ScopeModule = {
	readonly buildFrontendSymbolScopeContract: (request: string) => ViruneResult<string>;
};

test('symbol scopes preserve namespaces, shadowing, nearest lookup, and determinism', async () => {
	const loaded = await loadScopeModule();
	try {
		const request = {
			scopes: [
				{ kind: 'module', ownerNodeId: 0, parentScopeId: null },
				{ kind: 'function', ownerNodeId: 10, parentScopeId: 0 },
				{ kind: 'block', ownerNodeId: 20, parentScopeId: 1 },
				{ kind: 'block', ownerNodeId: 30, parentScopeId: 2 },
			],
			symbols: [
				{ scopeId: 0, space: 'value', name: 'item', sourceNodeId: 1 },
				{ scopeId: 0, space: 'type', name: 'item', sourceNodeId: 2 },
				{ scopeId: 1, space: 'value', name: 'item', sourceNodeId: 11 },
				{ scopeId: 2, space: 'capability', name: 'io', sourceNodeId: 21 },
				{ scopeId: 3, space: 'value', name: 'local', sourceNodeId: 31 },
			],
			lookups: [
				{ scopeId: 3, space: 'value', name: 'item' },
				{ scopeId: 3, space: 'type', name: 'item' },
				{ scopeId: 3, space: 'capability', name: 'io' },
				{ scopeId: 3, space: 'value', name: 'local' },
			],
		};
		const first = check(loaded.module, request);
		const second = check(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true, JSON.stringify(first.diagnostics, null, 2));
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.scopes.map(scope => scope.id), [0, 1, 2, 3]);
		assert.deepEqual(first.scopes.map(scope => scope.parentScopeId), [null, 0, 1, 2]);
		assert.deepEqual(first.symbols.map(symbol => symbol.id), [0, 1, 2, 3, 4]);
		assert.equal(first.symbols[2]?.shadowsSymbolId, 0);
		assert.equal(first.symbols[1]?.shadowsSymbolId, null);
		assert.deepEqual(first.lookups.map(lookup => lookup.symbolId), [2, 1, 3, 4]);
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('same-scope duplicates are rejected without conflating namespaces', async () => {
	const loaded = await loadScopeModule();
	try {
		const result = check(loaded.module, {
			scopes: [{ kind: 'module', ownerNodeId: 0, parentScopeId: null }],
			symbols: [
				{ scopeId: 0, space: 'value', name: 'entry', sourceNodeId: 1 },
				{ scopeId: 0, space: 'type', name: 'entry', sourceNodeId: 2 },
				{ scopeId: 0, space: 'value', name: 'entry', sourceNodeId: 3 },
			],
			lookups: [],
		});
		assert.equal(result.accepted, false);
		assert.equal(result.symbols.length, 2);
		assert.ok(result.diagnostics.some(item => item.code === 'L1001'));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('unknown lookups and malformed parent references return diagnostics instead of panicking', async () => {
	const loaded = await loadScopeModule();
	try {
		const result = check(loaded.module, {
			scopes: [
				{ kind: 'module', ownerNodeId: 0, parentScopeId: null },
				{ kind: 'block', ownerNodeId: 1, parentScopeId: 9 },
			],
			symbols: [],
			lookups: [{ scopeId: 0, space: 'value', name: 'missing' }],
		});
		assert.equal(result.accepted, false);
		assert.equal(result.lookups[0]?.symbolId, null);
		assert.ok(result.diagnostics.some(item => item.code === 'L9001'));
		assert.ok(result.diagnostics.some(item => item.code === 'L2040'));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function check(module: ScopeModule, request: unknown): ScopeResult {
	const encoded = module.buildFrontendSymbolScopeContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Scope contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return JSON.parse(encoded.$values[0]) as ScopeResult;
}

function validateReferences(result: ScopeResult): void {
	for (const scope of result.scopes) {
		assert.ok(scope.id >= 0 && scope.id < result.scopes.length);
		if (scope.parentScopeId !== null) {
			assert.ok(scope.parentScopeId >= 0 && scope.parentScopeId < scope.id);
		}
	}
	for (const symbol of result.symbols) {
		assert.ok(symbol.id >= 0 && symbol.id < result.symbols.length);
		assert.ok(symbol.scopeId >= 0 && symbol.scopeId < result.scopes.length);
		if (symbol.shadowsSymbolId !== null) {
			assert.ok(symbol.shadowsSymbolId >= 0 && symbol.shadowsSymbolId < symbol.id);
		}
	}
	for (const lookup of result.lookups) {
		if (lookup.symbolId !== null) {
			assert.ok(lookup.symbolId >= 0 && lookup.symbolId < result.symbols.length);
		}
	}
}

async function loadScopeModule(): Promise<{ readonly root: string; readonly module: ScopeModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-symbol-scope-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) await execFileAsync(process.execPath, ['--check', outputPath]);
	const moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as ScopeModule };
}
