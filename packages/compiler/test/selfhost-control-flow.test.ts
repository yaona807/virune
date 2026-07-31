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
type FlowNode = {
	readonly id: number;
	readonly kind: string;
	readonly children: readonly number[];
	readonly expressionType: string | null;
	readonly condition: string | null;
};
type FlowFunction = {
	readonly id: number;
	readonly name: string;
	readonly returnType: string;
	readonly bodyNodeId: number;
	readonly alwaysTerminates: boolean;
	readonly unreachableNodeIds: readonly number[];
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly functionId: number | null;
	readonly nodeId: number | null;
	readonly help: string | null;
};
type ControlFlowResult = {
	readonly accepted: boolean;
	readonly nodes: readonly FlowNode[];
	readonly functions: readonly FlowFunction[];
	readonly diagnostics: readonly Diagnostic[];
};
type ControlFlowModule = {
	readonly checkFrontendControlFlowContract: (request: string) => ViruneResult<string>;
};
type RequestNode = {
	readonly kind: string;
	readonly children: readonly number[];
	readonly expressionType: string | null;
	readonly condition: string | null;
};

test('return, Never, if, and while termination are deterministic', async () => {
	const loaded = await loadControlFlowModule();
	try {
		const request = {
			nodes: [
				node('block', [1]),
				node('if', [2, 4]),
				node('block', [3]),
				node('return'),
				node('block', [5]),
				node('expression', [], 'Never'),
				node('block', [7]),
				node('noop'),
				node('block', [9]),
				node('while', [10], null, 'true'),
				node('block', [11]),
				node('discard', [], 'Never'),
			],
			functions: [
				{ name: 'choose', returnType: 'Int', bodyNodeId: 0 },
				{ name: 'unitBody', returnType: 'Unit', bodyNodeId: 6 },
				{ name: 'forever', returnType: 'Never', bodyNodeId: 8 },
			],
		};
		const firstEncoded = evaluateEncoded(loaded.module, request);
		const secondEncoded = evaluateEncoded(loaded.module, request);
		assert.equal(firstEncoded, secondEncoded);
		const result = JSON.parse(firstEncoded) as ControlFlowResult;
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.functions.map(item => item.alwaysTerminates), [true, false, true]);
		assert.ok(result.functions.every(item => item.unreachableNodeIds.length === 0));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('missing return and unreachable statements preserve L3001 and L3006', async () => {
	const loaded = await loadControlFlowModule();
	try {
		const result = evaluate(loaded.module, {
			nodes: [
				node('block', [1, 2]),
				node('return'),
				node('noop'),
				node('block', [4]),
				node('if', [5]),
				node('block', [6]),
				node('return'),
				node('block', [8]),
				node('for', [9]),
				node('block', [10]),
				node('return'),
				node('block', [12, 13]),
				node('expression', [], 'Never'),
				node('noop'),
			],
			functions: [
				{ name: 'complete', returnType: 'Int', bodyNodeId: 0 },
				{ name: 'missing', returnType: 'String', bodyNodeId: 3 },
				{ name: 'forMissing', returnType: 'Int', bodyNodeId: 7 },
				{ name: 'neverEnd', returnType: 'Never', bodyNodeId: 11 },
			],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), ['L3006', 'L3001', 'L3001', 'L3006']);
		assert.deepEqual(result.functions.map(item => item.alwaysTerminates), [true, false, false, true]);
		assert.deepEqual(result.functions[0]?.unreachableNodeIds, [2]);
		assert.deepEqual(result.functions[3]?.unreachableNodeIds, [13]);
		assert.ok(result.diagnostics.every(item => item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('malformed and cyclic arenas return bounded diagnostics without analysis recursion', async () => {
	const loaded = await loadControlFlowModule();
	try {
		const request = {
			nodes: [
				node('block', [0]),
				node('if'),
				node('while', [3], null, 'true'),
				node('noop'),
				node('mystery'),
			],
			functions: [
				{ name: 'duplicate', returnType: 'Int', bodyNodeId: 0 },
				{ name: 'duplicate', returnType: 'Int', bodyNodeId: 1 },
				{ name: '', returnType: 'Unit', bodyNodeId: 99 },
			],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.ok(first.diagnostics.some(item => item.code === 'L1001'));
		assert.ok(first.diagnostics.filter(item => item.code === 'L9001').length >= 6);
		assert.ok(first.functions.every(item => item.alwaysTerminates === false));
		assert.ok(first.functions.every(item => item.unreachableNodeIds.length === 0));
		validateReferences(first, false);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function node(
	kind: string,
	children: readonly number[] = [],
	expressionType: string | null = null,
	condition: string | null = null,
): RequestNode {
	return { kind, children, expressionType, condition };
}

function evaluate(module: ControlFlowModule, request: unknown): ControlFlowResult {
	return JSON.parse(evaluateEncoded(module, request)) as ControlFlowResult;
}

function evaluateEncoded(module: ControlFlowModule, request: unknown): string {
	const encoded = module.checkFrontendControlFlowContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Control-flow contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateReferences(result: ControlFlowResult, requireCanonicalChildren = true): void {
	assert.deepEqual(result.nodes.map(item => item.id), result.nodes.map((_, index) => index));
	assert.deepEqual(result.functions.map(item => item.id), result.functions.map((_, index) => index));
	for (const current of result.nodes) {
		for (const childId of current.children) {
			if (requireCanonicalChildren) assert.ok(childId > current.id && childId < result.nodes.length);
		}
	}
	for (const current of result.functions) {
		if (current.bodyNodeId >= 0 && current.bodyNodeId < result.nodes.length) {
			for (const nodeId of current.unreachableNodeIds) assert.ok(nodeId >= 0 && nodeId < result.nodes.length);
		}
	}
}

async function loadControlFlowModule(): Promise<{ readonly root: string; readonly module: ControlFlowModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-control-flow-'));
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
	return { root, module: await import(moduleUrl) as ControlFlowModule };
}
