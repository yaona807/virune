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
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-async-await-v1');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type AsyncContext = {
	readonly id: number;
	readonly kind: string;
	readonly name: string;
	readonly isAsync: boolean;
	readonly declaredEffects: readonly string[];
	readonly wildcard: boolean;
};
type AwaitExpression = {
	readonly id: number;
	readonly contextId: number;
	readonly operandKind: string;
	readonly operandType: string;
	readonly awaitedType: string | null;
	readonly resultType: string | null;
	readonly contextValid: boolean;
	readonly operandValid: boolean;
	readonly requiredEffects: readonly string[];
	readonly missingEffects: readonly string[];
	readonly valid: boolean;
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly help: string | null;
};
type AsyncAwaitResult = {
	readonly accepted: boolean;
	readonly contexts: readonly AsyncContext[];
	readonly expressions: readonly AwaitExpression[];
	readonly diagnostics: readonly Diagnostic[];
};
type AsyncAwaitModule = {
	readonly checkFrontendAsyncAwaitContract: (request: string) => ViruneResult<string>;
};
type ContextExpectation = Omit<AsyncContext, 'id'>;
type ExpressionExpectation = Omit<AwaitExpression, 'id'>;
type CorpusCase = {
	readonly id: string;
	readonly request: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly canonicalReferences: boolean;
	readonly contexts: readonly ContextExpectation[];
	readonly expressions: readonly ExpressionExpectation[];
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned self-host async await corpus is deterministic and reference-safe', async t => {
	const manifest = await loadManifest();
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	assert.equal(new Set(manifest.cases.map(item => item.request)).size, manifest.cases.length);

	const loaded = await loadAsyncAwaitModule();
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

				const result = JSON.parse(firstEncoded) as AsyncAwaitResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				assert.deepEqual(result.diagnostics.map(item => item.code), fixture.diagnosticCodes, fixture.id);
				assert.ok(result.diagnostics.every(item => item.severity === 'error'), `${fixture.id}: non-error diagnostic`);
				assert.ok(result.diagnostics.every(item => item.help !== null), `${fixture.id}: diagnostic help is missing`);
				assert.deepEqual(
					result.contexts.map(({ kind, name, isAsync, declaredEffects, wildcard }) => ({
						kind,
						name,
						isAsync,
						declaredEffects,
						wildcard,
					})),
					fixture.contexts,
					`${fixture.id}: contexts`,
				);
				assert.deepEqual(
					result.expressions.map(({
						contextId,
						operandKind,
						operandType,
						awaitedType,
						resultType,
						contextValid,
						operandValid,
						requiredEffects,
						missingEffects,
						valid,
					}) => ({
						contextId,
						operandKind,
						operandType,
						awaitedType,
						resultType,
						contextValid,
						operandValid,
						requiredEffects,
						missingEffects,
						valid,
					})),
					fixture.expressions,
					`${fixture.id}: expressions`,
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
	assert.equal(fixture.contexts.length > 0, true, `${fixture.id}: no contexts`);
	assert.equal(fixture.expressions.length > 0, true, `${fixture.id}: no expressions`);
	assert.equal(new Set(fixture.contexts.map(item => item.name)).size === fixture.contexts.length, fixture.id !== 'malformed-request');
	for (const context of fixture.contexts) {
		assert.deepEqual(context.declaredEffects, [...context.declaredEffects].sort());
	}
}

function evaluateEncoded(module: AsyncAwaitModule, request: unknown): string {
	const encoded = module.checkFrontendAsyncAwaitContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Async await contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateCanonicalReferences(result: AsyncAwaitResult, fixture: CorpusCase): void {
	assert.deepEqual(result.contexts.map(item => item.id), result.contexts.map((_, index) => index), `${fixture.id}: context IDs`);
	assert.deepEqual(result.expressions.map(item => item.id), result.expressions.map((_, index) => index), `${fixture.id}: expression IDs`);
	for (const expression of result.expressions) {
		const validReference = Number.isInteger(expression.contextId)
			&& expression.contextId >= 0
			&& expression.contextId < result.contexts.length;
		if (fixture.canonicalReferences) assert.equal(validReference, true, `${fixture.id}: expression context ${expression.contextId}`);
	}
}

async function loadAsyncAwaitModule(): Promise<{ readonly root: string; readonly module: AsyncAwaitModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-async-await-corpus-'));
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
	return { root, module: await import(moduleUrl) as AsyncAwaitModule };
}
