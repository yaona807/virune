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
type ParserDiagnostic = { readonly code: string; readonly severity: string; readonly message: string; readonly span: Span };
type AstNode = {
	readonly id: number;
	readonly kind: string;
	readonly text: string;
	readonly span: Span;
	readonly children: readonly number[];
	readonly documentation: readonly string[];
};
type ParseResult = {
	readonly accepted: boolean;
	readonly root: number;
	readonly nodes: readonly AstNode[];
	readonly diagnostics: readonly ParserDiagnostic[];
};
type FrontendParserModule = {
	readonly parseFrontendContract: (source: string) => ViruneResult<string>;
};

const lambdaSource = [
	'pub fn build() -> Int {',
	'\tlet transform = fn(value: Int, apply: fn(Int) -> Int uses IO) -> Int uses IO, * => apply(value)',
	'\tlet worker = async fn(value: Int) -> Int uses IO {',
	'\t\treturn value',
	'\t}',
	'\tlet nested = fn(x: Int) => fn(y: Int) => x + y',
	'\tlet called = (fn(x: Int) => x)(1)',
	'\treturn 0',
	'}',
	'',
].join('\n');

test('lambda parser emits canonical headers, types, uses, bodies, nesting, and calls', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, lambdaSource);
		const second = parse(loaded.module, lambdaSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		assert.equal(first.nodes.filter(item => item.kind === 'LambdaExpression').length, 5);
		assert.ok(first.nodes.some(item => item.kind === 'LambdaExpression' && item.text === 'async fn'));
		assert.ok(first.nodes.some(item => item.kind === 'LambdaParameters'));
		assert.ok(first.nodes.some(item => item.kind === 'LambdaParameter' && item.text === 'value'));
		assert.ok(first.nodes.some(item => item.kind === 'FunctionTypeReference'));
		assert.ok(first.nodes.some(item => item.kind === 'NamedTypeReference' && item.text === 'Int'));
		assert.ok(first.nodes.some(item => item.kind === 'UsesClause'));
		assert.ok(first.nodes.some(item => item.kind === 'EffectName' && item.text === 'IO'));
		assert.ok(first.nodes.some(item => item.kind === 'EffectName' && item.text === '*'));
		assert.ok(first.nodes.some(item => item.kind === 'Block'));
		assert.ok(first.nodes.some(item => item.kind === 'BinaryExpression' && item.text === '+'));
		assert.ok(first.nodes.some(item => item.kind === 'ParenthesizedExpression'));
		assert.ok(first.nodes.some(item => item.kind === 'CallExpression'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('lambda parser reports a missing body and reaches a following declaration', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'pub fn broken() -> Int {',
			'\tlet value = fn(x: Int)',
			'\treturn 0',
			'}',
			'pub fn after() -> Int {',
			'\treturn 1',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.some(item => item.message.includes('Expected => or {')));
		assert.ok(result.diagnostics.some(item => item.message.includes('Expected a lambda body')));
		assert.ok(result.nodes.some(item => item.kind === 'FunctionDeclaration' && item.text === 'after'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function parse(module: FrontendParserModule, source: string): ParseResult {
	const encoded = module.parseFrontendContract(source);
	if (encoded.$tag !== 'Ok') {
		throw new Error(`Frontend parser contract failed: ${JSON.stringify(encoded.$values[0])}`);
	}
	return JSON.parse(encoded.$values[0]) as ParseResult;
}

async function loadFrontendParser(): Promise<{ readonly root: string; readonly module: FrontendParserModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-lambda-ast-'));
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
	return { root, module: await import(moduleUrl) as FrontendParserModule };
}
