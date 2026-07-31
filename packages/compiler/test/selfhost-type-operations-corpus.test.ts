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
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-type-operations-v1');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type SemanticType = {
	readonly id: number;
	readonly kind: string;
	readonly name: string;
	readonly declarationId: number | null;
	readonly arguments: readonly number[];
};
type TypeRelation = {
	readonly source: string;
	readonly target: string;
	readonly sourceTypeId: number | null;
	readonly targetTypeId: number | null;
	readonly assignable: boolean;
};
type TypeTraits = {
	readonly name: string;
	readonly typeId: number | null;
	readonly supportsEq: boolean;
	readonly supportsHash: boolean;
	readonly supportsJson: boolean;
	readonly supportsDebug: boolean;
	readonly containsOpenType: boolean;
	readonly elementType: number | null;
	readonly keyType: number | null;
	readonly valueType: number | null;
	readonly errorType: number | null;
	readonly itemTypes: readonly number[];
};
type CommonType = {
	readonly types: readonly string[];
	readonly typeId: number | null;
	readonly typeName: string | null;
};
type Diagnostic = { readonly code: string; readonly help: string | null };
type TypeOperationsResult = {
	readonly accepted: boolean;
	readonly types: readonly SemanticType[];
	readonly relations: readonly TypeRelation[];
	readonly traits: readonly TypeTraits[];
	readonly commonTypes: readonly CommonType[];
	readonly diagnostics: readonly Diagnostic[];
};
type TypeOperationsModule = {
	readonly checkFrontendTypeOperationsContract: (request: string) => ViruneResult<string>;
};
type RelationExpectation = {
	readonly source: string;
	readonly target: string;
	readonly assignable: boolean;
};
type TraitExpectation = {
	readonly name: string;
	readonly resolved: boolean;
	readonly capabilities?: readonly boolean[];
	readonly containsOpenType?: boolean;
	readonly element?: string;
	readonly key?: string;
	readonly value?: string;
	readonly error?: string;
	readonly items?: readonly string[];
};
type CommonTypeExpectation = {
	readonly types: readonly string[];
	readonly typeName: string | null;
};
type CorpusCase = {
	readonly id: string;
	readonly source: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly relations: readonly RelationExpectation[];
	readonly traits: readonly TraitExpectation[];
	readonly commonTypes: readonly CommonTypeExpectation[];
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };
type TypeOperationsRequest = {
	readonly source: string;
	readonly relations: readonly { readonly source: string; readonly target: string }[];
	readonly traits: readonly string[];
	readonly commonTypes: readonly { readonly types: readonly string[] }[];
};

test('versioned self-host type operations corpus is deterministic and reference-safe', async t => {
	const manifest = await loadManifest();
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);

	const loaded = await loadTypeOperationsModule();
	try {
		for (const fixture of manifest.cases) {
			await t.test(fixture.id, async () => {
				validateFixtureShape(fixture);
				const sourcePath = resolve(corpusRoot, fixture.source);
				assert.equal(relative(corpusRoot, sourcePath).startsWith('..'), false, `${fixture.id}: source escapes corpus root`);
				const source = await readFile(sourcePath, 'utf8');
				const request: TypeOperationsRequest = {
					source,
					relations: fixture.relations.map(item => ({ source: item.source, target: item.target })),
					traits: fixture.traits.map(item => item.name),
					commonTypes: fixture.commonTypes.map(item => ({ types: item.types })),
				};

				const firstEncoded = checkEncoded(loaded.module, request);
				const secondEncoded = checkEncoded(loaded.module, request);
				assert.equal(firstEncoded, secondEncoded, `${fixture.id}: serialization changed between identical runs`);

				const result = JSON.parse(firstEncoded) as TypeOperationsResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				assert.deepEqual(
					[...new Set(result.diagnostics.map(item => item.code))].sort(),
					[...fixture.diagnosticCodes].sort(),
					fixture.id,
				);
				assert.ok(result.diagnostics.every(item => item.help !== null), `${fixture.id}: diagnostic help is missing`);

				for (const expected of fixture.relations) {
					assert.equal(relation(result, expected.source, expected.target).assignable, expected.assignable, fixture.id);
				}
				for (const expected of fixture.traits) validateTraits(result, expected, fixture.id);
				for (const expected of fixture.commonTypes) {
					assert.equal(commonType(result, expected.types).typeName, expected.typeName, fixture.id);
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
	const relationKeys = fixture.relations.map(item => `${item.source}->${item.target}`);
	assert.equal(new Set(relationKeys).size, relationKeys.length, `${fixture.id}: duplicate relation`);
	const traitKeys = fixture.traits.map(item => item.name);
	assert.equal(new Set(traitKeys).size, traitKeys.length, `${fixture.id}: duplicate trait`);
	const commonKeys = fixture.commonTypes.map(item => item.types.join(','));
	assert.equal(new Set(commonKeys).size, commonKeys.length, `${fixture.id}: duplicate common type`);
}

function checkEncoded(module: TypeOperationsModule, request: TypeOperationsRequest): string {
	const encoded = module.checkFrontendTypeOperationsContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Type operations contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function relation(result: TypeOperationsResult, source: string, target: string): TypeRelation {
	const value = result.relations.find(item => item.source === source && item.target === target);
	assert.ok(value, `missing relation ${source} -> ${target}`);
	return value;
}

function commonType(result: TypeOperationsResult, types: readonly string[]): CommonType {
	const value = result.commonTypes.find(item => item.types.join(',') === types.join(','));
	assert.ok(value, `missing common type ${types.join(',')}`);
	return value;
}

function validateTraits(result: TypeOperationsResult, expected: TraitExpectation, fixtureId: string): void {
	const value = result.traits.find(item => item.name === expected.name);
	assert.ok(value, `${fixtureId}: missing traits ${expected.name}`);
	if (!expected.resolved) {
		assert.equal(value.typeId, null, `${fixtureId}: ${expected.name} unexpectedly resolved`);
		assert.deepEqual(
			[value.elementType, value.keyType, value.valueType, value.errorType, value.itemTypes.length],
			[null, null, null, null, 0],
			`${fixtureId}: ${expected.name} has components`,
		);
		return;
	}
	assert.notEqual(value.typeId, null, `${fixtureId}: ${expected.name} did not resolve`);
	assert.ok(expected.capabilities, `${fixtureId}: ${expected.name} capabilities are missing`);
	assert.deepEqual(
		[value.supportsEq, value.supportsHash, value.supportsJson, value.supportsDebug],
		expected.capabilities,
		`${fixtureId}: ${expected.name} capabilities`,
	);
	assert.equal(value.containsOpenType, expected.containsOpenType ?? false, `${fixtureId}: ${expected.name} open type`);
	assert.equal(typeName(result, value.elementType), expected.element ?? null, `${fixtureId}: ${expected.name} element`);
	assert.equal(typeName(result, value.keyType), expected.key ?? null, `${fixtureId}: ${expected.name} key`);
	assert.equal(typeName(result, value.valueType), expected.value ?? null, `${fixtureId}: ${expected.name} value`);
	assert.equal(typeName(result, value.errorType), expected.error ?? null, `${fixtureId}: ${expected.name} error`);
	assert.deepEqual(value.itemTypes.map(id => typeName(result, id)), expected.items ?? [], `${fixtureId}: ${expected.name} items`);
}

function typeName(result: TypeOperationsResult, id: number | null): string | null {
	if (id === null) return null;
	const value = result.types[id];
	assert.ok(value, `missing type ${id}`);
	return value.name;
}

function validateCanonicalReferences(result: TypeOperationsResult, fixtureId: string): void {
	assert.deepEqual(result.types.map(item => item.id), result.types.map((_, index) => index), fixtureId);
	for (const type of result.types) {
		if (type.declarationId !== null) assert.ok(Number.isInteger(type.declarationId) && type.declarationId >= 0, `${fixtureId}: type declaration`);
		for (const id of type.arguments) assertReference(id, result.types.length, `${fixtureId}: type argument`);
	}
	for (const value of result.relations) {
		if (value.sourceTypeId !== null) assertReference(value.sourceTypeId, result.types.length, `${fixtureId}: relation source`);
		if (value.targetTypeId !== null) assertReference(value.targetTypeId, result.types.length, `${fixtureId}: relation target`);
	}
	for (const value of result.traits) {
		for (const id of [value.typeId, value.elementType, value.keyType, value.valueType, value.errorType]) {
			if (id !== null) assertReference(id, result.types.length, `${fixtureId}: trait reference`);
		}
		for (const id of value.itemTypes) assertReference(id, result.types.length, `${fixtureId}: trait item`);
	}
	for (const value of result.commonTypes) {
		if (value.typeId !== null) assertReference(value.typeId, result.types.length, `${fixtureId}: common type`);
	}
}

function assertReference(id: number, length: number, message: string): void {
	assert.ok(Number.isInteger(id) && id >= 0 && id < length, `${message}: ${id}/${length}`);
}

async function loadTypeOperationsModule(): Promise<{ readonly root: string; readonly module: TypeOperationsModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-type-operations-corpus-'));
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
	return { root, module: await import(moduleUrl) as TypeOperationsModule };
}
