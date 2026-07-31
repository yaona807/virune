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
type ParallelEntry = {
	readonly id: number;
	readonly name: string;
	readonly operandKind: string;
	readonly valueType: string | null;
	readonly errorType: string | null;
	readonly fieldType: string;
	readonly futureValid: boolean;
	readonly resultValid: boolean;
	readonly errorCompatible: boolean;
	readonly valid: boolean;
};
type ParallelField = { readonly name: string; readonly typeName: string };
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly entryId: number | null;
	readonly help: string | null;
};
type ParallelResult = {
	readonly accepted: boolean;
	readonly tryMode: boolean;
	readonly entries: readonly ParallelEntry[];
	readonly fields: readonly ParallelField[];
	readonly commonErrorType: string | null;
	readonly resultType: string;
	readonly diagnostics: readonly Diagnostic[];
};
type ParallelModule = {
	readonly checkFrontendParallelContract: (request: string) => ViruneResult<string>;
};

test('parallel and parallel try produce canonical result metadata deterministically', async () => {
	const loaded = await loadParallelModule();
	try {
		const normalRequest = {
			tryMode: false,
			entries: [
				{ name: 'left', operandKind: 'future', valueType: 'Int', errorType: null },
				{ name: 'right', operandKind: 'future', valueType: 'String', errorType: null },
			],
		};
		const firstEncoded = evaluateEncoded(loaded.module, normalRequest);
		const secondEncoded = evaluateEncoded(loaded.module, normalRequest);
		assert.equal(firstEncoded, secondEncoded);
		const normal = JSON.parse(firstEncoded) as ParallelResult;
		assert.equal(normal.accepted, true, JSON.stringify(normal.diagnostics, null, 2));
		assert.equal(normal.tryMode, false);
		assert.equal(normal.commonErrorType, null);
		assert.equal(normal.resultType, 'Future<{left: Int, right: String}>');
		assert.deepEqual(normal.fields, [
			{ name: 'left', typeName: 'Int' },
			{ name: 'right', typeName: 'String' },
		]);
		assert.ok(normal.entries.every(item => item.futureValid && item.resultValid && item.errorCompatible && item.valid));
		validateIds(normal);

		const tried = evaluate(loaded.module, {
			tryMode: true,
			entries: [
				{ name: 'left', operandKind: 'future', valueType: 'Int', errorType: 'IoError' },
				{ name: 'right', operandKind: 'future', valueType: 'String', errorType: 'IoError' },
			],
		});
		assert.equal(tried.accepted, true, JSON.stringify(tried.diagnostics, null, 2));
		assert.equal(tried.commonErrorType, 'IoError');
		assert.equal(tried.resultType, 'Future<Result<{left: Int, right: String}, IoError>>');
		assert.deepEqual(tried.diagnostics, []);
		assert.ok(tried.entries.every(item => item.valid));
		validateIds(tried);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('parallel diagnostics preserve Legacy ordering and field overwrite behavior', async () => {
	const loaded = await loadParallelModule();
	try {
		const result = evaluate(loaded.module, {
			tryMode: true,
			entries: [
				{ name: 'dup', operandKind: 'future', valueType: 'Int', errorType: 'IoError' },
				{ name: 'dup', operandKind: 'other', valueType: null, errorType: null },
				{ name: 'plain', operandKind: 'future', valueType: 'Bool', errorType: null },
				{ name: 'wrong', operandKind: 'future', valueType: 'String', errorType: 'OtherError' },
			],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), ['L2036', 'L2037', 'L2038', 'L2039']);
		assert.deepEqual(result.fields, [
			{ name: 'dup', typeName: 'Error' },
			{ name: 'plain', typeName: 'Error' },
			{ name: 'wrong', typeName: 'String' },
		]);
		assert.equal(result.commonErrorType, 'IoError');
		assert.equal(result.resultType, 'Future<Result<{dup: Error, plain: Error, wrong: String}, IoError>>');
		assert.deepEqual(
			result.entries.map(item => [item.futureValid, item.resultValid, item.errorCompatible, item.valid]),
			[
				[true, true, true, true],
				[false, false, true, false],
				[true, false, true, false],
				[true, true, false, false],
			],
		);
		assert.ok(result.diagnostics.every(item => item.severity === 'error' && item.help !== null));
		validateIds(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('malformed parallel requests remain bounded and deterministic', async () => {
	const loaded = await loadParallelModule();
	try {
		const request = {
			tryMode: false,
			entries: [
				{ name: '', operandKind: 'mystery', valueType: '', errorType: '' },
				{ name: 'run', operandKind: 'future', valueType: null, errorType: null },
				{ name: 'run', operandKind: 'future', valueType: 'Int', errorType: null },
			],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.deepEqual(first.diagnostics.map(item => item.code), [
			'L9001', 'L9001', 'L9001', 'L9001',
			'L9001',
			'L2036',
		]);
		assert.deepEqual(first.fields, [
			{ name: '', typeName: 'Error' },
			{ name: 'run', typeName: 'Int' },
		]);
		assert.deepEqual(first.entries.map(item => item.id), [0, 1, 2]);
		assert.ok(first.entries.every(item => item.valid === false));
		assert.ok(first.diagnostics.length <= 6);
		validateIds(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function evaluate(module: ParallelModule, request: unknown): ParallelResult {
	return JSON.parse(evaluateEncoded(module, request)) as ParallelResult;
}

function evaluateEncoded(module: ParallelModule, request: unknown): string {
	const encoded = module.checkFrontendParallelContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Parallel contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateIds(result: ParallelResult): void {
	assert.deepEqual(result.entries.map(item => item.id), result.entries.map((_, index) => index));
}

async function loadParallelModule(): Promise<{ readonly root: string; readonly module: ParallelModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-parallel-'));
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
	return { root, module: await import(moduleUrl) as ParallelModule };
}
