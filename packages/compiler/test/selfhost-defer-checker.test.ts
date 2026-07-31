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
type DeferScope = { readonly id: number; readonly kind: string; readonly name: string };
type DeferStatement = {
	readonly id: number;
	readonly scopeId: number;
	readonly expressionType: string;
	readonly contextValid: boolean;
	readonly typeValid: boolean;
	readonly valid: boolean;
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly scopeId: number | null;
	readonly statementId: number | null;
	readonly help: string | null;
};
type DeferResult = {
	readonly accepted: boolean;
	readonly scopes: readonly DeferScope[];
	readonly statements: readonly DeferStatement[];
	readonly diagnostics: readonly Diagnostic[];
};
type DeferModule = {
	readonly checkFrontendDeferContract: (request: string) => ViruneResult<string>;
};

test('function and test defer accept Unit and Never deterministically', async () => {
	const loaded = await loadDeferModule();
	try {
		const request = {
			scopes: [
				{ kind: 'function', name: 'run' },
				{ kind: 'test', name: 'cleanup test' },
			],
			statements: [
				{ scopeId: 0, expressionType: 'Unit' },
				{ scopeId: 0, expressionType: 'Never' },
				{ scopeId: 1, expressionType: 'Unit' },
			],
		};
		const firstEncoded = evaluateEncoded(loaded.module, request);
		const secondEncoded = evaluateEncoded(loaded.module, request);
		assert.equal(firstEncoded, secondEncoded);
		const result = JSON.parse(firstEncoded) as DeferResult;
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.ok(result.statements.every(item => item.valid));
		assert.deepEqual(result.scopes.map(item => item.id), [0, 1]);
		assert.deepEqual(result.statements.map(item => item.id), [0, 1, 2]);
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('invalid context and result types preserve L2070 and L2071 ordering', async () => {
	const loaded = await loadDeferModule();
	try {
		const result = evaluate(loaded.module, {
			scopes: [
				{ kind: 'module', name: 'main' },
				{ kind: 'function', name: 'run' },
			],
			statements: [
				{ scopeId: 0, expressionType: 'Unit' },
				{ scopeId: 1, expressionType: 'Int' },
				{ scopeId: 0, expressionType: 'String' },
			],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), ['L2070', 'L2071', 'L2070', 'L2071']);
		assert.deepEqual(result.statements.map(item => [item.contextValid, item.typeValid, item.valid]), [
			[false, true, false],
			[true, false, false],
			[false, false, false],
		]);
		assert.ok(result.diagnostics.every(item => item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('duplicate and malformed defer requests are bounded and deterministic', async () => {
	const loaded = await loadDeferModule();
	try {
		const request = {
			scopes: [
				{ kind: 'function', name: 'run' },
				{ kind: 'test', name: 'run' },
				{ kind: 'block', name: '' },
			],
			statements: [
				{ scopeId: 9, expressionType: 'Unit' },
				{ scopeId: -1, expressionType: '' },
			],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.ok(first.diagnostics.some(item => item.code === 'L1001'));
		assert.equal(first.diagnostics.filter(item => item.code === 'L9001').length, 5);
		assert.ok(first.statements.every(item => item.valid === false));
		validateReferences(first, false);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function evaluate(module: DeferModule, request: unknown): DeferResult {
	return JSON.parse(evaluateEncoded(module, request)) as DeferResult;
}

function evaluateEncoded(module: DeferModule, request: unknown): string {
	const encoded = module.checkFrontendDeferContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Defer contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateReferences(result: DeferResult, requireValid = true): void {
	assert.deepEqual(result.scopes.map(item => item.id), result.scopes.map((_, index) => index));
	assert.deepEqual(result.statements.map(item => item.id), result.statements.map((_, index) => index));
	for (const statement of result.statements) {
		if (requireValid || statement.scopeId >= 0 && statement.scopeId < result.scopes.length) {
			assert.ok(statement.scopeId >= 0 && statement.scopeId < result.scopes.length);
		}
	}
}

async function loadDeferModule(): Promise<{ readonly root: string; readonly module: DeferModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-defer-checker-'));
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
	return { root, module: await import(moduleUrl) as DeferModule };
}
