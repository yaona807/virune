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
type VisibilityReference = { readonly moduleId: number | null; readonly space: string; readonly name: string };
type ModuleDefinition = { readonly name: string; readonly sourceNodeId: number };
type SymbolDefinition = {
	readonly moduleId: number;
	readonly space: string;
	readonly kind: string;
	readonly name: string;
	readonly sourceNodeId: number;
	readonly isPublic: boolean;
	readonly signatureTypes: readonly VisibilityReference[];
};
type AccessRequest = { readonly requesterModuleId: number; readonly definingModuleId: number; readonly space: string; readonly name: string };
type SemanticModule = { readonly id: number; readonly name: string; readonly sourceNodeId: number };
type SemanticSymbol = SymbolDefinition & { readonly id: number; readonly signatureTypeIds: readonly number[] };
type AccessResult = AccessRequest & { readonly symbolId: number | null; readonly accessible: boolean };
type Diagnostic = { readonly code: string; readonly severity: string; readonly message: string; readonly moduleId: number | null; readonly name: string | null; readonly help: string | null };
type VisibilityResult = {
	readonly accepted: boolean;
	readonly modules: readonly SemanticModule[];
	readonly symbols: readonly SemanticSymbol[];
	readonly accesses: readonly AccessResult[];
	readonly diagnostics: readonly Diagnostic[];
};
type VisibilityModule = {
	readonly checkFrontendModuleVisibilityContract: (request: string) => ViruneResult<string>;
};

test('module visibility preserves namespaces and permits valid private and public access', async () => {
	const loaded = await loadVisibilityModule();
	try {
		const request = {
			modules: [moduleDefinition('domain', 0), moduleDefinition('main', 10)],
			symbols: [
				symbol(0, 'type', 'type', 'User', 1, true),
				symbol(0, 'value', 'function', 'createUser', 2, true, [reference(0, 'type', 'User')]),
				symbol(0, 'value', 'function', 'helper', 3, false),
				symbol(0, 'type', 'type', 'helper', 4, true),
				symbol(1, 'value', 'const', 'local', 11, false),
			],
			accesses: [
				access(0, 0, 'value', 'helper'),
				access(1, 0, 'value', 'createUser'),
				access(1, 0, 'type', 'helper'),
				access(1, 1, 'value', 'local'),
			],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true, JSON.stringify(first.diagnostics, null, 2));
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.accesses.map(item => item.accessible), [true, true, true, true]);
		const createUser = findSymbol(first, 0, 'value', 'createUser');
		const user = findSymbol(first, 0, 'type', 'User');
		assert.deepEqual(createUser.signatureTypeIds, [user.id]);
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('cross-module private access and private nominal public API exposure produce L4010', async () => {
	const loaded = await loadVisibilityModule();
	try {
		const result = evaluate(loaded.module, {
			modules: [moduleDefinition('domain', 0), moduleDefinition('main', 10)],
			symbols: [
				symbol(0, 'type', 'type', 'Internal', 1, false),
				symbol(0, 'value', 'function', 'leak', 2, true, [reference(0, 'type', 'Internal'), reference(null, 'type', 'String')]),
				symbol(0, 'value', 'function', 'helper', 3, false),
			],
			accesses: [
				access(1, 0, 'value', 'helper'),
				access(1, 0, 'value', 'missing'),
			],
		});
		assert.equal(result.accepted, false);
		assert.equal(result.accesses[0]?.accessible, false);
		assert.equal(result.accesses[0]?.symbolId, findSymbol(result, 0, 'value', 'helper').id);
		assert.equal(result.accesses[1]?.symbolId, null);
		assert.equal(result.diagnostics.filter(item => item.code === 'L4010').length, 2);
		assert.ok(result.diagnostics.some(item => item.code === 'L2040'));
		assert.ok(result.diagnostics.every(item => item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('duplicate and malformed module visibility input is deterministic and non-panicking', async () => {
	const loaded = await loadVisibilityModule();
	try {
		const request = {
			modules: [moduleDefinition('domain', 0), moduleDefinition('domain', 1), moduleDefinition('', -1)],
			symbols: [
				symbol(0, 'value', 'function', 'run', 2, true),
				symbol(0, 'value', 'function', 'run', 3, true),
				symbol(8, 'invalid', 'unknown', '', -1, false, [reference(9, 'type', '')]),
			],
			accesses: [access(9, 0, 'invalid', '')],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.ok(first.diagnostics.some(item => item.code === 'L1001'));
		assert.ok(first.diagnostics.some(item => item.code === 'L9001'));
		assert.deepEqual(first.modules.map(item => item.id), [0, 1, 2]);
		assert.deepEqual(first.symbols.map(item => item.id), [0]);
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function moduleDefinition(name: string, sourceNodeId: number): ModuleDefinition {
	return { name, sourceNodeId };
}

function reference(moduleId: number | null, space: string, name: string): VisibilityReference {
	return { moduleId, space, name };
}

function symbol(
	moduleId: number,
	space: string,
	kind: string,
	name: string,
	sourceNodeId: number,
	isPublic: boolean,
	signatureTypes: readonly VisibilityReference[] = [],
): SymbolDefinition {
	return { moduleId, space, kind, name, sourceNodeId, isPublic, signatureTypes };
}

function access(requesterModuleId: number, definingModuleId: number, space: string, name: string): AccessRequest {
	return { requesterModuleId, definingModuleId, space, name };
}

function evaluate(module: VisibilityModule, request: unknown): VisibilityResult {
	const encoded = module.checkFrontendModuleVisibilityContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Module visibility contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return JSON.parse(encoded.$values[0]) as VisibilityResult;
}

function findSymbol(result: VisibilityResult, moduleId: number, space: string, name: string): SemanticSymbol {
	const value = result.symbols.find(item => item.moduleId === moduleId && item.space === space && item.name === name);
	assert.ok(value, `missing symbol ${moduleId}:${space}:${name}`);
	return value;
}

function validateReferences(result: VisibilityResult): void {
	assert.deepEqual(result.modules.map(item => item.id), result.modules.map((_, index) => index));
	assert.deepEqual(result.symbols.map(item => item.id), result.symbols.map((_, index) => index));
	for (const symbol of result.symbols) {
		assert.ok(symbol.moduleId >= 0 && symbol.moduleId < result.modules.length);
		for (const id of symbol.signatureTypeIds) assert.ok(id >= 0 && id < result.symbols.length);
	}
	for (const item of result.accesses) {
		if (item.symbolId !== null) assert.ok(item.symbolId >= 0 && item.symbolId < result.symbols.length);
	}
}

async function loadVisibilityModule(): Promise<{ readonly root: string; readonly module: VisibilityModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-module-visibility-'));
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
	return { root, module: await import(moduleUrl) as VisibilityModule };
}
