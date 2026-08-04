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

const source = [
	'pub fn inspect(values: List<Int>, index: Int) -> Int {',
	'	return combine(',
	'		declarationAt(values, index).name,',
	'		create().child()(1).name,',
	'		values[0].name,',
	'		(create()).name',
	'	)',
	'}',
	'',
].join('\n');

test('Pure Core parser builds field and invoke postfix chains for arbitrary expressions', async () => {
	const loaded = await loadParserStages();
	try {
		const result = parse(loaded.module, source);
		assert.deepEqual(result.diagnostics, []);
		const expressions = findExpressionArena(result.parsedModule);
		assert.ok(expressions, 'missing expression arena');
		for (const node of expressions) {
			for (const child of node.children) {
				assert.ok(child >= 0 && child < expressions.length, `invalid child ${child}`);
			}
		}

		const declarationField = expressions.find((node, id) =>
			node.kind === 'field'
			&& node.text === 'name'
			&& expressions[node.children[0] ?? -1]?.kind === 'call'
			&& expressions[node.children[0] ?? -1]?.text === 'declarationAt'
			&& id >= 0);
		assert.ok(declarationField);

		const childFieldId = expressions.findIndex(node =>
			node.kind === 'field'
			&& node.text === 'child'
			&& expressions[node.children[0] ?? -1]?.kind === 'call'
			&& expressions[node.children[0] ?? -1]?.text === 'create');
		assert.ok(childFieldId >= 0);
		const invokes = expressions.filter(node => node.kind === 'invoke');
		assert.equal(invokes.length, 2);
		assert.ok(invokes.some(node => node.children[0] === childFieldId && node.children.length === 1));
		assert.ok(invokes.some(node => expressions[node.children[0] ?? -1]?.kind === 'invoke' && node.children.length === 2));

		const indexedField = expressions.find(node =>
			node.kind === 'field'
			&& node.text === 'name'
			&& expressions[node.children[0] ?? -1]?.kind === 'index');
		assert.ok(indexedField);

		const groupedFields = expressions.filter(node =>
			node.kind === 'field'
			&& node.text === 'name'
			&& expressions[node.children[0] ?? -1]?.kind === 'call'
			&& expressions[node.children[0] ?? -1]?.text === 'create');
		assert.equal(groupedFields.length, 1);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function parse(module: MvpStageModule, text: string): ParseResult {
	const lexed = module.lexMvpJson(text);
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
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-postfix-member-parser-'));
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
