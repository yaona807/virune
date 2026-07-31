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
type Diagnostic = { readonly code: string; readonly message: string; readonly help: string | null };
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

type TypeOperationsRequest = {
	readonly source: string;
	readonly relations: readonly { readonly source: string; readonly target: string }[];
	readonly traits: readonly string[];
	readonly commonTypes: readonly { readonly types: readonly string[] }[];
};

const source = [
	'pub newtype UserId = Int',
	'pub type IntType = Int',
	'pub type IntAlias = IntType',
	'pub type StringType = String',
	'pub type FloatType = Float',
	'pub type NeverType = Never',
	'pub type UnknownType = Unknown',
	'pub type IntList = List<Int>',
	'pub type IntListAgain = List<Int>',
	'pub type StringList = List<String>',
	'pub type MaybeInt = Int?',
	'pub type IntSet = Set<Int>',
	'pub type StringIntMap = Map<String, Int>',
	'pub type IntStringMap = Map<Int, String>',
	'pub type Pair = (Int, String)',
	'pub type Outcome = Result<Int, String>',
	'pub type UserIdRef = UserId',
	'',
].join('\n');

const validRequest: TypeOperationsRequest = {
	source,
	relations: [
		{ source: 'IntType', target: 'IntAlias' },
		{ source: 'IntAlias', target: 'IntType' },
		{ source: 'IntType', target: 'MaybeInt' },
		{ source: 'NeverType', target: 'StringType' },
		{ source: 'StringType', target: 'UnknownType' },
		{ source: 'IntList', target: 'IntListAgain' },
		{ source: 'IntList', target: 'StringList' },
		{ source: 'UserIdRef', target: 'IntType' },
	],
	traits: [
		'IntList',
		'IntSet',
		'StringIntMap',
		'IntStringMap',
		'Pair',
		'Outcome',
		'UserIdRef',
		'UnknownType',
		'FloatType',
	],
	commonTypes: [
		{ types: ['NeverType', 'IntType'] },
		{ types: ['IntType', 'MaybeInt'] },
	],
};

test('collection type operations are structural, bounded, and deterministic', async () => {
	const loaded = await loadTypeOperationsModule();
	try {
		const first = check(loaded.module, validRequest);
		const second = check(loaded.module, validRequest);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true, JSON.stringify(first.diagnostics, null, 2));
		assert.deepEqual(first.diagnostics, []);

		assert.equal(relation(first, 'IntType', 'IntAlias').assignable, true);
		assert.equal(relation(first, 'IntAlias', 'IntType').assignable, true);
		assert.equal(relation(first, 'IntType', 'MaybeInt').assignable, true);
		assert.equal(relation(first, 'NeverType', 'StringType').assignable, true);
		assert.equal(relation(first, 'StringType', 'UnknownType').assignable, true);
		assert.equal(relation(first, 'IntList', 'IntListAgain').assignable, true);
		assert.equal(relation(first, 'IntList', 'StringList').assignable, false);
		assert.equal(relation(first, 'UserIdRef', 'IntType').assignable, false);

		const intList = traits(first, 'IntList');
		assert.deepEqual(capabilities(intList), [true, true, true, true]);
		assert.equal(typeName(first, intList.elementType), 'Int');

		const intSet = traits(first, 'IntSet');
		assert.deepEqual(capabilities(intSet), [true, true, true, true]);
		assert.equal(typeName(first, intSet.elementType), 'Int');

		const stringIntMap = traits(first, 'StringIntMap');
		assert.deepEqual(capabilities(stringIntMap), [true, true, true, true]);
		assert.equal(typeName(first, stringIntMap.keyType), 'String');
		assert.equal(typeName(first, stringIntMap.valueType), 'Int');

		const intStringMap = traits(first, 'IntStringMap');
		assert.deepEqual(capabilities(intStringMap), [true, true, false, true]);

		const pair = traits(first, 'Pair');
		assert.deepEqual(capabilities(pair), [true, true, true, true]);
		assert.deepEqual(pair.itemTypes.map(id => typeName(first, id)), ['Int', 'String']);

		const outcome = traits(first, 'Outcome');
		assert.deepEqual(capabilities(outcome), [true, true, true, true]);
		assert.equal(typeName(first, outcome.valueType), 'Int');
		assert.equal(typeName(first, outcome.errorType), 'String');

		assert.deepEqual(capabilities(traits(first, 'UserIdRef')), [true, true, true, true]);
		assert.deepEqual(capabilities(traits(first, 'UnknownType')), [false, false, true, false]);
		assert.deepEqual(capabilities(traits(first, 'FloatType')), [true, false, true, true]);
		assert.ok(first.traits.every(item => item.containsOpenType === false));

		assert.equal(commonType(first, ['NeverType', 'IntType']).typeName, 'Int');
		assert.equal(commonType(first, ['IntType', 'MaybeInt']).typeName, 'Option');
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('incompatible and unknown operation types emit stable diagnostics', async () => {
	const loaded = await loadTypeOperationsModule();
	try {
		const incompatible = check(loaded.module, {
			source,
			relations: [],
			traits: [],
			commonTypes: [{ types: ['IntType', 'StringType'] }],
		});
		assert.equal(incompatible.accepted, false);
		assert.equal(incompatible.commonTypes[0]?.typeId, null);
		assert.ok(incompatible.diagnostics.some(item => item.code === 'L2042'));
		assert.ok(incompatible.diagnostics.every(item => item.help !== null));

		const unknown = check(loaded.module, {
			source,
			relations: [{ source: 'MissingType', target: 'IntType' }],
			traits: ['MissingType'],
			commonTypes: [],
		});
		assert.equal(unknown.accepted, false);
		assert.equal(unknown.relations[0]?.assignable, false);
		assert.equal(unknown.traits[0]?.typeId, null);
		assert.ok(unknown.diagnostics.every(item => item.code === 'L2040'));
		assert.ok(unknown.diagnostics.every(item => item.help !== null));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function relation(result: TypeOperationsResult, sourceName: string, targetName: string): TypeRelation {
	const value = result.relations.find(item => item.source === sourceName && item.target === targetName);
	assert.ok(value, `missing relation ${sourceName} -> ${targetName}`);
	return value;
}

function traits(result: TypeOperationsResult, name: string): TypeTraits {
	const value = result.traits.find(item => item.name === name);
	assert.ok(value, `missing traits ${name}`);
	return value;
}

function commonType(result: TypeOperationsResult, names: readonly string[]): CommonType {
	const value = result.commonTypes.find(item => item.types.join(',') === names.join(','));
	assert.ok(value, `missing common type ${names.join(',')}`);
	return value;
}

function capabilities(value: TypeTraits): readonly boolean[] {
	return [value.supportsEq, value.supportsHash, value.supportsJson, value.supportsDebug];
}

function typeName(result: TypeOperationsResult, id: number | null): string | undefined {
	return id === null ? undefined : result.types[id]?.name;
}

function validateReferences(result: TypeOperationsResult): void {
	for (const relationValue of result.relations) {
		if (relationValue.sourceTypeId !== null) assert.ok(relationValue.sourceTypeId >= 0 && relationValue.sourceTypeId < result.types.length);
		if (relationValue.targetTypeId !== null) assert.ok(relationValue.targetTypeId >= 0 && relationValue.targetTypeId < result.types.length);
	}
	for (const trait of result.traits) {
		for (const id of [trait.typeId, trait.elementType, trait.keyType, trait.valueType, trait.errorType]) {
			if (id !== null) assert.ok(id >= 0 && id < result.types.length);
		}
		for (const id of trait.itemTypes) assert.ok(id >= 0 && id < result.types.length);
	}
	for (const common of result.commonTypes) {
		if (common.typeId !== null) assert.ok(common.typeId >= 0 && common.typeId < result.types.length);
	}
}

function check(module: TypeOperationsModule, request: TypeOperationsRequest): TypeOperationsResult {
	const encoded = module.checkFrontendTypeOperationsContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Type operations contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return JSON.parse(encoded.$values[0]) as TypeOperationsResult;
}

async function loadTypeOperationsModule(): Promise<{ readonly root: string; readonly module: TypeOperationsModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-type-operations-'));
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
