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
type Diagnostic = { readonly code: string; readonly severity: string; readonly message: string; readonly span: Span; readonly help: string | null };
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
type RequestValue = { readonly typeName: string; readonly disposition: string; readonly span: Span };

const source = [
	'@mustUse',
	'pub record Token {',
	'\tvalue: String,',
	'}',
	'@mustUse',
	'pub enum Decision {',
	'\tYes',
	'\tNo',
	'}',
	'@mustUse',
	'pub newtype Handle = Int',
	'pub type TokenAlias = Token',
	'pub type TokenAlias2 = TokenAlias',
	'pub type ResultAlias = Result<Int, String>',
	'pub type Plain = Int',
	'',
].join('\n');

test('local must-use declarations and consumed values are canonical and deterministic', async () => {
	const loaded = await loadMustUseModule();
	try {
		const request = {
			source,
			values: [
				value('Token', 'bind', 20),
				value('Decision', 'return', 21),
				value('Handle', 'discard', 22),
				value('TokenAlias', 'await', 23),
				value('TokenAlias2', 'handle', 24),
				value('ResultAlias', 'bind', 25),
				value('Result', 'handle', 26),
				value('Plain', 'expression', 27),
			],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true, JSON.stringify(first.diagnostics, null, 2));
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.declarations.map(item => item.name), ['Token', 'Decision', 'Handle']);
		assert.deepEqual(first.declarations.map(item => item.declarationId), [0, 1, 2]);
		assert.deepEqual(classification(first, 'Token'), [true, 'attribute', true]);
		assert.deepEqual(classification(first, 'Decision'), [true, 'attribute', true]);
		assert.deepEqual(classification(first, 'Handle'), [true, 'attribute', true]);
		assert.deepEqual(classification(first, 'TokenAlias'), [true, 'alias', true]);
		assert.deepEqual(classification(first, 'TokenAlias2'), [true, 'alias', true]);
		assert.deepEqual(classification(first, 'ResultAlias'), [true, 'alias', true]);
		assert.deepEqual(classification(first, 'Result'), [true, 'result', true]);
		assert.deepEqual(classification(first, 'Plain'), [false, 'ordinary', false]);
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('ignored local, aliased, and Result values emit L2097', async () => {
	const loaded = await loadMustUseModule();
	try {
		const result = evaluate(loaded.module, {
			source,
			values: [
				value('Token', 'expression', 30),
				value('TokenAlias2', 'expression', 31),
				value('Result', 'expression', 32),
				value('Plain', 'expression', 33),
			],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(codes(result), ['L2097', 'L2097', 'L2097']);
		assert.deepEqual(classification(result, 'Token'), [true, 'attribute', false]);
		assert.deepEqual(classification(result, 'TokenAlias2'), [true, 'alias', false]);
		assert.deepEqual(classification(result, 'Result'), [true, 'result', false]);
		assert.deepEqual(classification(result, 'Plain'), [false, 'ordinary', false]);
		assert.ok(result.diagnostics.every(item => item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('@mustUse target and argument restrictions match legacy diagnostics', async () => {
	const loaded = await loadMustUseModule();
	try {
		const invalidSource = [
			'@mustUse(reason)',
			'record InvalidArgs {',
			'\tvalue: Int,',
			'}',
			'@mustUse',
			'type InvalidAlias = Int',
			'@mustUse',
			'fn invalidFunction() -> Unit {',
			'\treturn Unit',
			'}',
			'',
		].join('\n');
		const result = evaluate(loaded.module, { source: invalidSource, values: [] });
		assert.equal(result.accepted, false);
		assert.deepEqual(codes(result).sort(), ['L2090', 'L2090', 'L2091']);
		assert.deepEqual(result.declarations.map(item => item.name), ['InvalidArgs']);
		assert.ok(result.diagnostics.every(item => item.help !== null));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('unknown type handles and dispositions return bounded diagnostics', async () => {
	const loaded = await loadMustUseModule();
	try {
		const result = evaluate(loaded.module, {
			source,
			values: [value('MissingType', 'expression', 40), value('Plain', 'drop', 41)],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(codes(result), ['L2040', 'L9001']);
		assert.equal(result.values[0]?.typeId, null);
		assert.equal(result.values[1]?.consumed, false);
		assert.ok(result.diagnostics.every(item => item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function value(typeName: string, disposition: string, line: number): RequestValue {
	return { typeName, disposition, span: span(line) };
}

function span(line: number): Span {
	return {
		start: { offset: line * 10, line, column: 1 },
		end: { offset: line * 10 + 5, line, column: 6 },
	};
}

function evaluate(module: MustUseModule, request: unknown): MustUseResult {
	const encoded = module.checkFrontendMustUseContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Must-use contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return JSON.parse(encoded.$values[0]) as MustUseResult;
}

function classification(result: MustUseResult, typeName: string): readonly [boolean, string, boolean] {
	const valueResult = result.values.find(item => item.typeName === typeName);
	assert.ok(valueResult, `missing value result ${typeName}`);
	return [valueResult.mustUse, valueResult.reason, valueResult.consumed];
}

function codes(result: MustUseResult): string[] {
	return result.diagnostics.map(item => item.code);
}

function validateReferences(result: MustUseResult): void {
	for (const declaration of result.declarations) assert.ok(declaration.declarationId >= 0);
	for (const valueResult of result.values) {
		if (valueResult.typeId !== null) assert.ok(valueResult.typeId >= 0 && valueResult.typeId < result.typeCount);
	}
}

async function loadMustUseModule(): Promise<{ readonly root: string; readonly module: MustUseModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-must-use-'));
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
