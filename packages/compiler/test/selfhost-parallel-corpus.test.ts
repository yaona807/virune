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
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-parallel-v1');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type ParallelEntry = {
	readonly id: number;
	readonly name: string;
	readonly operandKind: string;
	readonly valueType: string | null;
	readonly errorType: string | null;
	readonly fieldType: string;
	readonly futureValid: boolean;
	readonly resultValid: boolean;
	readonly errorCompatible: boolean;
	readonly valid: boolean;
};
type ParallelField = { readonly name: string; readonly typeName: string };
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly entryId: number | null;
	readonly help: string | null;
};
type ParallelResult = {
	readonly accepted: boolean;
	readonly tryMode: boolean;
	readonly entries: readonly ParallelEntry[];
	readonly fields: readonly ParallelField[];
	readonly commonErrorType: string | null;
	readonly resultType: string;
	readonly diagnostics: readonly Diagnostic[];
};
type ParallelModule = {
	readonly checkFrontendParallelContract: (request: string) => ViruneResult<string>;
};
type EntryExpectation = Omit<ParallelEntry, 'id'>;
type CorpusCase = {
	readonly id: string;
	readonly request: string;
	readonly accepted: boolean;
	readonly tryMode: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly entries: readonly EntryExpectation[];
	readonly fields: readonly ParallelField[];
	readonly commonErrorType: string | null;
	readonly resultType: string;
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned self-host parallel corpus is deterministic and canonical', async t => {
	const manifest = await loadManifest();
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	assert.equal(new Set(manifest.cases.map(item => item.request)).size, manifest.cases.length);

	const loaded = await loadParallelModule();
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

				const result = JSON.parse(firstEncoded) as ParallelResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				assert.equal(result.tryMode, fixture.tryMode, `${fixture.id}: try mode`);
				assert.deepEqual(result.diagnostics.map(item => item.code), fixture.diagnosticCodes, fixture.id);
				assert.ok(result.diagnostics.every(item => item.severity === 'error'), `${fixture.id}: non-error diagnostic`);
				assert.ok(result.diagnostics.every(item => item.help !== null), `${fixture.id}: diagnostic help is missing`);
				assert.deepEqual(
					result.entries.map(({
						name,
						operandKind,
						valueType,
						errorType,
						fieldType,
						futureValid,
						resultValid,
						errorCompatible,
						valid,
					}) => ({
						name,
						operandKind,
						valueType,
						errorType,
						fieldType,
						futureValid,
						resultValid,
						errorCompatible,
						valid,
					})),
					fixture.entries,
					`${fixture.id}: entries`,
				);
				assert.deepEqual(result.fields, fixture.fields, `${fixture.id}: fields`);
				assert.equal(result.commonErrorType, fixture.commonErrorType, `${fixture.id}: common error type`);
				assert.equal(result.resultType, fixture.resultType, `${fixture.id}: result type`);
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
	assert.equal(fixture.entries.length > 0, true, `${fixture.id}: no entries`);
	assert.equal(new Set(fixture.fields.map(item => item.name)).size, fixture.fields.length, `${fixture.id}: duplicate field`);
	if (fixture.accepted) assert.deepEqual(fixture.diagnosticCodes, [], `${fixture.id}: accepted fixture has diagnostics`);
}

function evaluateEncoded(module: ParallelModule, request: unknown): string {
	const encoded = module.checkFrontendParallelContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Parallel contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateCanonicalReferences(result: ParallelResult, fixture: CorpusCase): void {
	assert.deepEqual(result.entries.map(item => item.id), result.entries.map((_, index) => index), `${fixture.id}: entry IDs`);
	for (const diagnostic of result.diagnostics) {
		if (diagnostic.entryId === null) continue;
		assert.equal(Number.isInteger(diagnostic.entryId), true, `${fixture.id}: non-integer diagnostic entry`);
		assert.equal(diagnostic.entryId >= 0 && diagnostic.entryId < result.entries.length, true, `${fixture.id}: diagnostic entry`);
	}
}

async function loadParallelModule(): Promise<{ readonly root: string; readonly module: ParallelModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-parallel-corpus-'));
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
	return { root, module: await import(moduleUrl) as ParallelModule };
}
