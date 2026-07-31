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
type Position = { readonly offset: number; readonly line: number; readonly column: number };
type Span = { readonly start: Position; readonly end: Position };
type Diagnostic = { readonly code: string; readonly severity: string; readonly message: string; readonly span: Span; readonly help: string | null };
type SemanticType = { readonly id: number; readonly kind: string; readonly name: string; readonly declarationId: number | null; readonly arguments: readonly number[]; readonly span: Span };
type SemanticMember = { readonly id: number; readonly declarationId: number; readonly kind: string; readonly name: string; readonly typeIds: readonly number[]; readonly span: Span };
type SemanticDeclaration = { readonly id: number; readonly sourceNodeId: number; readonly kind: string; readonly name: string; readonly isPublic: boolean; readonly typeParameters: readonly string[]; readonly memberIds: readonly number[]; readonly targetType: number | null; readonly span: Span };
type SemanticResult = { readonly accepted: boolean; readonly declarations: readonly SemanticDeclaration[]; readonly members: readonly SemanticMember[]; readonly types: readonly SemanticType[]; readonly diagnostics: readonly Diagnostic[] };
type SemanticModule = { readonly checkFrontendDataTypesContract: (source: string) => ViruneResult<string> };

const validSource = [
	'pub record Box<T> {',
	'\tvalue: T',
	'\thistory: List<T?>',
	'}',
	'pub enum Outcome<T, E> {',
	'\tOk(T)',
	'\tErr(E)',
	'\tEmpty',
	'}',
	'pub newtype UserId = Int',
	'pub type Lookup = Map<String, UserId>',
	'',
].join('\n');

const invalidSource = [
	'record Duplicate {}',
	'record Duplicate {}',
	'record Params<T, T> {}',
	'record Unknown {',
	'\tvalue: Missing',
	'}',
	'type Bad = Result<Int>',
	'',
].join('\n');

test('data type checker emits a deterministic canonical semantic table', async () => {
	const loaded = await loadSemanticModule();
	try {
		const first = check(loaded.module, validSource);
		const second = check(loaded.module, validSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.declarations.map(item => item.id), first.declarations.map((_, index) => index));
		assert.deepEqual(first.members.map(item => item.id), first.members.map((_, index) => index));
		assert.deepEqual(first.types.map(item => item.id), first.types.map((_, index) => index));

		const box = declaration(first, 'Box');
		assert.equal(box.kind, 'record');
		assert.equal(box.isPublic, true);
		assert.deepEqual(box.typeParameters, ['T']);
		assert.deepEqual(box.memberIds.map(id => first.members[id]?.name), ['value', 'history']);

		const outcome = declaration(first, 'Outcome');
		assert.equal(outcome.kind, 'enum');
		assert.deepEqual(outcome.typeParameters, ['T', 'E']);
		assert.deepEqual(outcome.memberIds.map(id => first.members[id]?.name), ['Ok', 'Err', 'Empty']);

		const userId = declaration(first, 'UserId');
		assert.equal(userId.kind, 'newtype');
		assert.equal(first.types[userId.targetType!]?.name, 'Int');

		const lookup = declaration(first, 'Lookup');
		assert.equal(lookup.kind, 'alias');
		const lookupType = first.types[lookup.targetType!];
		assert.equal(lookupType?.name, 'Map');
		assert.equal(lookupType?.arguments.length, 2);
		assert.equal(first.types[lookupType!.arguments[1]!]?.name, 'UserId');
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('data type checker rejects duplicate, unknown, and invalid-arity types', async () => {
	const loaded = await loadSemanticModule();
	try {
		const result = check(loaded.module, invalidSource);
		assert.equal(result.accepted, false);
		const codes = result.diagnostics.map(item => item.code);
		assert.ok(codes.includes('L1001'), JSON.stringify(result.diagnostics, null, 2));
		assert.ok(codes.includes('L1003'), JSON.stringify(result.diagnostics, null, 2));
		assert.ok(codes.includes('L2040'), JSON.stringify(result.diagnostics, null, 2));
		assert.ok(codes.includes('L2041'), JSON.stringify(result.diagnostics, null, 2));
		assert.ok(result.diagnostics.every(item => item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function declaration(result: SemanticResult, name: string): SemanticDeclaration {
	const value = result.declarations.find(item => item.name === name);
	assert.ok(value, `missing declaration ${name}`);
	return value;
}

function validateReferences(result: SemanticResult): void {
	for (const declarationValue of result.declarations) {
		for (const memberId of declarationValue.memberIds) assert.ok(memberId >= 0 && memberId < result.members.length);
		if (declarationValue.targetType !== null) assert.ok(declarationValue.targetType >= 0 && declarationValue.targetType < result.types.length);
	}
	for (const member of result.members) {
		assert.ok(member.declarationId >= 0 && member.declarationId < result.declarations.length);
		for (const typeId of member.typeIds) assert.ok(typeId >= 0 && typeId < result.types.length);
	}
	for (const type of result.types) {
		if (type.declarationId !== null) assert.ok(type.declarationId >= 0 && type.declarationId < result.declarations.length);
		for (const argument of type.arguments) assert.ok(argument >= 0 && argument < result.types.length);
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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-semantic-data-types-'));
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
