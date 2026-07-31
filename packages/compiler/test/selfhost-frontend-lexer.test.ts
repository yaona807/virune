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
type ViruneEnum = string | { readonly tag: string; readonly values: readonly unknown[] };
type Position = { readonly offset: number; readonly line: number; readonly column: number };
type Span = { readonly start: Position; readonly end: Position };
type Token = { readonly kind: ViruneEnum; readonly text: string; readonly span: Span };
type Comment = { readonly kind: ViruneEnum; readonly text: string; readonly span: Span };
type Diagnostic = { readonly code: string; readonly severity: string; readonly message: string; readonly span: Span };
type LexResult = {
	readonly tokens: readonly Token[];
	readonly comments: readonly Comment[];
	readonly diagnostics: readonly Diagnostic[];
};

type FrontendLexerModule = {
	readonly lexFrontend: (source: string) => ViruneResult<string>;
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

test('Stage 0 frontend lexer recognizes the complete lexical vocabulary deterministically', async () => {
	const loaded = await loadFrontendLexer();
	try {
		const source = [
			'pub async fn main<T>(value: Int) -> Bool uses io {',
			'\tlet hex = 0x2a',
			'\tlet binary = 0b1010n',
			'\tlet ratio = 1_2.5e+2',
			'\treturn value >= 2 && value != 0 || false',
			'}',
			'',
		].join('\n');
		const first = lex(loaded.module, source);
		const second = lex(loaded.module, source);
		assert.deepEqual(first, second);
		assert.deepEqual(first.diagnostics, []);
		assert.equal(enumTag(first.tokens.at(-1)?.kind), 'EndOfFile');
		assert.deepEqual(
			first.tokens.filter(item => enumTag(item.kind) !== 'NewLine' && enumTag(item.kind) !== 'EndOfFile').map(item => item.text),
			['pub', 'async', 'fn', 'main', '<', 'T', '>', '(', 'value', ':', 'Int', ')', '->', 'Bool', 'uses', 'io', '{', 'let', 'hex', '=', '0x2a', 'let', 'binary', '=', '0b1010n', 'let', 'ratio', '=', '1_2.5e+2', 'return', 'value', '>=', '2', '&&', 'value', '!=', '0', '||', 'false', '}'],
		);
		assert.equal(enumTag(first.tokens.find(item => item.text === '0x2a')?.kind), 'IntLiteral');
		assert.equal(enumTag(first.tokens.find(item => item.text === '0b1010n')?.kind), 'BigIntLiteral');
		assert.equal(enumTag(first.tokens.find(item => item.text === '1_2.5e+2')?.kind), 'FloatLiteral');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('frontend lexer preserves comment metadata and normalizes CRLF positions', async () => {
	const loaded = await loadFrontendLexer();
	try {
		const result = lex(loaded.module, '//! Module docs\r\n\r\n/// Item docs\r\n@deprecated\r\npub fn main() -> Unit {\r\n\treturn\r\n}\r\n//// ordinary\r\n');
		assert.deepEqual(result.comments.map(item => [enumTag(item.kind), item.text]), [
			['ModuleDocumentation', 'Module docs'],
			['DeclarationDocumentation', 'Item docs'],
			['Ordinary', '// ordinary'],
		]);
		assert.equal(result.comments[1]?.span.start.line, 3);
		assert.equal(result.tokens.find(item => item.text === '@')?.span.start.line, 4);
		assert.deepEqual(result.diagnostics, []);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('frontend lexer applies the normative soft-line rules without suppressing brace line ends', async () => {
	const loaded = await loadFrontendLexer();
	try {
		const source = 'pub fn main(\nvalue: Int,\n) -> Int {\nlet first = value +\n1\nif first > 0 {\nreturn first\n}\nelse {\nreturn 0\n}\n}\n';
		const result = lex(loaded.module, source);
		const newLines = result.tokens.filter(item => enumTag(item.kind) === 'NewLine').map(item => item.span.start.line);
		assert.deepEqual(newLines, [3, 5, 6, 7, 9, 10, 11, 12]);
		assert.deepEqual(result.diagnostics, []);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('frontend lexer reports malformed literals and agrees with Legacy on lexical rejection', async () => {
	const loaded = await loadFrontendLexer();
	try {
		const source = 'pub fn main() -> Int {\n\tlet value = $bad\n\treturn value\n}\n';
		const result = lex(loaded.module, source);
		assert.equal(result.diagnostics[0]?.code, 'L0001');
		assert.equal(result.diagnostics[0]?.message, 'Unexpected character $');
		const legacy = await compileWithLegacyKernel(kernelInput(source));
		assert.equal(legacy.accepted, false);
		assert.equal(legacy.diagnostics[0]?.code, result.diagnostics[0]?.code);
		assert.equal(legacy.diagnostics[0]?.span.start.line, result.diagnostics[0]?.span.start.line);
		assert.equal(legacy.diagnostics[0]?.span.start.column, result.diagnostics[0]?.span.start.column);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function enumTag(value: ViruneEnum | undefined): string | undefined {
	return typeof value === 'string' ? value : value?.tag;
}

function lex(module: FrontendLexerModule, source: string): LexResult {
	const encoded = module.lexFrontend(source);
	assert.equal(encoded.$tag, 'Ok');
	const value = encoded.$values[0];
	assert.equal(typeof value, 'string');
	return JSON.parse(value) as LexResult;
}

async function loadFrontendLexer(): Promise<{ readonly root: string; readonly module: FrontendLexerModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-frontend-lexer-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) {
		await execFileAsync(process.execPath, ['--check', outputPath]);
	}
	const moduleUrl = `${pathToFileURL(join(root, 'frontend-lexer.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as FrontendLexerModule };
}
