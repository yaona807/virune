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
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-defer-v1');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type DeferScope = { readonly id: number; readonly kind: string; readonly name: string };
type DeferStatement = {
	readonly id: number;
	readonly scopeId: number;
	readonly expressionType: string;
	readonly contextValid: boolean;
	readonly typeValid: boolean;
	readonly valid: boolean;
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly help: string | null;
};
type DeferResult = {
	readonly accepted: boolean;
	readonly scopes: readonly DeferScope[];
	readonly statements: readonly DeferStatement[];
	readonly diagnostics: readonly Diagnostic[];
};
type DeferModule = {
	readonly checkFrontendDeferContract: (request: string) => ViruneResult<string>;
};
type ScopeExpectation = { readonly kind: string; readonly name: string };
type StatementExpectation = {
	readonly scopeId: number;
	readonly expressionType: string;
	readonly contextValid: boolean;
	readonly typeValid: boolean;
	readonly valid: boolean;
};
type CorpusCase = {
	readonly id: string;
	readonly request: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly canonicalReferences: boolean;
	readonly scopes: readonly ScopeExpectation[];
	readonly statements: readonly StatementExpectation[];
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned self-host defer corpus is deterministic and reference-safe', async t => {
	const manifest = await loadManifest();
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	assert.equal(new Set(manifest.cases.map(item => item.request)).size, manifest.cases.length);

	const loaded = await loadDeferModule();
	try {
		for (const fixture of manifest.cases) {
			await t.test(fixture.id, async () => {
				validateFixtureShape(fixture);
				const requestPath = resolve(corpusRoot, fixture.request);
				const requestRelative = relative(corpusRoot, requestPath);
				assert.equal(
					requestRelative.startsWith('..') || isAbsolute(requestRelative),
					false,
					`${fixture.id}: request escapes corpus root`,
				);
				const request = JSON.parse(await readFile(requestPath, 'utf8')) as unknown;

				const firstEncoded = checkEncoded(loaded.module, request);
				const secondEncoded = checkEncoded(loaded.module, request);
				assert.equal(firstEncoded, secondEncoded, `${fixture.id}: serialization changed between identical runs`);

				const result = JSON.parse(firstEncoded) as DeferResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				assert.deepEqual(result.diagnostics.map(item => item.code), fixture.diagnosticCodes, fixture.id);
				assert.ok(result.diagnostics.every(item => item.severity === 'error'), `${fixture.id}: non-error diagnostic`);
				assert.ok(result.diagnostics.every(item => item.help !== null), `${fixture.id}: diagnostic help is missing`);
				assert.deepEqual(
					result.scopes.map(({ kind, name }) => ({ kind, name })),
					fixture.scopes,
					`${fixture.id}: scopes`,
				);
				assert.deepEqual(
					result.statements.map(({ scopeId, expressionType, contextValid, typeValid, valid }) => ({
						scopeId,
						expressionType,
						contextValid,
						typeValid,
						valid,
					})),
					fixture.statements,
					`${fixture.id}: statements`,
				);
				validateCanonicalReferences(result, fixture);
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
	assert.equal(fixture.scopes.length > 0, true, `${fixture.id}: no scopes`);
	assert.equal(fixture.statements.length > 0, true, `${fixture.id}: no statements`);
	const scopeKeys = fixture.scopes.map(item => `${item.kind}:${item.name}`);
	assert.equal(new Set(scopeKeys).size === scopeKeys.length, fixture.id === 'malformed-request');
}

function checkEncoded(module: DeferModule, request: unknown): string {
	const encoded = module.checkFrontendDeferContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Defer contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateCanonicalReferences(result: DeferResult, fixture: CorpusCase): void {
	assert.deepEqual(result.scopes.map(item => item.id), result.scopes.map((_, index) => index), `${fixture.id}: scope IDs`);
	assert.deepEqual(result.statements.map(item => item.id), result.statements.map((_, index) => index), `${fixture.id}: statement IDs`);
	for (const statement of result.statements) {
		const validReference = Number.isInteger(statement.scopeId)
			&& statement.scopeId >= 0
			&& statement.scopeId < result.scopes.length;
		if (fixture.canonicalReferences) assert.equal(validReference, true, `${fixture.id}: statement scope ${statement.scopeId}`);
	}
}

async function loadDeferModule(): Promise<{ readonly root: string; readonly module: DeferModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-defer-corpus-'));
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
	return { root, module: await import(moduleUrl) as DeferModule };
}
