import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { compileWithLegacyKernel } from '../src/selfhost/legacy-adapter.js';
import type { KernelInputV1 } from '../src/selfhost/contract.js';

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

const kernelInput = (text: string): KernelInputV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const supportedSource = [
	'//! Frontend parser',
	'/// Pair docs',
	'pub record Pair<T> derives Eq {',
	'\tleft: T',
	'\tright: T',
	'}',
	'pub enum Choice<T> {',
	'\tSome(T)',
	'\tNone',
	'}',
	'pub newtype UserId = Int',
	'pub type Maybe<T> = Option<T>',
	'/// Adds values',
	'pub fn add(left: Int, right: Int) -> Int {',
	'\tlet value = left + right * 2',
	'\tif value > 0 {',
	'\t\treturn value',
	'\t} else {',
	'\t\treturn 0',
	'\t}',
	'}',
	'pub fn main() -> Int {',
	'\treturn add(20, 1)',
	'}',
	'',
].join('\n');

test('Stage 0 frontend parser emits a canonical flat AST and agrees with Legacy acceptance', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, supportedSource);
		const second = parse(loaded.module, supportedSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.equal(first.nodes[first.root]?.kind, 'Module');
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}
		assert.deepEqual(first.nodes.find(item => item.kind === 'FunctionDeclaration' && item.text === 'add')?.documentation, ['Adds values']);
		assert.deepEqual(first.nodes[first.root]?.documentation, ['Frontend parser']);
		assert.ok(first.nodes.some(item => item.kind === 'BinaryExpression' && item.text === '*'));
		assert.ok(first.nodes.some(item => item.kind === 'BinaryExpression' && item.text === '+'));
		assert.ok(first.nodes.some(item => item.kind === 'IfStatement'));

		const legacy = await compileWithLegacyKernel(kernelInput(supportedSource));
		assert.equal(legacy.accepted, first.accepted);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('frontend parser reports multiple diagnostics and still reaches a following declaration', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = 'pub fn broken() -> Int {\n\tlet =\n\treturn\n}\npub nonsense\npub fn valid() -> Int {\n\treturn 1\n}\n';
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.length >= 2);
		assert.ok(result.diagnostics.some(item => item.message === 'Expected a local binding name'));
		assert.ok(result.diagnostics.some(item => item.message === 'Expected a declaration'));
		assert.ok(result.nodes.some(item => item.kind === 'FunctionDeclaration' && item.text === 'valid'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('frontend parser rejects unsupported and late documentation groups deterministically', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = '/// Unsupported import docs\nimport { Value } from "./value.virune"\n//! Late module docs\npub fn main() -> Unit {\n\treturn\n}\n';
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.some(item => item.code === 'L0012'));
		assert.ok(result.diagnostics.some(item => item.code === 'L0011'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('frontend parser terminates safely for bounded malformed-input regression cases', async () => {
	const loaded = await loadFrontendParser();
	try {
		const cases = [
			'',
			'@',
			'pub',
			'pub fn',
			'pub fn main(',
			'pub record Value {',
			'pub fn main() -> Int { return (((((((1 }',
			'match value { Some( => value',
			'/// unattached',
		];
		for (const source of cases) {
			const result = parse(loaded.module, source);
			assert.equal(typeof result.accepted, 'boolean');
			assert.ok(result.nodes.length >= 1);
		}
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function parse(module: FrontendParserModule, source: string): ParseResult {
	const encoded = module.parseFrontendContract(source);
	if (encoded.$tag !== 'Ok') {
		throw new Error(`Frontend parser contract failed: ${JSON.stringify(encoded.$values[0])}`);
	}
	const value = encoded.$values[0];
	return JSON.parse(value) as ParseResult;
}

async function loadFrontendParser(): Promise<{ readonly root: string; readonly module: FrontendParserModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-frontend-parser-'));
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
