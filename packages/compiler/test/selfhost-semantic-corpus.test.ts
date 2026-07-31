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
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-semantic-v1');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type Diagnostic = { readonly code: string };
type SemanticType = {
	readonly id: number;
	readonly name: string;
	readonly declarationId: number | null;
	readonly arguments: readonly number[];
	readonly instantiationId: number | null;
};
type SemanticMember = {
	readonly id: number;
	readonly declarationId: number;
	readonly name: string;
	readonly typeIds: readonly number[];
};
type SemanticDeclaration = {
	readonly id: number;
	readonly kind: string;
	readonly name: string;
	readonly typeParameters: readonly string[];
	readonly memberIds: readonly number[];
	readonly targetType: number | null;
};
type SemanticInstantiation = {
	readonly id: number;
	readonly declarationId: number;
	readonly argumentTypeIds: readonly number[];
	readonly memberIds: readonly number[];
	readonly targetType: number | null;
};
type SemanticInstantiatedMember = {
	readonly id: number;
	readonly instantiationId: number;
	readonly sourceMemberId: number;
	readonly typeIds: readonly number[];
};
type SemanticResult = {
	readonly accepted: boolean;
	readonly declarations: readonly SemanticDeclaration[];
	readonly members: readonly SemanticMember[];
	readonly types: readonly SemanticType[];
	readonly instantiations: readonly SemanticInstantiation[];
	readonly instantiatedMembers: readonly SemanticInstantiatedMember[];
	readonly diagnostics: readonly Diagnostic[];
};
type SemanticModule = { readonly checkFrontendDataTypesContract: (source: string) => ViruneResult<string> };
type DeclarationExpectation = {
	readonly name: string;
	readonly kind: string;
	readonly typeParameters: readonly string[];
};
type CorpusCase = {
	readonly id: string;
	readonly source: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly declarations: readonly DeclarationExpectation[];
	readonly requiredInstantiations: readonly string[];
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned self-host semantic corpus is canonical, deterministic, and reference-safe', async t => {
	const manifest = await loadManifest();
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	assert.equal(new Set(manifest.cases.map(item => item.source)).size, manifest.cases.length);

	const loaded = await loadSemanticModule();
	try {
		for (const fixture of manifest.cases) {
			await t.test(fixture.id, async () => {
				const source = await readFile(join(corpusRoot, fixture.source), 'utf8');
				const firstEncoded = checkEncoded(loaded.module, source);
				const secondEncoded = checkEncoded(loaded.module, source);
				assert.equal(firstEncoded, secondEncoded, `${fixture.id} serialization changed between identical runs`);

				const result = JSON.parse(firstEncoded) as SemanticResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				assert.deepEqual(
					[...new Set(result.diagnostics.map(item => item.code))].sort(),
					[...fixture.diagnosticCodes].sort(),
					fixture.id,
				);
				for (const expected of fixture.declarations) {
					const declaration = result.declarations.find(item => item.name === expected.name);
					assert.ok(declaration, `${fixture.id}: missing declaration ${expected.name}`);
					assert.equal(declaration.kind, expected.kind, `${fixture.id}: ${expected.name}`);
					assert.deepEqual(declaration.typeParameters, expected.typeParameters, `${fixture.id}: ${expected.name}`);
				}
				const instantiationKeys = result.instantiations.map(item => instantiationKey(result, item));
				for (const expected of fixture.requiredInstantiations) {
					assert.ok(instantiationKeys.includes(expected), `${fixture.id}: missing instantiation ${expected}`);
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

function checkEncoded(module: SemanticModule, source: string): string {
	const encoded = module.checkFrontendDataTypesContract(source);
	if (encoded.$tag !== 'Ok') throw new Error(`Semantic contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function instantiationKey(result: SemanticResult, value: SemanticInstantiation): string {
	const declaration = result.declarations[value.declarationId];
	assert.ok(declaration, `missing declaration ${value.declarationId}`);
	const argumentsText = value.argumentTypeIds.map(id => {
		const type = result.types[id];
		assert.ok(type, `missing type ${id}`);
		return type.name;
	}).join(',');
	return `${declaration.name}<${argumentsText}>`;
}

function validateCanonicalReferences(result: SemanticResult, fixtureId: string): void {
	assert.deepEqual(result.declarations.map(item => item.id), result.declarations.map((_, index) => index), fixtureId);
	assert.deepEqual(result.members.map(item => item.id), result.members.map((_, index) => index), fixtureId);
	assert.deepEqual(result.types.map(item => item.id), result.types.map((_, index) => index), fixtureId);
	assert.deepEqual(result.instantiations.map(item => item.id), result.instantiations.map((_, index) => index), fixtureId);
	assert.deepEqual(result.instantiatedMembers.map(item => item.id), result.instantiatedMembers.map((_, index) => index), fixtureId);

	for (const declaration of result.declarations) {
		for (const id of declaration.memberIds) assertReference(id, result.members.length, `${fixtureId}: declaration member`);
		if (declaration.targetType !== null) assertReference(declaration.targetType, result.types.length, `${fixtureId}: declaration target`);
	}
	for (const member of result.members) {
		assertReference(member.declarationId, result.declarations.length, `${fixtureId}: member declaration`);
		for (const id of member.typeIds) assertReference(id, result.types.length, `${fixtureId}: member type`);
	}
	for (const type of result.types) {
		if (type.declarationId !== null) assertReference(type.declarationId, result.declarations.length, `${fixtureId}: type declaration`);
		for (const id of type.arguments) assertReference(id, result.types.length, `${fixtureId}: type argument`);
		if (type.instantiationId !== null) assertReference(type.instantiationId, result.instantiations.length, `${fixtureId}: type instantiation`);
	}
	for (const value of result.instantiations) {
		assertReference(value.declarationId, result.declarations.length, `${fixtureId}: instantiation declaration`);
		for (const id of value.argumentTypeIds) assertReference(id, result.types.length, `${fixtureId}: instantiation argument`);
		for (const id of value.memberIds) assertReference(id, result.instantiatedMembers.length, `${fixtureId}: instantiated member`);
		if (value.targetType !== null) assertReference(value.targetType, result.types.length, `${fixtureId}: instantiation target`);
	}
	for (const member of result.instantiatedMembers) {
		assertReference(member.instantiationId, result.instantiations.length, `${fixtureId}: member instantiation`);
		assertReference(member.sourceMemberId, result.members.length, `${fixtureId}: source member`);
		for (const id of member.typeIds) assertReference(id, result.types.length, `${fixtureId}: instantiated member type`);
	}
}

function assertReference(id: number, length: number, message: string): void {
	assert.ok(Number.isInteger(id) && id >= 0 && id < length, `${message}: ${id}/${length}`);
}

async function loadSemanticModule(): Promise<{ readonly root: string; readonly module: SemanticModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-semantic-corpus-'));
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
	return { root, module: await import(moduleUrl) as SemanticModule };
}
