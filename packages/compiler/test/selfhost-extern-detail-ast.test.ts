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

const externSource = [
	'unsafe extern js "node:fs" {',
	'\tasync fn read(path: String, options?: Int,) -> String uses io = "readFile"',
	'\tfn stat(path: String) -> Int = "statSync"',
	'}',
	'pub fn after() -> Int {',
	'\treturn 1',
	'}',
	'',
].join('\n');

test('parser emits detailed extern declarations and members', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, externSource);
		const second = parse(loaded.module, externSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		const declaration = first.nodes.find(item => item.kind === 'ExternDeclaration');
		assert.ok(declaration);
		assert.ok(declaration.children.some(id => first.nodes[id]?.kind === 'ExternModifiers'));
		assert.ok(declaration.children.some(id => first.nodes[id]?.kind === 'ExternSource'));
		const members = declaration.children.map(id => first.nodes[id]).filter(item => item?.kind === 'ExternFunction');
		assert.equal(members.length, 2);
		assert.ok(first.nodes.some(item => item.kind === 'ExternFunctionModifiers' && item.text === 'async'));
		const parameters = first.nodes.filter(item => item.kind === 'ExternParameters');
		assert.ok(parameters.some(item => item.children.length === 2));
		assert.ok(first.nodes.some(item => item.kind === 'ExternParameter' && item.text === 'path' && item.children.length === 1));
		assert.ok(first.nodes.some(item => item.kind === 'ExternParameter' && item.text === 'optional options' && item.children.length === 1));
		assert.equal(first.nodes.filter(item => item.kind === 'ReturnType').length >= 2, true);
		assert.ok(first.nodes.some(item => item.kind === 'UsesClause'));
		assert.ok(first.nodes.some(item => item.kind === 'ExternBinding' && item.text === '"readFile"'));
		assert.ok(first.nodes.some(item => item.kind === 'ExternBinding' && item.text === '"statSync"'));
		assert.ok(first.nodes.some(item => item.kind === 'FunctionDeclaration' && item.text === 'after'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('parser recovers after malformed extern members', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'extern js {',
			'\tfn missingColon(value Int) -> Int = "broken"',
			'\tfn missingBinding(value: Int) -> Int =',
			'\tfn recovered(value: Int) -> Int = "ok"',
			'}',
			'pub fn after() -> Int {',
			'\treturn 1',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.length >= 3);
		assert.ok(result.nodes.some(item => item.kind === 'ExternFunction' && item.text === 'recovered'));
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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-extern-detail-ast-'));
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
