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

const patternSource = [
	'pub fn inspect(value: Int) -> Int {',
	'\treturn match value {',
	'\t\tOk([first, ...rest]) | Err((first, second)) if first > 0 => first',
	'\t\tPoint { x, y: 0, ... } => x',
	'\t\t1..=5 => 1',
	'\t\t_ => 0',
	'\t}',
	'}',
	'',
].join('\n');

test('match parser emits canonical guarded arms and nested pattern nodes', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, patternSource);
		const second = parse(loaded.module, patternSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		const match = findNode(first, 'MatchExpression', 'match');
		assert.equal(match.children.length, 5);
		assert.equal(first.nodes.filter(item => item.kind === 'MatchArm').length, 4);
		assert.ok(first.nodes.some(item => item.kind === 'OrPattern'));
		assert.ok(first.nodes.some(item => item.kind === 'VariantPattern' && item.text === 'Ok'));
		assert.ok(first.nodes.some(item => item.kind === 'ListPattern'));
		assert.ok(first.nodes.some(item => item.kind === 'RestPattern' && item.text === 'rest'));
		assert.ok(first.nodes.some(item => item.kind === 'TuplePattern'));
		assert.ok(first.nodes.some(item => item.kind === 'RecordPattern' && item.text === 'Point'));
		assert.ok(first.nodes.some(item => item.kind === 'RecordPatternField' && item.text === 'y'));
		assert.ok(first.nodes.some(item => item.kind === 'RecordRestPattern'));
		assert.ok(first.nodes.some(item => item.kind === 'RangePattern'));
		assert.ok(first.nodes.some(item => item.kind === 'WildcardPattern'));
		assert.ok(first.nodes.some(item => item.kind === 'BinaryExpression' && item.text === '>'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('match parser recovers from a malformed arm and reaches following declarations', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'pub fn broken(value: Int) -> Int {',
			'\treturn match value {',
			'\t\t0 1',
			'\t\t_ => 0',
			'\t}',
			'}',
			'pub fn after() -> Int {',
			'\treturn 1',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.some(item => item.message.includes('Expected =>')));
		assert.ok(result.nodes.some(item => item.kind === 'WildcardPattern'));
		assert.ok(result.nodes.some(item => item.kind === 'FunctionDeclaration' && item.text === 'after'));
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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-match-pattern-ast-'));
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
