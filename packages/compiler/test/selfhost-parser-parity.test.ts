import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ILexingError, IRecognitionException } from 'chevrotain';
import { buildProject } from '../src/project/project.js';
import { parse as parseLegacy } from '../src/syntax/parser.js';
import { lex as lexLegacy } from '../src/syntax/tokens.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const corpusPath = join(repositoryRoot, '.github', 'self-hosting', 'parser-parity-corpus-v1.json');

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
type MutationId =
	| 'remove-first-colon'
	| 'remove-first-comma'
	| 'remove-first-equals'
	| 'remove-first-fat-arrow'
	| 'remove-first-bar'
	| 'remove-first-greater'
	| 'remove-first-rparen'
	| 'remove-last-rbrace';
type CorpusCase = {
	readonly id: string;
	readonly tags: readonly string[];
	readonly source: string;
	readonly comparePrimaryDiagnostic: boolean;
	readonly mutations: readonly MutationId[];
};
type DivergencePolicy = {
	readonly caseId: string;
	readonly path: string;
	readonly reason: string;
	readonly expires: string;
};
type Corpus = {
	readonly schemaVersion: 1;
	readonly cases: readonly CorpusCase[];
	readonly expectedDivergences: readonly DivergencePolicy[];
};
type DiagnosticSignature = {
	readonly code: string;
	readonly severity: string;
	readonly start: Position;
	readonly end: Position;
};
type ParityDifference = {
	readonly caseId: string;
	readonly path: string;
	readonly legacy: unknown;
	readonly selfhost: unknown;
};

const mutationTokens: Readonly<Record<MutationId, { readonly text: string; readonly last?: boolean }>> = {
	'remove-first-colon': { text: ':' },
	'remove-first-comma': { text: ',' },
	'remove-first-equals': { text: '=' },
	'remove-first-fat-arrow': { text: '=>' },
	'remove-first-bar': { text: '|' },
	'remove-first-greater': { text: '>' },
	'remove-first-rparen': { text: ')' },
	'remove-last-rbrace': { text: '}', last: true },
};

test('self-host parser matches Legacy acceptance and primary diagnostic contract', async () => {
	const corpus = await loadCorpus();
	const loaded = await loadFrontendParser();
	try {
		const differences: ParityDifference[] = [];
		for (const fixture of corpus.cases) {
			const legacy = parseLegacySyntax(fixture.source);
			const first = parseSelfhost(loaded.module, fixture.source);
			const second = parseSelfhost(loaded.module, fixture.source);
			assert.deepEqual(first, second, `${fixture.id}: self-host output is not deterministic`);
			assertCanonical(first, fixture.id);
			compareValue(differences, fixture.id, '$.accepted', legacy.accepted, first.accepted);
			if (fixture.comparePrimaryDiagnostic) {
				compareValue(
					differences,
					fixture.id,
					'$.diagnostics[0]',
					legacy.diagnostics[0] ?? null,
					first.diagnostics[0] === undefined ? null : selfhostDiagnosticSignature(first.diagnostics[0]),
				);
			}
			for (const mutation of fixture.mutations) {
				const mutatedSource = mutate(fixture.source, mutation);
				const mutationId = `${fixture.id}:${mutation}`;
				const legacyMutation = parseLegacySyntax(mutatedSource);
				const firstMutation = parseSelfhost(loaded.module, mutatedSource);
				const secondMutation = parseSelfhost(loaded.module, mutatedSource);
				assert.deepEqual(firstMutation, secondMutation, `${mutationId}: self-host mutation output is not deterministic`);
				assertCanonical(firstMutation, mutationId);
				compareValue(differences, mutationId, '$.accepted', legacyMutation.accepted, firstMutation.accepted);
			}
		}
		assertParityPolicy(corpus, differences);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function compareValue(
	differences: ParityDifference[],
	caseId: string,
	path: string,
	legacy: unknown,
	selfhost: unknown,
): void {
	if (JSON.stringify(legacy) === JSON.stringify(selfhost)) return;
	differences.push({ caseId, path, legacy, selfhost });
}

function assertParityPolicy(corpus: Corpus, differences: readonly ParityDifference[]): void {
	const today = new Date().toISOString().slice(0, 10);
	const policyKeys = new Set<string>();
	for (const policy of corpus.expectedDivergences) {
		assert.match(policy.expires, /^\d{4}-\d{2}-\d{2}$/u, `${policy.caseId}:${policy.path}: invalid expiry`);
		assert.ok(policy.reason.trim().length > 0, `${policy.caseId}:${policy.path}: empty reason`);
		assert.ok(policy.expires >= today, `${policy.caseId}:${policy.path}: expired on ${policy.expires}`);
		const key = `${policy.caseId}\u0000${policy.path}`;
		assert.equal(policyKeys.has(key), false, `${policy.caseId}:${policy.path}: duplicate policy`);
		policyKeys.add(key);
	}
	const differenceKeys = new Set(differences.map(item => `${item.caseId}\u0000${item.path}`));
	const unexpected = differences.filter(item => !policyKeys.has(`${item.caseId}\u0000${item.path}`));
	const stale = corpus.expectedDivergences.filter(item => !differenceKeys.has(`${item.caseId}\u0000${item.path}`));
	assert.deepEqual(unexpected, [], `Unexplained parser differences:\n${JSON.stringify(unexpected, null, 2)}`);
	assert.deepEqual(stale, [], `Stale parser divergence policies:\n${JSON.stringify(stale, null, 2)}`);
}

function assertCanonical(result: ParseResult, id: string): void {
	assert.deepEqual(result.nodes.map(item => item.id), result.nodes.map((_, index) => index), `${id}: non-canonical IDs`);
	if (result.root >= 0) assert.ok(result.root < result.nodes.length, `${id}: invalid root ID`);
	for (const node of result.nodes) {
		for (const child of node.children) {
			assert.ok(child >= 0 && child < result.nodes.length, `${id}: node ${node.id} has invalid child ${child}`);
		}
	}
}

function mutate(source: string, mutation: MutationId): string {
	const rule = mutationTokens[mutation];
	const index = rule.last === true ? source.lastIndexOf(rule.text) : source.indexOf(rule.text);
	if (index >= 0) return source.slice(0, index) + source.slice(index + rule.text.length);
	return source.length === 0 ? '?' : source.slice(0, -1);
}

function parseSelfhost(module: FrontendParserModule, source: string): ParseResult {
	const encoded = module.parseFrontendContract(source);
	if (encoded.$tag !== 'Ok') throw new Error(`Self-host parser transport failed: ${JSON.stringify(encoded.$values[0])}`);
	return JSON.parse(encoded.$values[0]) as ParseResult;
}

function parseLegacySyntax(source: string): { readonly accepted: boolean; readonly diagnostics: readonly DiagnosticSignature[] } {
	const normalized = source.endsWith('\n') ? source : `${source}\n`;
	const lexed = lexLegacy(normalized);
	const parsed = parseLegacy(lexed.tokens);
	const diagnostics = [
		...lexed.errors.map(error => legacyLexDiagnostic(error)),
		...parsed.errors.map(error => legacyParserDiagnostic(normalized, error)),
	];
	return { accepted: diagnostics.length === 0, diagnostics };
}

function legacyLexDiagnostic(error: ILexingError): DiagnosticSignature {
	const line = error.line ?? 1;
	const column = error.column ?? 1;
	return {
		code: 'L0001',
		severity: 'error',
		start: { offset: error.offset, line, column },
		end: { offset: error.offset + error.length, line, column: column + error.length },
	};
}

function legacyParserDiagnostic(source: string, error: IRecognitionException): DiagnosticSignature {
	const token = error.token;
	const startOffset = finitePosition(token.startOffset, source.length, 0);
	const endOffset = Math.min(source.length, Math.max(startOffset, finitePosition(token.endOffset, startOffset, 0)));
	const startLine = finitePosition(token.startLine, lineAt(source, startOffset), 1);
	const startColumn = finitePosition(token.startColumn, columnAt(source, startOffset), 1);
	const endLine = finitePosition(token.endLine, startLine, 1);
	const endColumn = finitePosition(token.endColumn, startColumn, 1) + (endOffset === startOffset ? 0 : 1);
	return {
		code: 'L0002',
		severity: 'error',
		start: { offset: startOffset, line: startLine, column: startColumn },
		end: { offset: endOffset, line: endLine, column: endColumn },
	};
}

function selfhostDiagnosticSignature(diagnostic: ParserDiagnostic): DiagnosticSignature {
	const endOffset = diagnostic.code === 'L0002' && diagnostic.span.end.offset > diagnostic.span.start.offset
		? diagnostic.span.end.offset - 1
		: diagnostic.span.end.offset;
	const zeroWidth = endOffset === diagnostic.span.start.offset
		&& diagnostic.span.end.line === diagnostic.span.start.line;
	return {
		code: diagnostic.code,
		severity: diagnostic.severity,
		start: diagnostic.span.start,
		end: {
			...diagnostic.span.end,
			offset: endOffset,
			column: zeroWidth ? diagnostic.span.start.column : diagnostic.span.end.column,
		},
	};
}

function finitePosition(value: number | undefined, fallback: number, minimum: number): number {
	return value !== undefined && Number.isFinite(value) && value >= minimum ? value : fallback;
}

function lineAt(text: string, offset: number): number {
	let line = 1;
	for (let index = 0; index < offset; index++) if (text[index] === '\n') line++;
	return line;
}

function columnAt(text: string, offset: number): number {
	return offset - text.lastIndexOf('\n', Math.max(0, offset - 1));
}

async function loadCorpus(): Promise<Corpus> {
	const raw = JSON.parse(await readFile(corpusPath, 'utf8')) as unknown;
	assert.ok(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'Parser parity corpus must be an object');
	const record = raw as Record<string, unknown>;
	assert.equal(record.schemaVersion, 1);
	assert.ok(Array.isArray(record.cases));
	assert.ok(Array.isArray(record.expectedDivergences));
	const identifiers = new Set<string>();
	const cases = record.cases.map((value, index) => {
		assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `cases[${index}] must be an object`);
		const item = value as Record<string, unknown>;
		assert.equal(typeof item.id, 'string');
		assert.ok((item.id as string).length > 0);
		assert.equal(identifiers.has(item.id as string), false, `Duplicate case ${String(item.id)}`);
		identifiers.add(item.id as string);
		assert.equal(typeof item.source, 'string');
		assert.ok(Array.isArray(item.tags) && item.tags.every(tag => typeof tag === 'string' && tag.length > 0));
		assert.ok(Array.isArray(item.mutations) && item.mutations.every(mutation => typeof mutation === 'string' && mutation in mutationTokens));
		return {
			id: item.id as string,
			tags: item.tags as string[],
			source: item.source as string,
			comparePrimaryDiagnostic: item.comparePrimaryDiagnostic === true,
			mutations: item.mutations as MutationId[],
		};
	});
	const expectedDivergences = record.expectedDivergences.map((value, index) => {
		assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `expectedDivergences[${index}] must be an object`);
		const item = value as Record<string, unknown>;
		for (const key of ['caseId', 'path', 'reason', 'expires']) assert.equal(typeof item[key], 'string', `expectedDivergences[${index}].${key}`);
		return item as unknown as DivergencePolicy;
	});
	return { schemaVersion: 1, cases, expectedDivergences };
}

async function loadFrontendParser(): Promise<{ readonly root: string; readonly module: FrontendParserModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-parser-parity-'));
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
