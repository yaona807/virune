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
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-must-use-v1');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type Position = { readonly offset: number; readonly line: number; readonly column: number };
type Span = { readonly start: Position; readonly end: Position };
type MustUseDeclaration = { readonly declarationId: number; readonly name: string; readonly span: Span };
type ValueUse = {
	readonly index: number;
	readonly typeName: string;
	readonly typeId: number | null;
	readonly disposition: string;
	readonly mustUse: boolean;
	readonly reason: string;
	readonly consumed: boolean;
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly span: Span;
	readonly help: string | null;
};
type MustUseResult = {
	readonly accepted: boolean;
	readonly typeCount: number;
	readonly declarations: readonly MustUseDeclaration[];
	readonly values: readonly ValueUse[];
	readonly diagnostics: readonly Diagnostic[];
};
type MustUseModule = {
	readonly checkFrontendMustUseContract: (request: string) => ViruneResult<string>;
};
type ClassificationExpectation = {
	readonly typeName: string;
	readonly mustUse?: boolean;
	readonly reason?: string;
	readonly consumed?: boolean;
	readonly typeId: 'known' | 'null';
};
type CorpusCase = {
	readonly id: string;
	readonly request: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly sortDiagnosticCodes: boolean;
	readonly declarationNames: readonly string[];
	readonly classifications: readonly ClassificationExpectation[];
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned self-host must-use corpus is deterministic and reference-safe', async t => {
	const manifest = await loadManifest();
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	assert.equal(new Set(manifest.cases.map(item => item.request)).size, manifest.cases.length);

	const loaded = await loadMustUseModule();
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

				const firstEncoded = evaluateEncoded(loaded.module, request);
				const secondEncoded = evaluateEncoded(loaded.module, request);
				assert.equal(firstEncoded, secondEncoded, `${fixture.id}: serialization changed between identical runs`);

				const result = JSON.parse(firstEncoded) as MustUseResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				const actualCodes = result.diagnostics.map(item => item.code);
				const expectedCodes = [...fixture.diagnosticCodes];
				if (fixture.sortDiagnosticCodes) {
					actualCodes.sort();
					expectedCodes.sort();
				}
				assert.deepEqual(actualCodes, expectedCodes, `${fixture.id}: diagnostics`);
				assert.ok(result.diagnostics.every(item => item.severity === 'error'), `${fixture.id}: non-error diagnostic`);
				assert.ok(result.diagnostics.every(item => item.help !== null), `${fixture.id}: diagnostic help is missing`);
				assert.deepEqual(result.declarations.map(item => item.name), fixture.declarationNames, `${fixture.id}: declarations`);
				assert.deepEqual(
					result.declarations.map(item => item.declarationId),
					result.declarations.map((_, index) => index),
					`${fixture.id}: declaration IDs`,
				);
				assert.deepEqual(
					result.values.map(item => item.index),
					result.values.map((_, index) => index),
					`${fixture.id}: value indexes`,
				);
				for (const expected of fixture.classifications) validateClassification(result, fixture.id, expected);
				validateReferences(result, fixture.id);
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
	assert.ok(fixture.id.length > 0);
	assert.ok(fixture.request.endsWith('.json'));
	assert.equal(new Set(fixture.classifications.map(item => item.typeName)).size, fixture.classifications.length);
}

function evaluateEncoded(module: MustUseModule, request: unknown): string {
	const encoded = module.checkFrontendMustUseContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Must-use contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateClassification(result: MustUseResult, fixtureId: string, expected: ClassificationExpectation): void {
	const actual = result.values.find(item => item.typeName === expected.typeName);
	assert.ok(actual, `${fixtureId}: missing value ${expected.typeName}`);
	if (expected.mustUse !== undefined) assert.equal(actual.mustUse, expected.mustUse, `${fixtureId}: ${expected.typeName}.mustUse`);
	if (expected.reason !== undefined) assert.equal(actual.reason, expected.reason, `${fixtureId}: ${expected.typeName}.reason`);
	if (expected.consumed !== undefined) assert.equal(actual.consumed, expected.consumed, `${fixtureId}: ${expected.typeName}.consumed`);
	if (expected.typeId === 'null') {
		assert.equal(actual.typeId, null, `${fixtureId}: ${expected.typeName}.typeId`);
	} else {
		assert.ok(
			Number.isInteger(actual.typeId) && actual.typeId !== null && actual.typeId >= 0 && actual.typeId < result.typeCount,
			`${fixtureId}: ${expected.typeName}.typeId`,
		);
	}
}

function validateReferences(result: MustUseResult, fixtureId: string): void {
	for (const value of result.values) {
		if (value.typeId === null) continue;
		assert.ok(value.typeId >= 0 && value.typeId < result.typeCount, `${fixtureId}: value ${value.index} type reference`);
	}
}

async function loadMustUseModule(): Promise<{ readonly root: string; readonly module: MustUseModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-must-use-corpus-'));
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
	return { root, module: await import(moduleUrl) as MustUseModule };
}
