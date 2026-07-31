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

const statementSource = [
	'pub fn statements(values: List<Int>) -> Int {',
	'\tlet mut total: Int = 0',
	'\tlet current = total',
	'\ttotal = total + 1',
	'\tif total > 0 {',
	'\t\tdiscard current',
	'\t} else if total == 0 {',
	'\t\tdefer cleanup(total)',
	'\t} else {',
	'\t\treturn 0',
	'\t}',
	'\twhile total < 10 {',
	'\t\ttotal = total + 1',
	'\t\tbreak',
	'\t}',
	'\tfor item in values {',
	'\t\tdiscard item',
	'\t\tcontinue',
	'\t}',
	'\treturn total',
	'}',
	'',
].join('\n');

test('statement parser emits detailed bindings, assignments, and control flow', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, statementSource);
		const second = parse(loaded.module, statementSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		const mutableBinding = first.nodes.find(item => item.kind === 'LetBinding' && item.text === 'mut total');
		assert.ok(mutableBinding);
		assert.equal(mutableBinding.children.length, 1);
		assert.ok(first.nodes.some(item => item.kind === 'NamedTypeReference' && item.text === 'Int'));
		const immutableBinding = first.nodes.find(item => item.kind === 'LetBinding' && item.text === 'current');
		assert.ok(immutableBinding);
		assert.equal(immutableBinding.children.length, 0);
		assert.ok(first.nodes.some(item => item.kind === 'AssignmentTarget' && item.text === 'total'));
		const assignments = first.nodes.filter(item => item.kind === 'AssignmentStatement');
		assert.ok(assignments.length >= 2);
		assert.ok(assignments.every(item => item.children.length === 2));
		const forBinding = first.nodes.find(item => item.kind === 'ForBinding' && item.text === 'item');
		assert.ok(forBinding);
		const forStatement = first.nodes.find(item => item.kind === 'ForStatement');
		assert.ok(forStatement);
		assert.equal(forStatement.children.length, 3);
		assert.ok(first.nodes.filter(item => item.kind === 'IfStatement').length >= 2);
		assert.ok(first.nodes.some(item => item.kind === 'WhileStatement'));
		assert.ok(first.nodes.some(item => item.kind === 'BreakStatement'));
		assert.ok(first.nodes.some(item => item.kind === 'ContinueStatement'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('statement parser recovers after malformed headers and reaches following declarations', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'pub fn broken(values: List<Int>) -> Int {',
			'\tlet mut : Int = 1',
			'\tlet typed: = 2',
			'\ttotal =',
			'\tfor in values {',
			'\t\tdiscard 1',
			'\t}',
			'\ttotal = 3',
			'\treturn total',
			'}',
			'pub fn after() -> Int {',
			'\treturn 1',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.length >= 4);
		assert.ok(result.nodes.some(item => item.kind === 'AssignmentTarget' && item.text === 'total'));
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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-statement-detail-ast-'));
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
