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
	readonly instantiationId: number | null;
};
type SemanticMember = {
	readonly id: number;
	readonly declarationId: number;
	readonly kind: string;
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
type SemanticInstantiatedMember = {
	readonly id: number;
	readonly instantiationId: number;
	readonly sourceMemberId: number;
	readonly typeIds: readonly number[];
};
type SemanticInstantiation = {
	readonly id: number;
	readonly declarationId: number;
	readonly argumentTypeIds: readonly number[];
	readonly memberIds: readonly number[];
	readonly targetType: number | null;
};
type Diagnostic = { readonly code: string; readonly message: string };
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

const validSource = [
	'record Box<T> { value: T }',
	'record Pair<T> { left: T, right: T }',
	'record Wrapper<T> { value: Box<T>, pair: Pair<T> }',
	'record Recursive<T> { next: Recursive<T>? }',
	'type IntBox = Box<Int>',
	'type StringWrapper = Wrapper<String>',
	'type Reused = Pair<Int>',
	'type ReusedAgain = Pair<Int>',
	'type IntRecursive = Recursive<Int>',
	'',
].join('\n');

const recursiveAliasSource = [
	'type Loop<T> = Loop<T>',
	'type IntLoop = Loop<Int>',
	'',
].join('\n');

test('generic instantiations are substituted, nested, structurally interned, and deterministic', async () => {
	const loaded = await loadSemanticModule();
	try {
		const first = check(loaded.module, validSource);
		const second = check(loaded.module, validSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true, JSON.stringify(first.diagnostics, null, 2));
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.instantiations.map(item => item.id), first.instantiations.map((_, index) => index));
		assert.deepEqual(first.instantiatedMembers.map(item => item.id), first.instantiatedMembers.map((_, index) => index));

		const boxInt = instantiation(first, 'Box', ['Int']);
		const boxValue = instantiatedMember(first, boxInt, 'value');
		assert.deepEqual(boxValue.typeIds.map(id => first.types[id]?.name), ['Int']);

		const wrapperString = instantiation(first, 'Wrapper', ['String']);
		const wrapperValue = instantiatedMember(first, wrapperString, 'value');
		const nestedBoxType = first.types[wrapperValue.typeIds[0]!];
		assert.equal(nestedBoxType?.name, 'Box');
		assert.notEqual(nestedBoxType?.instantiationId, null);
		const nestedBox = first.instantiations[nestedBoxType!.instantiationId!];
		assert.deepEqual(nestedBox?.argumentTypeIds.map(id => first.types[id]?.name), ['String']);

		const pairInt = first.instantiations.filter(item => declaration(first, item.declarationId).name === 'Pair'
			&& item.argumentTypeIds.map(id => first.types[id]?.name).join(',') === 'Int');
		assert.equal(pairInt.length, 1, JSON.stringify(pairInt, null, 2));

		const recursiveInt = instantiation(first, 'Recursive', ['Int']);
		const next = instantiatedMember(first, recursiveInt, 'next');
		const option = first.types[next.typeIds[0]!];
		assert.equal(option?.name, 'Option');
		const recursiveReference = first.types[option!.arguments[0]!];
		assert.equal(recursiveReference?.instantiationId, recursiveInt.id);
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('recursive generic aliases are diagnosed without non-termination', async () => {
	const loaded = await loadSemanticModule();
	try {
		const result = check(loaded.module, recursiveAliasSource);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.some(item => item.code === 'L2042'), JSON.stringify(result.diagnostics, null, 2));
		assert.ok(result.types.length < 64, `unexpected type expansion: ${result.types.length}`);
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function declaration(result: SemanticResult, id: number): SemanticDeclaration {
	const value = result.declarations[id];
	assert.ok(value, `missing declaration ${id}`);
	return value;
}

function instantiation(result: SemanticResult, declarationName: string, argumentNames: readonly string[]): SemanticInstantiation {
	const value = result.instantiations.find(item => declaration(result, item.declarationId).name === declarationName
		&& item.argumentTypeIds.map(id => result.types[id]?.name).join(',') === argumentNames.join(','));
	assert.ok(value, `missing instantiation ${declarationName}<${argumentNames.join(',')}>`);
	return value;
}

function instantiatedMember(result: SemanticResult, value: SemanticInstantiation, memberName: string): SemanticInstantiatedMember {
	const member = value.memberIds.map(id => result.instantiatedMembers[id]).find(item => {
		if (item === undefined) return false;
		return result.members[item.sourceMemberId]?.name === memberName;
	});
	assert.ok(member, `missing instantiated member ${memberName}`);
	return member;
}

function validateReferences(result: SemanticResult): void {
	for (const type of result.types) {
		for (const id of type.arguments) assert.ok(id >= 0 && id < result.types.length);
		if (type.instantiationId !== null) assert.ok(type.instantiationId >= 0 && type.instantiationId < result.instantiations.length);
	}
	for (const value of result.instantiations) {
		assert.ok(value.declarationId >= 0 && value.declarationId < result.declarations.length);
		for (const id of value.argumentTypeIds) assert.ok(id >= 0 && id < result.types.length);
		for (const id of value.memberIds) assert.ok(id >= 0 && id < result.instantiatedMembers.length);
		if (value.targetType !== null) assert.ok(value.targetType >= 0 && value.targetType < result.types.length);
	}
	for (const member of result.instantiatedMembers) {
		assert.ok(member.instantiationId >= 0 && member.instantiationId < result.instantiations.length);
		assert.ok(member.sourceMemberId >= 0 && member.sourceMemberId < result.members.length);
		for (const id of member.typeIds) assert.ok(id >= 0 && id < result.types.length);
	}
}

function check(module: SemanticModule, source: string): SemanticResult {
	const encoded = module.checkFrontendDataTypesContract(source);
	if (encoded.$tag !== 'Ok') throw new Error(`Semantic contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return JSON.parse(encoded.$values[0]) as SemanticResult;
}

async function loadSemanticModule(): Promise<{ readonly root: string; readonly module: SemanticModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-generic-instantiation-'));
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
