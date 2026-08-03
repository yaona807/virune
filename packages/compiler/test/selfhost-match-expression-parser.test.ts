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
type MvpStageModule = {
	readonly lexMvpJson: (source: string) => ViruneResult<string>;
	readonly parseMvpJson: (encoded: string) => ViruneResult<string>;
};
type ExpressionNode = {
	readonly kind: string;
	readonly text: string;
	readonly children: readonly number[];
};
type ParseResult = {
	readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
	readonly parsedModule: unknown;
};

const matchSource = [
	'pub fn inspect(value: Int) -> Int {',
	'\treturn match value {',
	'\t\tSome(first) => first',
	'\t\tListType(BoolElement) => 2',
	'\t\t1 => 1',
	'\t\t_ => 0',
	'\t}',
	'}',
	'',
].join('\n');

const nestedMatchSource = [
	'pub fn inspect(value: Int) -> Int {',
	'\treturn match value {',
	'\t\tSome(inner) => match inner {',
	'\t\t\tNone => 0',
	'\t\t\tSome(found) => found',
	'\t\t}',
	'\t\t_ => 1',
	'\t}',
	'}',
	'',
].join('\n');

test('Pure Core parser emits a flat match and pattern arena', async () => {
	const loaded = await loadParserStages();
	try {
		const result = parse(loaded.module, matchSource);
		assert.deepEqual(result.diagnostics, []);
		const expressions = findExpressionArena(result.parsedModule);
		assert.ok(expressions, 'missing expression arena');

		const kinds = expressions.map(item => item.kind);
		assert.ok(kinds.includes('match'));
		assert.equal(kinds.filter(item => item === 'matchArm').length, 4);
		assert.ok(kinds.includes('patternVariant'));
		assert.ok(kinds.includes('patternBinding'));
		assert.ok(kinds.includes('patternLiteral'));
		assert.ok(kinds.includes('patternWildcard'));

		const matchNode = expressions.find(item => item.kind === 'match');
		assert.ok(matchNode);
		assert.equal(matchNode.children.length, 5);
		for (const node of expressions) {
			for (const child of node.children) {
				assert.ok(child >= 0 && child < expressions.length, `invalid child ${child}`);
			}
		}

		const nestedVariant = expressions.find(item => item.kind === 'patternVariant' && item.text === 'ListType');
		assert.ok(nestedVariant);
		assert.equal(nestedVariant.children.length, 1);
		const nestedChildId = nestedVariant.children[0];
		assert.ok(nestedChildId !== undefined);
		assert.equal(expressions[nestedChildId]?.text, 'BoolElement');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('Pure Core parser supports nested match expressions', async () => {
	const loaded = await loadParserStages();
	try {
		const result = parse(loaded.module, nestedMatchSource);
		assert.deepEqual(result.diagnostics, []);
		const expressions = findExpressionArena(result.parsedModule);
		assert.ok(expressions);
		assert.equal(expressions.filter(item => item.kind === 'match').length, 2);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('Pure Core parser reports a missing match arm arrow', async () => {
	const loaded = await loadParserStages();
	try {
		const result = parse(loaded.module, [
			'pub fn inspect(value: Int) -> Int {',
			'\treturn match value {',
			'\t\tSome(found) found',
			'\t}',
			'}',
			'',
		].join('\n'));
		assert.equal(result.diagnostics[0]?.code, 'L0002');
		assert.match(result.diagnostics[0]?.message ?? '', /Expected =>/);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function parse(module: MvpStageModule, source: string): ParseResult {
	const lexed = module.lexMvpJson(source);
	assert.equal(lexed.$tag, 'Ok', JSON.stringify(lexed));
	const parsed = module.parseMvpJson(lexed.$values[0]);
	assert.equal(parsed.$tag, 'Ok', JSON.stringify(parsed));
	return JSON.parse(parsed.$values[0]) as ParseResult;
}

function findExpressionArena(value: unknown): ExpressionNode[] | undefined {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findExpressionArena(item);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	if (value === null || typeof value !== 'object') return undefined;
	const record = value as Record<string, unknown>;
	if (Array.isArray(record.expressions) && record.expressions.every(isExpressionNode)) {
		return record.expressions as ExpressionNode[];
	}
	for (const child of Object.values(record)) {
		const found = findExpressionArena(child);
		if (found !== undefined) return found;
	}
	return undefined;
}

function isExpressionNode(value: unknown): value is ExpressionNode {
	if (value === null || typeof value !== 'object') return false;
	const record = value as Record<string, unknown>;
	return typeof record.kind === 'string'
		&& typeof record.text === 'string'
		&& Array.isArray(record.children)
		&& record.children.every(item => Number.isInteger(item));
}

async function loadParserStages(): Promise<{ readonly root: string; readonly module: MvpStageModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-match-parser-'));
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
	const lexerUrl = `${pathToFileURL(join(root, 'lexer.js')).href}?test=${Date.now()}`;
	const parserUrl = `${pathToFileURL(join(root, 'parser.js')).href}?test=${Date.now()}`;
	const lexer = await import(lexerUrl) as Pick<MvpStageModule, 'lexMvpJson'>;
	const parser = await import(parserUrl) as Pick<MvpStageModule, 'parseMvpJson'>;
	return { root, module: { ...lexer, ...parser } };
}
