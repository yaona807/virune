import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const corpusRoot = join(repositoryRoot, 'packages', 'compiler', 'test', 'fixtures', 'selfhost-control-flow-v1');
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
type FunctionExpectation = {
	readonly name: string;
	readonly alwaysTerminates: boolean;
	readonly unreachableNodeIds: readonly number[];
};
type CorpusCase = {
	readonly id: string;
	readonly request: string;
	readonly accepted: boolean;
	readonly diagnosticCodes: readonly string[];
	readonly canonicalReferences: boolean;
	readonly functions: readonly FunctionExpectation[];
};
type CorpusManifest = { readonly version: number; readonly cases: readonly CorpusCase[] };

test('versioned self-host control-flow corpus is deterministic and reference-safe', async t => {
	const manifest = await loadManifest();
	assert.equal(manifest.version, 1);
	assert.deepEqual(manifest.cases.map(item => item.id), [...manifest.cases.map(item => item.id)].sort());
	assert.equal(new Set(manifest.cases.map(item => item.id)).size, manifest.cases.length);
	assert.equal(new Set(manifest.cases.map(item => item.request)).size, manifest.cases.length);

	const loaded = await loadControlFlowModule();
	try {
		for (const fixture of manifest.cases) {
			await t.test(fixture.id, async () => {
				validateFixtureShape(fixture);
				const requestPath = resolve(corpusRoot, fixture.request);
				const requestRelative = relative(corpusRoot, requestPath);
				assert.equal(
					requestRelative.startsWith('..') || isAbsolute(requestRelative),
					false,
					`${fixture.id}: request escapes corpus root`,
				);
				const request = JSON.parse(await readFile(requestPath, 'utf8')) as unknown;

				const firstEncoded = checkEncoded(loaded.module, request);
				const secondEncoded = checkEncoded(loaded.module, request);
				assert.equal(firstEncoded, secondEncoded, `${fixture.id}: serialization changed between identical runs`);

				const result = JSON.parse(firstEncoded) as ControlFlowResult;
				assert.equal(result.accepted, fixture.accepted, fixture.id);
				assert.deepEqual(result.diagnostics.map(item => item.code), fixture.diagnosticCodes, fixture.id);
				assert.ok(result.diagnostics.every(item => item.severity === 'error'), `${fixture.id}: non-error diagnostic`);
				assert.ok(result.diagnostics.every(item => item.help !== null), `${fixture.id}: diagnostic help is missing`);
				assert.deepEqual(
					result.functions.map(({ name, alwaysTerminates, unreachableNodeIds }) => ({
						name,
						alwaysTerminates,
						unreachableNodeIds,
					})),
					fixture.functions,
					`${fixture.id}: functions`,
				);
				validateCanonicalReferences(result, fixture);
			});
		}
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadManifest(): Promise<CorpusManifest> {
	const parsed = JSON.parse(await readFile(join(corpusRoot, 'corpus.json'), 'utf8')) as CorpusManifest;
	assert.ok(Array.isArray(parsed.cases));
	return parsed;
}

function validateFixtureShape(fixture: CorpusCase): void {
	assert.equal(fixture.functions.length > 0, true, `${fixture.id}: no functions`);
	assert.equal(new Set(fixture.functions.map(item => item.name)).size === fixture.functions.length, fixture.id !== 'malformed-arena');
	for (const expected of fixture.functions) {
		assert.deepEqual(
			expected.unreachableNodeIds,
			[...new Set(expected.unreachableNodeIds)].sort((left, right) => left - right),
			`${fixture.id}: unreachable IDs are not canonical`,
		);
	}
}

function checkEncoded(module: ControlFlowModule, request: unknown): string {
	const encoded = module.checkFrontendControlFlowContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Control-flow contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateCanonicalReferences(result: ControlFlowResult, fixture: CorpusCase): void {
	assert.deepEqual(result.nodes.map(item => item.id), result.nodes.map((_, index) => index), `${fixture.id}: node IDs`);
	assert.deepEqual(
		result.functions.map(item => item.id),
		result.functions.map((_, index) => index),
		`${fixture.id}: function IDs`,
	);
	if (!fixture.canonicalReferences) return;
	for (const node of result.nodes) {
		for (const childId of node.children) {
			assert.ok(childId > node.id && childId < result.nodes.length, `${fixture.id}: child ${childId}`);
		}
	}
	for (const current of result.functions) {
		assertReference(current.bodyNodeId, result.nodes.length, `${fixture.id}: function body`);
		assert.equal(result.nodes[current.bodyNodeId]?.kind, 'block', `${fixture.id}: body is not a block`);
		for (const nodeId of current.unreachableNodeIds) {
			assertReference(nodeId, result.nodes.length, `${fixture.id}: unreachable node`);
		}
	}
}

function assertReference(id: number, length: number, message: string): void {
	assert.ok(Number.isInteger(id) && id >= 0 && id < length, `${message}: ${id}/${length}`);
}

async function loadControlFlowModule(): Promise<{ readonly root: string; readonly module: ControlFlowModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-control-flow-corpus-'));
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
