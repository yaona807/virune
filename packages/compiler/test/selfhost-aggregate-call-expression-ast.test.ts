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

const aggregateSource = [
	'pub fn aggregate(value: Int, y: Int) -> Int {',
	'\tlet list = [1, value + 1, y,]',
	'\tlet grouped = (value + 1)',
	'\tlet tuple = (value, y)',
	'\tlet point = Point { x: value, y, }',
	'\tlet called = build<Result<Int>>(point, list,)',
	'\tlet updated = point with { x: called, y, }',
	'\tdiscard grouped',
	'\tdiscard tuple',
	'\tdiscard updated',
	'\treturn called',
	'}',
	'',
].join('\n');

test('aggregate parser emits detailed list, tuple, record, call, and update nodes', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, aggregateSource);
		const second = parse(loaded.module, aggregateSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		const list = first.nodes.find(item => item.kind === 'ListExpression');
		assert.ok(list);
		assert.equal(list.children.length, 3);
		const grouped = first.nodes.find(item => item.kind === 'ParenthesizedExpression');
		assert.ok(grouped);
		assert.equal(grouped.children.length, 1);
		const tuple = first.nodes.find(item => item.kind === 'TupleExpression');
		assert.ok(tuple);
		assert.equal(tuple.children.length, 2);
		const record = first.nodes.find(item => item.kind === 'RecordExpression' && item.text === 'Point');
		assert.ok(record);
		assert.equal(record.children.length, 1);
		const entries = first.nodes.filter(item => item.kind === 'RecordEntry');
		assert.ok(entries.some(item => item.text === 'x' && item.children.length === 1));
		assert.ok(entries.some(item => item.text === 'y' && item.children.length === 0));
		const typedCall = first.nodes.find(item => item.kind === 'CallExpression' && item.children.length === 3);
		assert.ok(typedCall);
		assert.ok(first.nodes.some(item => item.kind === 'TypeArguments'));
		const callArguments = first.nodes.find(item => item.kind === 'CallArguments' && item.children.length === 2);
		assert.ok(callArguments);
		const update = first.nodes.find(item => item.kind === 'RecordUpdateExpression');
		assert.ok(update);
		assert.equal(update.children.length, 2);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('aggregate parser recovers at item boundaries and reaches a following declaration', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'pub fn broken() -> Int {',
			'\tlet list = [1,,2,]',
			'\tlet point = Point { broken 1, valid: 2, }',
			'\tlet called = make(1,,2,)',
			'\treturn 0',
			'}',
			'pub fn after() -> Int {',
			'\treturn 1',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.length >= 3);
		assert.ok(result.nodes.some(item => item.kind === 'RecordEntry' && item.text === 'valid'));
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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-aggregate-call-expression-ast-'));
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
