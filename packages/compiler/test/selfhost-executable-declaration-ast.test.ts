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

const declarationSource = [
	'@api',
	'pub async fn choose<T, U>(left: T, right: U) -> U uses io, * {',
	'\treturn right',
	'}',
	'fn identity<T>(value: T) -> T => value',
	'async test "async smoke" {',
	'\tdiscard await run()',
	'}',
	'pub const answer: Int = 42',
	'let inferred = answer',
	'',
].join('\n');

test('parser emits detailed function, test, and top-level value declarations', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, declarationSource);
		const second = parse(loaded.module, declarationSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		const choose = first.nodes.find(item => item.kind === 'FunctionDeclaration' && item.text === 'choose');
		const identity = first.nodes.find(item => item.kind === 'FunctionDeclaration' && item.text === 'identity');
		assert.ok(choose);
		assert.ok(identity);
		assert.ok(first.nodes.some(item => item.kind === 'FunctionModifiers' && item.text === 'public async'));
		assert.ok(first.nodes.some(item => item.kind === 'TypeParameters' && item.children.length === 2));
		assert.ok(first.nodes.some(item => item.kind === 'TypeParameter' && item.text === 'T'));
		assert.ok(first.nodes.some(item => item.kind === 'TypeParameter' && item.text === 'U'));
		const parameters = first.nodes.filter(item => item.kind === 'Parameters');
		assert.ok(parameters.some(item => item.children.length === 2));
		assert.ok(first.nodes.some(item => item.kind === 'Parameter' && item.text === 'left' && item.children.length === 1));
		assert.ok(first.nodes.some(item => item.kind === 'Parameter' && item.text === 'right' && item.children.length === 1));
		assert.ok(first.nodes.some(item => item.kind === 'ReturnType' && item.children.length === 1));
		assert.ok(first.nodes.some(item => item.kind === 'UsesClause' && item.children.length === 2));
		assert.ok(first.nodes.some(item => item.kind === 'Effect' && item.text === 'io'));
		assert.ok(first.nodes.some(item => item.kind === 'Effect' && item.text === '*'));
		assert.ok(choose.children.some(id => first.nodes[id]?.kind === 'Block'));
		assert.ok(identity.children.some(id => first.nodes[id]?.kind === 'Identifier'));

		const testDeclaration = first.nodes.find(item => item.kind === 'TestDeclaration');
		assert.ok(testDeclaration);
		assert.equal(testDeclaration.text, '"async smoke"');
		assert.ok(testDeclaration.children.some(id => first.nodes[id]?.kind === 'TestModifiers'));
		assert.ok(testDeclaration.children.some(id => first.nodes[id]?.kind === 'Block'));

		const answer = first.nodes.find(item => item.kind === 'TopLevelBinding' && item.text === 'public const answer');
		const inferred = first.nodes.find(item => item.kind === 'TopLevelBinding' && item.text === 'let inferred');
		assert.ok(answer);
		assert.ok(inferred);
		assert.equal(answer.children.length, 1);
		assert.equal(inferred.children.length, 0);
		const values = first.nodes.filter(item => item.kind === 'TopLevelValueDeclaration');
		assert.equal(values.length, 2);
		assert.ok(values.every(item => item.children.length === 2));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('parser recovers after malformed executable declaration headers', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'pub async fn broken(value Int) -> Int {',
			'\treturn 0',
			'}',
			'async test {',
			'\tdiscard 1',
			'}',
			'pub const : Int = 1',
			'pub fn after() -> Int {',
			'\treturn 1',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.length >= 3);
		assert.ok(result.nodes.some(item => item.kind === 'FunctionDeclaration' && item.text === 'broken'));
		assert.ok(result.nodes.some(item => item.kind === 'TestDeclaration'));
		assert.ok(result.nodes.some(item => item.kind === 'TopLevelValueDeclaration'));
		assert.ok(result.nodes.some(item => item.kind === 'FunctionDeclaration' && item.text === 'after'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function parse(module: FrontendParserModule, source: string): ParseResult {
	const encoded = module.parseFrontendContract(source);
	if (encoded.$tag !== 'Ok') {
		throw new Error('Frontend parser contract failed: ' + JSON.stringify(encoded.$values[0]));
	}
	return JSON.parse(encoded.$values[0]) as ParseResult;
}

async function loadFrontendParser(): Promise<{ readonly root: string; readonly module: FrontendParserModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => item.code + ':' + item.message), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-executable-declaration-ast-'));
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
	const moduleUrl = pathToFileURL(join(root, 'main.js')).href + '?test=' + Date.now();
	return { root, module: await import(moduleUrl) as FrontendParserModule };
}
