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
type FfiType = {
	readonly id: number;
	readonly kind: string;
	readonly name: string | null;
	readonly safe: boolean;
	readonly primitiveKey: boolean;
	readonly valid: boolean;
};
type FfiFunction = {
	readonly id: number;
	readonly externId: number;
	readonly name: string;
	readonly safe: boolean;
	readonly valid: boolean;
};
type FfiExport = { readonly id: number; readonly name: string; readonly safe: boolean; readonly valid: boolean };
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly entryKind: string;
	readonly entryId: number | null;
	readonly typeId: number | null;
	readonly help: string | null;
};
type FfiResult = {
	readonly accepted: boolean;
	readonly types: readonly FfiType[];
	readonly externFunctions: readonly FfiFunction[];
	readonly exports: readonly FfiExport[];
	readonly diagnostics: readonly Diagnostic[];
};
type FfiModule = {
	readonly checkFrontendFfiContract: (request: string) => ViruneResult<string>;
};

const baseTypes = [
	{ id: 0, kind: 'primitive', name: 'Int', children: [], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 1, kind: 'primitive', name: 'String', children: [], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 2, kind: 'named', name: 'JsError', children: [1], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 3, kind: 'result', name: null, children: [0, 2], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 4, kind: 'future', name: null, children: [3], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 5, kind: 'function', name: null, children: [], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 6, kind: 'foreign', name: 'Date', children: [], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 7, kind: 'map', name: null, children: [], keyId: 0, valueId: 1, openGeneric: false, shapeKnown: true },
	{ id: 8, kind: 'map', name: null, children: [], keyId: 2, valueId: 1, openGeneric: false, shapeKnown: true },
	{ id: 9, kind: 'set', name: null, children: [1], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 10, kind: 'named', name: 'Payload', children: [0, 1], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 11, kind: 'named', name: 'OpenBox', children: [0], keyId: null, valueId: null, openGeneric: true, shapeKnown: true },
	{ id: 12, kind: 'named', name: 'Cycle', children: [12], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
	{ id: 13, kind: 'primitive', name: 'Never', children: [], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
] as const;

test('canonical FFI boundary decisions are deterministic and reference-safe', async () => {
	const loaded = await loadFfiModule();
	try {
		const request = {
			types: baseTypes,
			externs: [{
				module: 'node:fs',
				unsafe: false,
				moduleUnsafe: false,
				sourcePath: 'service.virune',
				platform: 'node',
				functions: [{
					name: 'readCount',
					parameters: [{ name: 'path', typeId: 1, optional: false }],
					returnTypeId: 3,
				}],
			}],
			exports: [{
				name: 'encodePayload',
				declarationKind: 'function',
				public: true,
				generic: false,
				attributeArgumentCount: 0,
				parameterTypeIds: [10],
				returnTypeId: 1,
			}],
		};
		const firstEncoded = evaluateEncoded(loaded.module, request);
		const secondEncoded = evaluateEncoded(loaded.module, request);
		assert.equal(firstEncoded, secondEncoded);
		const result = JSON.parse(firstEncoded) as FfiResult;
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.types.map(item => item.id), result.types.map((_, index) => index));
		assert.deepEqual(result.externFunctions.map(item => item.id), [0]);
		assert.deepEqual(result.exports.map(item => item.id), [0]);
		assert.equal(result.types[0]?.safe, true);
		assert.equal(result.types[0]?.primitiveKey, true);
		assert.equal(result.types[7]?.safe, true);
		assert.equal(result.types[8]?.safe, false);
		assert.equal(result.types[11]?.safe, false);
		assert.equal(result.types[12]?.safe, false);
		assert.equal(result.types[13]?.safe, false);
		assert.equal(result.externFunctions[0]?.valid, true);
		assert.equal(result.exports[0]?.valid, true);
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('safe extern and module policy diagnostics preserve Legacy ordering', async () => {
	const loaded = await loadFfiModule();
	try {
		const result = evaluate(loaded.module, {
			types: baseTypes,
			externs: [
				{
					module: 'node:fs',
					unsafe: false,
					moduleUnsafe: false,
					sourcePath: 'service.virune',
					platform: 'browser',
					functions: [{
						name: 'broken',
						parameters: [
							{ name: 'callback', typeId: 5, optional: true },
							{ name: 'value', typeId: 6, optional: false },
						],
						returnTypeId: 5,
					}],
				},
				{
					module: 'legacy',
					unsafe: true,
					moduleUnsafe: false,
					sourcePath: 'service.virune',
					platform: 'neutral',
					functions: [{ name: 'unsafeCall', parameters: [], returnTypeId: 6 }],
				},
				{
					module: 'legacy',
					unsafe: true,
					moduleUnsafe: true,
					sourcePath: 'outside.virune',
					platform: 'neutral',
					functions: [],
				},
			],
			exports: [],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), [
			'L4006',
			'L4213',
			'L2115',
			'L4213',
			'L4001',
			'L4213',
			'L4007',
			'L4008',
			'L4008',
			'L4009',
		]);
		assert.ok(result.diagnostics.every(item => item.severity === 'error' && item.help !== null));
		assert.equal(result.externFunctions[0]?.valid, false);
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('@jsExport and malformed arena diagnostics remain bounded', async () => {
	const loaded = await loadFfiModule();
	try {
		const malformedTypes = [
			...baseTypes,
			{ id: 14, kind: 'list', name: null, children: [99], keyId: null, valueId: null, openGeneric: false, shapeKnown: true },
			{ id: 22, kind: 'mystery', name: null, children: [], keyId: null, valueId: null, openGeneric: false, shapeKnown: false },
		];
		const request = {
			types: malformedTypes,
			externs: [],
			exports: [{
				name: 'bad',
				declarationKind: 'record',
				public: false,
				generic: true,
				attributeArgumentCount: 1,
				parameterTypeIds: [6],
				returnTypeId: 5,
			}],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.deepEqual(first.diagnostics.map(item => item.code), [
			'L9001',
			'L9001',
			'L9001',
			'L2052',
			'L2053',
			'L2054',
			'L2055',
			'L4213',
			'L4213',
		]);
		assert.ok(first.diagnostics.length <= 9);
		assert.equal(first.exports[0]?.valid, false);
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function evaluate(module: FfiModule, request: unknown): FfiResult {
	return JSON.parse(evaluateEncoded(module, request)) as FfiResult;
}

function evaluateEncoded(module: FfiModule, request: unknown): string {
	const encoded = module.checkFrontendFfiContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`FFI contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateReferences(result: FfiResult): void {
	for (const diagnostic of result.diagnostics) {
		if (diagnostic.typeId !== null && diagnostic.typeId >= 0 && diagnostic.code !== 'L9001') {
			assert.ok(diagnostic.typeId < result.types.length, `invalid type reference ${diagnostic.typeId}`);
		}
		if (diagnostic.entryKind === 'externFunction' && diagnostic.entryId !== null) {
			assert.ok(diagnostic.entryId >= 0 && diagnostic.entryId < result.externFunctions.length);
		}
		if (diagnostic.entryKind === 'export' && diagnostic.entryId !== null) {
			assert.ok(diagnostic.entryId >= 0 && diagnostic.entryId < result.exports.length);
		}
	}
}

async function loadFfiModule(): Promise<{ readonly root: string; readonly module: FfiModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-ffi-'));
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
	return { root, module: await import(moduleUrl) as FfiModule };
}
