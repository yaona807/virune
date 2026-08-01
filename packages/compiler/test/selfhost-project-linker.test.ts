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
type ParseResult = {
	readonly accepted: boolean;
	readonly root: number;
	readonly nodes: readonly unknown[];
	readonly diagnostics: readonly unknown[];
};
type ParserApi = {
	readonly parseFrontendContract: (source: string) => ViruneResult<string>;
};
type LinkerApi = {
	readonly linkProjectJson: (request: string) => ViruneResult<string>;
};
type LinkResult = {
	readonly accepted: boolean;
	readonly dependencies: readonly {
		readonly modulePath: string;
		readonly sourceKind: string;
		readonly specifier: string;
		readonly resolvedPath: string | null;
		readonly typeOnly: boolean;
		readonly public: boolean;
	}[];
	readonly exportedSymbols: readonly {
		readonly modulePath: string;
		readonly name: string;
		readonly declarationKind: string;
	}[];
	readonly reachableModules: readonly string[];
	readonly unreachableModules: readonly string[];
	readonly diagnostics: readonly { readonly code: string }[];
};

test('project linker extracts imports and public declarations from parser AST', async () => {
	const loaded = await loadLinker();
	try {
		const helper = 'pub fn value() -> Int {\n\treturn 1\n}\n';
		const main = [
			'import { value } from "./helper.virune"',
			'pub fn main() -> Int {',
			'\treturn value()',
			'}',
			'',
		].join('\n');
		const result = link(loaded, 'src/main.virune', [
			{ path: 'src/helper.virune', source: helper, parse: parse(loaded.parser, helper) },
			{ path: 'src/main.virune', source: main, parse: parse(loaded.parser, main) },
		]);
		assert.equal(result.accepted, true);
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.dependencies, [{
			modulePath: 'src/main.virune',
			sourceKind: 'virune',
			specifier: './helper.virune',
			resolvedPath: 'src/helper.virune',
			typeOnly: false,
			public: false,
		}]);
		assert.deepEqual(result.exportedSymbols, [
			{ modulePath: 'src/helper.virune', name: 'value', declarationKind: 'FunctionDeclaration' },
			{ modulePath: 'src/main.virune', name: 'main', declarationKind: 'FunctionDeclaration' },
		]);
		assert.deepEqual(result.reachableModules, ['src/helper.virune', 'src/main.virune']);
		assert.deepEqual(result.unreachableModules, []);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('project linker reports cycles, duplicate imports, and missing targets deterministically', async () => {
	const loaded = await loadLinker();
	try {
		const a = [
			'import { b } from "./b.virune"',
			'import { b } from "./b.virune"',
			'pub fn a() -> Int {',
			'\treturn b()',
			'}',
			'',
		].join('\n');
		const b = [
			'import { a } from "./a.virune"',
			'import { missing } from "./missing.virune"',
			'pub fn b() -> Int {',
			'\treturn a()',
			'}',
			'',
		].join('\n');
		const result = link(loaded, 'src/a.virune', [
			{ path: 'src/a.virune', source: a, parse: parse(loaded.parser, a) },
			{ path: 'src/b.virune', source: b, parse: parse(loaded.parser, b) },
		]);
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), [
			'SHP2105',
			'SHP2102',
			'SHP2105',
			'SHP2105',
			'SHP2104',
		]);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function parse(module: ParserApi, source: string): ParseResult {
	const encoded = module.parseFrontendContract(source);
	assert.equal(encoded.$tag, 'Ok');
	const result = JSON.parse(encoded.$values[0]) as ParseResult;
	assert.equal(result.accepted, true);
	return result;
}

function link(
	loaded: { readonly linker: LinkerApi },
	entryPath: string,
	modules: readonly { readonly path: string; readonly source: string; readonly parse: ParseResult }[],
): LinkResult {
	const encoded = loaded.linker.linkProjectJson(JSON.stringify({ entryPath, modules }));
	assert.equal(encoded.$tag, 'Ok');
	return JSON.parse(encoded.$values[0]) as LinkResult;
}

async function loadLinker(): Promise<{
	readonly root: string;
	readonly parser: ParserApi;
	readonly linker: LinkerApi;
}> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-project-linker-'));
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
	return {
		root,
		parser: await import(`${pathToFileURL(join(root, 'main.js')).href}?parser=${Date.now()}`) as ParserApi,
		linker: await import(`${pathToFileURL(join(root, 'project-linker.js')).href}?linker=${Date.now()}`) as LinkerApi,
	};
}
