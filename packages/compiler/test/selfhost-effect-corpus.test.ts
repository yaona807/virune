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
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-effect-v1');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type EffectFunction = {
	readonly id: number;
	readonly name: string;
	readonly declaredEffects: readonly string[];
	readonly wildcard: boolean;
};
type EffectRequirement = {
	readonly id: number;
	readonly functionId: number;
	readonly requiredEffects: readonly string[];
	readonly missingEffects: readonly string[];
	readonly satisfied: boolean;
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly help: string | null;
};
type EffectResult = {
	readonly accepted: boolean;
	readonly functions: readonly EffectFunction[];
	readonly requirements: readonly EffectRequirement[];
	readonly diagnostics: readonly Diagnostic[];
};
type EffectModule = {
	readonly checkFrontendEffectsContract: (request: string) => ViruneResult<string>;
};
type CorpusCase = {
	readonly id: string;
	readonly request: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly sortDiagnosticCodes: boolean;
	readonly functionDeclaredEffects: readonly (readonly string[])[];
	readonly functionWildcards: readonly boolean[];
	readonly requirementRequiredEffects?: readonly (readonly string[])[];
	readonly requirementMissingEffects: readonly (readonly string[])[];
	readonly requirementSatisfied: readonly boolean[];
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned self-host effect corpus is deterministic and reference-safe', async t => {
	const manifest = JSON.parse(await readFile(join(corpusRoot, 'corpus.json'), 'utf8')) as CorpusManifest;
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	assert.equal(new Set(manifest.cases.map(item => item.request)).size, manifest.cases.length);

	const loaded = await loadEffectModule();
	try {
		for (const fixture of manifest.cases) {
			await t.test(fixture.id, async () => {
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
				assert.equal(firstEncoded, secondEncoded, `${fixture.id}: serialization changed`);

				const result = JSON.parse(firstEncoded) as EffectResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				const actualCodes = result.diagnostics.map(item => item.code);
				const expectedCodes = [...fixture.diagnosticCodes];
				if (fixture.sortDiagnosticCodes) {
					actualCodes.sort();
					expectedCodes.sort();
				}
				assert.deepEqual(actualCodes, expectedCodes, `${fixture.id}: diagnostics`);
				assert.ok(result.diagnostics.every(item => item.severity === 'error'), `${fixture.id}: severity`);
				assert.ok(result.diagnostics.every(item => item.help !== null), `${fixture.id}: help`);
				assert.deepEqual(result.functions.map(item => item.declaredEffects), fixture.functionDeclaredEffects);
				assert.deepEqual(result.functions.map(item => item.wildcard), fixture.functionWildcards);
				if (fixture.requirementRequiredEffects !== undefined) {
					assert.deepEqual(result.requirements.map(item => item.requiredEffects), fixture.requirementRequiredEffects);
				}
				assert.deepEqual(result.requirements.map(item => item.missingEffects), fixture.requirementMissingEffects);
				assert.deepEqual(result.requirements.map(item => item.satisfied), fixture.requirementSatisfied);
				validateReferences(result, fixture.id);
			});
		}
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function evaluateEncoded(module: EffectModule, request: unknown): string {
	const encoded = module.checkFrontendEffectsContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Effect contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateReferences(result: EffectResult, fixtureId: string): void {
	assert.deepEqual(result.functions.map(item => item.id), result.functions.map((_, index) => index), `${fixtureId}: function IDs`);
	assert.deepEqual(result.requirements.map(item => item.id), result.requirements.map((_, index) => index), `${fixtureId}: requirement IDs`);
	for (const requirement of result.requirements) {
		if (requirement.functionId >= 0 && requirement.functionId < result.functions.length) continue;
		assert.equal(requirement.satisfied, false, `${fixtureId}: malformed reference`);
	}
}

async function loadEffectModule(): Promise<{ readonly root: string; readonly module: EffectModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-effect-corpus-'));
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
	return { root, module: await import(moduleUrl) as EffectModule };
}
