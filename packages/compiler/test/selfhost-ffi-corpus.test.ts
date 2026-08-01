import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-ffi-v1');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type FfiType = { readonly id: number; readonly safe: boolean };
type Diagnostic = {
	readonly code: string;
	readonly entryKind: string;
	readonly entryId: number | null;
	readonly typeId: number | null;
};
type FfiResult = {
	readonly accepted: boolean;
	readonly types: readonly FfiType[];
	readonly externFunctions: readonly { readonly id: number }[];
	readonly exports: readonly { readonly id: number }[];
	readonly diagnostics: readonly Diagnostic[];
};
type FfiModule = { readonly checkFrontendFfiContract: (request: string) => ViruneResult<string> };
type CorpusCase = {
	readonly id: string;
	readonly accepted: boolean;
	readonly additionalTypes?: readonly unknown[];
	readonly externs: readonly unknown[];
	readonly exports: readonly unknown[];
	readonly expectedDiagnosticCodes: readonly string[];
	readonly expectedTypeSafety?: Readonly<Record<string, boolean>>;
};
type CorpusManifest = {
	readonly version: number;
	readonly types: readonly unknown[];
	readonly cases: readonly CorpusCase[];
};

test('versioned FFI corpus is deterministic and reference-safe', async t => {
	const manifest = JSON.parse(await readFile(join(corpusRoot, 'corpus.json'), 'utf8')) as CorpusManifest;
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	const loaded = await loadFfiModule();
	try {
		for (const fixture of manifest.cases) {
			await t.test(fixture.id, () => validateCase(loaded.module, manifest.types, fixture));
		}
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function validateCase(module: FfiModule, baseTypes: readonly unknown[], fixture: CorpusCase): void {
	const request = {
		types: [...baseTypes, ...(fixture.additionalTypes ?? [])],
		externs: fixture.externs,
		exports: fixture.exports,
	};
	const firstEncoded = evaluateEncoded(module, request);
	const secondEncoded = evaluateEncoded(module, request);
	assert.equal(firstEncoded, secondEncoded, `${fixture.id}: serialization changed`);
	const result = JSON.parse(firstEncoded) as FfiResult;
	assert.equal(result.accepted, fixture.accepted);
	assert.deepEqual(result.diagnostics.map(item => item.code), fixture.expectedDiagnosticCodes);
	assert.deepEqual(result.types.map(item => item.id), result.types.map((_, index) => index));
	assert.deepEqual(result.externFunctions.map(item => item.id), result.externFunctions.map((_, index) => index));
	assert.deepEqual(result.exports.map(item => item.id), result.exports.map((_, index) => index));
	for (const [typeId, expectedSafe] of Object.entries(fixture.expectedTypeSafety ?? {})) {
		assert.equal(result.types[Number(typeId)]?.safe, expectedSafe, `${fixture.id}: type ${typeId}`);
	}
	validateReferences(result);
}

function evaluateEncoded(module: FfiModule, request: unknown): string {
	const encoded = module.checkFrontendFfiContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`FFI contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateReferences(result: FfiResult): void {
	for (const diagnostic of result.diagnostics) {
		if (diagnostic.typeId !== null && diagnostic.typeId >= 0 && diagnostic.code !== 'L9001') {
			assert.ok(diagnostic.typeId < result.types.length, `invalid type reference ${diagnostic.typeId}`);
		}
		if (diagnostic.entryKind === 'externFunction' && diagnostic.entryId !== null) {
			assert.ok(diagnostic.entryId >= 0 && diagnostic.entryId < result.externFunctions.length);
		}
		if (diagnostic.entryKind === 'export' && diagnostic.entryId !== null) {
			assert.ok(diagnostic.entryId >= 0 && diagnostic.entryId < result.exports.length);
		}
	}
}

async function loadFfiModule(): Promise<{ readonly root: string; readonly module: FfiModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-ffi-corpus-'));
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
	return { root, module: await import(moduleUrl) as FfiModule };
}
