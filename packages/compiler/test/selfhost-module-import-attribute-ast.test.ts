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

const moduleSource = [
	'unsafe module',
	'pub import type { Foo as LocalFoo, Bar } from "./types.virune"',
	'import js { parse as parseJson } from "json"',
	'import js defaultValue from "pkg"',
	'import js * as namespace from "pkg-ns"',
	'import js "side-effect"',
	'@trace("record", 1)',
	'pub record Box<T> {',
	'\tvalue: T',
	'}',
	'@bench',
	'test "smoke" {',
	'\tdiscard 1',
	'}',
	'',
].join('\n');

test('module parser emits detailed directives, imports, and attached attributes', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, moduleSource);
		const second = parse(loaded.module, moduleSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		assert.ok(first.nodes.some(item => item.kind === 'UnsafeModule'));
		const imports = first.nodes.filter(item => item.kind === 'ImportDeclaration');
		assert.equal(imports.length, 5);
		assert.ok(imports.some(item => item.text === 'virune public type'));
		assert.ok(imports.some(item => item.text === 'javascript named'));
		assert.ok(imports.some(item => item.text === 'javascript default'));
		assert.ok(imports.some(item => item.text === 'javascript namespace'));
		assert.ok(imports.some(item => item.text === 'javascript side-effect'));
		assert.ok(first.nodes.some(item => item.kind === 'ImportItem' && item.text === 'Foo as LocalFoo'));
		assert.ok(first.nodes.some(item => item.kind === 'ImportItem' && item.text === '* as namespace'));
		assert.equal(first.nodes.filter(item => item.kind === 'ImportSource').length, 5);

		const trace = first.nodes.find(item => item.kind === 'Attribute' && item.text === 'trace');
		const bench = first.nodes.find(item => item.kind === 'Attribute' && item.text === 'bench');
		assert.ok(trace);
		assert.ok(bench);
		assert.equal(trace.children.length, 1);
		assert.equal(bench.children.length, 0);
		const record = first.nodes.find(item => item.kind === 'RecordDeclaration' && item.text === 'Box');
		const testDeclaration = first.nodes.find(item => item.kind === 'TestDeclaration');
		assert.ok(record);
		assert.ok(testDeclaration);
		assert.ok(record.children.includes(trace.id));
		assert.ok(testDeclaration.children.includes(bench.id));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('module parser recovers after malformed imports and attributes', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'import { Foo as } from "./bad.virune"',
			'import js * namespace from "bad"',
			'@("missing")',
			'pub record Recovered {',
			'\tvalue: Int',
			'}',
			'pub fn after() -> Int {',
			'\treturn 1',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.length >= 3);
		assert.ok(result.nodes.some(item => item.kind === 'RecordDeclaration' && item.text === 'Recovered'));
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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-module-import-attribute-ast-'));
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
