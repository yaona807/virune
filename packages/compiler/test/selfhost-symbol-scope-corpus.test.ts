import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-symbol-scope-v1');
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
	readonly help: string | null;
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
type ScopeExpectation = {
	readonly kind: string;
	readonly ownerNodeId: number;
	readonly parentScopeId: number | null;
};
type SymbolExpectation = {
	readonly scopeId: number;
	readonly space: string;
	readonly name: string;
	readonly sourceNodeId: number;
	readonly shadows: string | null;
};
type LookupExpectation = {
	readonly scopeId: number;
	readonly space: string;
	readonly name: string;
	readonly symbol: string | null;
};
type CorpusCase = {
	readonly id: string;
	readonly request: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly scopes: readonly ScopeExpectation[];
	readonly symbols: readonly SymbolExpectation[];
	readonly lookups: readonly LookupExpectation[];
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned self-host symbol scope corpus is deterministic and reference-safe', async t => {
	const manifest = await loadManifest();
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	assert.equal(new Set(manifest.cases.map(item => item.request)).size, manifest.cases.length);

	const loaded = await loadScopeModule();
	try {
		for (const fixture of manifest.cases) {
			await t.test(fixture.id, async () => {
				validateFixtureShape(fixture);
				const requestPath = resolve(corpusRoot, fixture.request);
				const requestRelative = relative(corpusRoot, requestPath);
				assert.equal(requestRelative.startsWith('..') || isAbsolute(requestRelative), false, `${fixture.id}: request escapes corpus root`);
				const request = JSON.parse(await readFile(requestPath, 'utf8')) as unknown;

				const firstEncoded = checkEncoded(loaded.module, request);
				const secondEncoded = checkEncoded(loaded.module, request);
				assert.equal(firstEncoded, secondEncoded, `${fixture.id}: serialization changed between identical runs`);

				const result = JSON.parse(firstEncoded) as ScopeResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				assert.deepEqual(
					[...new Set(result.diagnostics.map(item => item.code))].sort(),
					fixture.diagnosticCodes,
					fixture.id,
				);
				assert.ok(result.diagnostics.every(item => item.severity === 'error'), `${fixture.id}: non-error diagnostic`);
				assert.ok(result.diagnostics.every(item => item.help !== null), `${fixture.id}: diagnostic help is missing`);

				assert.deepEqual(
					result.scopes.map(({ kind, ownerNodeId, parentScopeId }) => ({ kind, ownerNodeId, parentScopeId })),
					fixture.scopes,
					`${fixture.id}: scopes`,
				);
				assert.equal(result.symbols.length, fixture.symbols.length, `${fixture.id}: symbol count`);
				for (let index = 0; index < fixture.symbols.length; index += 1) {
					const actual = result.symbols[index];
					const expected = fixture.symbols[index];
					assert.ok(actual && expected, `${fixture.id}: missing symbol ${index}`);
					assert.deepEqual(
						{
							scopeId: actual.scopeId,
							space: actual.space,
							name: actual.name,
							sourceNodeId: actual.sourceNodeId,
							shadows: symbolKeyById(result, actual.shadowsSymbolId),
						},
						expected,
						`${fixture.id}: symbol ${index}`,
					);
				}
				assert.equal(result.lookups.length, fixture.lookups.length, `${fixture.id}: lookup count`);
				for (let index = 0; index < fixture.lookups.length; index += 1) {
					const actual = result.lookups[index];
					const expected = fixture.lookups[index];
					assert.ok(actual && expected, `${fixture.id}: missing lookup ${index}`);
					assert.deepEqual(
						{
							scopeId: actual.scopeId,
							space: actual.space,
							name: actual.name,
							symbol: symbolKeyById(result, actual.symbolId),
						},
						expected,
						`${fixture.id}: lookup ${index}`,
					);
				}
				validateCanonicalReferences(result, fixture.id);
			});
		}
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadManifest(): Promise<CorpusManifest> {
	const parsed = JSON.parse(await readFile(join(corpusRoot, 'corpus.json'), 'utf8')) as CorpusManifest;
	assert.ok(Array.isArray(parsed.cases));
	return parsed;
}

function validateFixtureShape(fixture: CorpusCase): void {
	assert.deepEqual(fixture.diagnosticCodes, [...new Set(fixture.diagnosticCodes)].sort(), `${fixture.id}: diagnostics are not canonical`);
	assert.equal(fixture.scopes.length > 0, true, `${fixture.id}: no scopes`);
	const symbolKeys = fixture.symbols.map(symbolKey);
	assert.equal(new Set(symbolKeys).size, symbolKeys.length, `${fixture.id}: duplicate expected symbol`);
	const lookupKeys = fixture.lookups.map(item => `${item.scopeId}:${item.space}:${item.name}`);
	assert.equal(new Set(lookupKeys).size, lookupKeys.length, `${fixture.id}: duplicate expected lookup`);
}

function checkEncoded(module: ScopeModule, request: unknown): string {
	const encoded = module.buildFrontendSymbolScopeContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Scope contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function symbolKey(value: Pick<SymbolValue, 'scopeId' | 'space' | 'name' | 'sourceNodeId'>): string {
	return `${value.scopeId}:${value.space}:${value.name}:${value.sourceNodeId}`;
}

function symbolKeyById(result: ScopeResult, id: number | null): string | null {
	if (id === null) return null;
	const value = result.symbols[id];
	assert.ok(value, `missing symbol ${id}`);
	return symbolKey(value);
}

function validateCanonicalReferences(result: ScopeResult, fixtureId: string): void {
	assert.deepEqual(result.scopes.map(item => item.id), result.scopes.map((_, index) => index), `${fixtureId}: scope IDs`);
	assert.deepEqual(result.symbols.map(item => item.id), result.symbols.map((_, index) => index), `${fixtureId}: symbol IDs`);
	for (const scope of result.scopes) {
		if (scope.parentScopeId !== null) assertReference(scope.parentScopeId, scope.id, `${fixtureId}: parent scope`);
	}
	for (const symbol of result.symbols) {
		assertReference(symbol.scopeId, result.scopes.length, `${fixtureId}: symbol scope`);
		if (symbol.shadowsSymbolId !== null) assertReference(symbol.shadowsSymbolId, symbol.id, `${fixtureId}: shadow symbol`);
	}
	for (const lookup of result.lookups) {
		assertReference(lookup.scopeId, result.scopes.length, `${fixtureId}: lookup scope`);
		if (lookup.symbolId !== null) assertReference(lookup.symbolId, result.symbols.length, `${fixtureId}: lookup symbol`);
	}
}

function assertReference(id: number, length: number, message: string): void {
	assert.ok(Number.isInteger(id) && id >= 0 && id < length, `${message}: ${id}/${length}`);
}

async function loadScopeModule(): Promise<{ readonly root: string; readonly module: ScopeModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-symbol-scope-corpus-'));
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
