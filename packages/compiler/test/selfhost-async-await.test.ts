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
type AsyncContext = {
	readonly id: number;
	readonly kind: string;
	readonly name: string;
	readonly isAsync: boolean;
	readonly declaredEffects: readonly string[];
	readonly wildcard: boolean;
};
type AwaitExpression = {
	readonly id: number;
	readonly contextId: number;
	readonly operandKind: string;
	readonly operandType: string;
	readonly awaitedType: string | null;
	readonly resultType: string | null;
	readonly contextValid: boolean;
	readonly operandValid: boolean;
	readonly requiredEffects: readonly string[];
	readonly missingEffects: readonly string[];
	readonly valid: boolean;
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly contextId: number | null;
	readonly expressionId: number | null;
	readonly effect: string | null;
	readonly help: string | null;
};
type AsyncAwaitResult = {
	readonly accepted: boolean;
	readonly contexts: readonly AsyncContext[];
	readonly expressions: readonly AwaitExpression[];
	readonly diagnostics: readonly Diagnostic[];
};
type AsyncAwaitModule = {
	readonly checkFrontendAsyncAwaitContract: (request: string) => ViruneResult<string>;
};

test('async function and test await Future and PromiseLike deterministically', async () => {
	const loaded = await loadAsyncAwaitModule();
	try {
		const request = {
			contexts: [
				{ kind: 'function', name: 'load', isAsync: true, declaredEffects: [] },
				{ kind: 'test', name: 'browser promise', isAsync: true, declaredEffects: ['*'] },
				{ kind: 'function', name: 'bridge', isAsync: true, declaredEffects: ['JavaScript', 'Console', 'JavaScript'] },
			],
			expressions: [
				{ contextId: 0, operandKind: 'future', operandType: 'Future<Int>', awaitedType: 'Int' },
				{ contextId: 1, operandKind: 'foreign', operandType: 'PromiseLike<String>', awaitedType: 'String' },
				{ contextId: 2, operandKind: 'foreign', operandType: 'PromiseLike<Bool>', awaitedType: 'Bool' },
			],
		};
		const firstEncoded = evaluateEncoded(loaded.module, request);
		const secondEncoded = evaluateEncoded(loaded.module, request);
		assert.equal(firstEncoded, secondEncoded);
		const result = JSON.parse(firstEncoded) as AsyncAwaitResult;
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.contexts.map(item => item.id), [0, 1, 2]);
		assert.deepEqual(result.expressions.map(item => item.id), [0, 1, 2]);
		assert.deepEqual(result.contexts[2]?.declaredEffects, ['Console', 'JavaScript']);
		assert.equal(result.contexts[1]?.wildcard, true);
		assert.deepEqual(result.expressions.map(item => item.resultType), ['Int', 'String', 'Bool']);
		assert.deepEqual(result.expressions.map(item => item.requiredEffects), [[], ['JavaScript'], ['JavaScript']]);
		assert.ok(result.expressions.every(item => item.missingEffects.length === 0 && item.valid));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('context, effect, and operand diagnostics preserve Legacy ordering', async () => {
	const loaded = await loadAsyncAwaitModule();
	try {
		const result = evaluate(loaded.module, {
			contexts: [
				{ kind: 'module', name: 'main', isAsync: false, declaredEffects: [] },
				{ kind: 'function', name: 'sync', isAsync: false, declaredEffects: [] },
				{ kind: 'function', name: 'bridge', isAsync: true, declaredEffects: [] },
			],
			expressions: [
				{ contextId: 0, operandKind: 'foreign', operandType: 'PromiseLike<Int>', awaitedType: null },
				{ contextId: 1, operandKind: 'other', operandType: 'Int', awaitedType: null },
				{ contextId: 2, operandKind: 'foreign', operandType: 'PromiseLike<String>', awaitedType: 'String' },
			],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), [
			'L2022', 'L2076', 'L2023',
			'L2022', 'L2023',
			'L2076',
		]);
		assert.deepEqual(result.expressions.map(item => [item.contextValid, item.operandValid, item.valid]), [
			[false, false, false],
			[false, false, false],
			[true, true, false],
		]);
		assert.deepEqual(result.expressions.map(item => item.missingEffects), [['JavaScript'], [], ['JavaScript']]);
		assert.ok(result.diagnostics.every(item => item.severity === 'error' && item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('duplicate and malformed async await requests are bounded and deterministic', async () => {
	const loaded = await loadAsyncAwaitModule();
	try {
		const request = {
			contexts: [
				{ kind: 'function', name: 'run', isAsync: true, declaredEffects: [] },
				{ kind: 'test', name: 'run', isAsync: true, declaredEffects: [] },
				{ kind: 'block', name: '', isAsync: false, declaredEffects: [] },
			],
			expressions: [
				{ contextId: 9, operandKind: 'future', operandType: 'Future<Int>', awaitedType: 'Int' },
				{ contextId: -1, operandKind: 'mystery', operandType: '', awaitedType: '' },
				{ contextId: 0, operandKind: 'future', operandType: 'Future<String>', awaitedType: null },
			],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.equal(first.diagnostics.filter(item => item.code === 'L1001').length, 1);
		assert.equal(first.diagnostics.filter(item => item.code === 'L9001').length, 8);
		assert.ok(first.expressions.every(item => item.valid === false));
		validateReferences(first, false);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function evaluate(module: AsyncAwaitModule, request: unknown): AsyncAwaitResult {
	return JSON.parse(evaluateEncoded(module, request)) as AsyncAwaitResult;
}

function evaluateEncoded(module: AsyncAwaitModule, request: unknown): string {
	const encoded = module.checkFrontendAsyncAwaitContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Async await contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateReferences(result: AsyncAwaitResult, requireValid = true): void {
	assert.deepEqual(result.contexts.map(item => item.id), result.contexts.map((_, index) => index));
	assert.deepEqual(result.expressions.map(item => item.id), result.expressions.map((_, index) => index));
	for (const expression of result.expressions) {
		if (requireValid || expression.contextId >= 0 && expression.contextId < result.contexts.length) {
			assert.ok(expression.contextId >= 0 && expression.contextId < result.contexts.length);
		}
	}
}

async function loadAsyncAwaitModule(): Promise<{ readonly root: string; readonly module: AsyncAwaitModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-async-await-'));
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
	return { root, module: await import(moduleUrl) as AsyncAwaitModule };
}
