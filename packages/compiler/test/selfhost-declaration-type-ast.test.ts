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

const detailedSource = [
	'/// Envelope docs',
	'pub record Envelope<T> {',
	'\tvalue: Map<String, List<T?>>',
	'\tpair: (Int, String)',
	'\titems: [T]',
	'}',
	'pub enum Outcome<T, E> {',
	'\tOk(T)',
	'\tErr(E)',
	'\tEmpty',
	'}',
	'pub newtype UserId = Int',
	'pub type Handler<T> = (T) -> Outcome<T, String>',
	'pub fn main() -> Int {',
	'\treturn 0',
	'}',
	'',
].join('\n');

test('detailed declaration parser emits canonical record, enum, and type-reference nodes', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, detailedSource);
		const second = parse(loaded.module, detailedSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		const envelope = findNode(first, 'RecordDeclaration', 'Envelope');
		assert.deepEqual(envelope.documentation, ['Envelope docs']);
		assert.equal(findNode(first, 'RecordField', 'value').children.length, 1);
		assert.equal(findNode(first, 'RecordField', 'pair').children.length, 1);
		assert.equal(findNode(first, 'RecordField', 'items').children.length, 1);
		assert.ok(first.nodes.some(item => item.kind === 'TypeParameter' && item.text === 'T'));
		assert.ok(first.nodes.some(item => item.kind === 'GenericTypeReference' && item.text === 'Map'));
		assert.ok(first.nodes.some(item => item.kind === 'GenericTypeReference' && item.text === 'List'));
		assert.ok(first.nodes.some(item => item.kind === 'OptionalTypeReference'));
		assert.ok(first.nodes.some(item => item.kind === 'TupleTypeReference'));
		assert.ok(first.nodes.some(item => item.kind === 'ListTypeReference'));
		assert.ok(first.nodes.some(item => item.kind === 'FunctionTypeReference'));

		assert.equal(findNode(first, 'EnumVariant', 'Ok').children.length, 1);
		assert.equal(findNode(first, 'EnumVariant', 'Err').children.length, 1);
		assert.deepEqual(findNode(first, 'EnumVariant', 'Empty').children, []);
		assert.equal(findNode(first, 'NewtypeDeclaration', 'UserId').children.length, 1);
		assert.ok(findNode(first, 'TypeAliasDeclaration', 'Handler').children.length >= 2);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('detailed declaration parser recovers after malformed fields and variants', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'pub record Broken<T> {',
			'\tmissing T',
			'\tvalid: List<T>',
			'}',
			'pub enum Fault<E> {',
			'\tBad(E',
			'\tEmpty',
			'}',
			'pub fn main() -> Int {',
			'\treturn 0',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.length >= 2);
		assert.ok(result.diagnostics.some(item => item.message.includes('Expected :')));
		assert.ok(result.diagnostics.some(item => item.message.includes('enum payload')));
		assert.ok(result.nodes.some(item => item.kind === 'RecordField' && item.text === 'valid'));
		assert.ok(result.nodes.some(item => item.kind === 'EnumVariant' && item.text === 'Empty'));
		assert.ok(result.nodes.some(item => item.kind === 'FunctionDeclaration' && item.text === 'main'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function findNode(result: ParseResult, kind: string, text: string): AstNode {
	const node = result.nodes.find(item => item.kind === kind && item.text === text);
	assert.ok(node, `missing ${kind}:${text}`);
	return node;
}

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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-declaration-type-ast-'));
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
