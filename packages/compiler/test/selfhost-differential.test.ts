import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import type { KernelInputV1, KernelOutputV1 } from '../src/selfhost/contract.js';
import { writeDifferentialArtifacts } from '../src/selfhost/differential-artifacts.js';
import {
	DifferentialPolicyError,
	runDifferentialCase,
	type DifferentialExecutionV1,
	type DifferentialKernelV1,
} from '../src/selfhost/differential-harness.js';
import { compileWithLegacyKernel } from '../src/selfhost/legacy-adapter.js';
import { executeKernelOutputWithNode } from '../src/selfhost/node-executor.js';

const input = (): KernelInputV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: 'pub fn main() -> Int {\n\treturn 7\n}\n' }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: true, sourcesContent: true },
});

const output = (): KernelOutputV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	accepted: true,
	diagnostics: [],
	emittedModules: [
		{ sourcePath: 'src/z.virune', outputPath: '.selfhost-output/src/z.js', code: 'export const z = 2;\n', sourceMap: '{"version":3,"sources":["src/z.virune"]}' },
		{ sourcePath: 'src/main.virune', outputPath: '.selfhost-output/src/main.js', code: 'export function main() { return 7; }\n', sourceMap: '{"sources":["src/main.virune"],"version":3}' },
	],
	dependencies: [
		{ modulePath: 'src/main.virune', sourceKind: 'virune', specifier: './z.virune', resolvedPath: 'src/z.virune', typeOnly: false, public: false },
	],
	exportedSymbols: [
		{ modulePath: 'src/z.virune', name: 'z', declarationKind: 'FunctionDeclaration' },
		{ modulePath: 'src/main.virune', name: 'main', declarationKind: 'FunctionDeclaration' },
	],
	stats: { parsedModules: 2, reusedParsedModules: 0, checkedModules: 2, reusedCheckedModules: 0, emittedModules: 2, reusedEmittedModules: 0, invalidatedModules: 0 },
});

const execution = (returnValue: number, stdout = ''): DifferentialExecutionV1 => ({
	returnValue,
	stdout,
	stderr: '',
	exitCode: 0,
	signal: null,
	panic: null,
	events: stdout === '' ? [] : stdout.trimEnd().split('\n'),
});

test('legacy self-comparison covers compilation and Node runtime with zero differences', async () => {
	const legacy = { name: 'legacy', compile: compileWithLegacyKernel, execute: executeKernelOutputWithNode } satisfies DifferentialKernelV1;
	const report = await runDifferentialCase({ fixtureId: 'legacy-self', input: input(), left: legacy, right: { ...legacy, name: 'legacy-reference' } });
	assert.equal(report.passed, true);
	assert.equal(report.status, 'match');
	assert.deepEqual(report.differences, []);
	assert.equal(report.left.runtime?.exitCode, 0);
	assert.equal(report.left.runtime?.returnValue, 7);
});

test('Legacy kernel preserves source maps only when requested', async () => {
	const value = input();
	const enabled = await compileWithLegacyKernel(value);
	assert.ok(enabled.emittedModules.length > 0);
	for (const module of enabled.emittedModules) {
		assert.notEqual(module.sourceMap, '');
		assert.match(module.code, /sourceMappingURL/u);
	}

	const disabled = await compileWithLegacyKernel({
		...value,
		emit: { ...value.emit, sourceMap: false },
	});
	assert.equal(disabled.emittedModules.length, enabled.emittedModules.length);
	for (const module of disabled.emittedModules) {
		assert.equal(module.sourceMap, '');
		assert.doesNotMatch(module.code, /sourceMappingURL/u);
	}
});

test('canonical ordering and source-map key order do not create differences', async () => {
	const left = { name: 'left', async compile() { return output(); } } satisfies DifferentialKernelV1;
	const right = {
		name: 'right',
		async compile() {
			const value = output();
			return {
				...value,
				emittedModules: [...value.emittedModules].reverse(),
				dependencies: [...value.dependencies].reverse(),
				exportedSymbols: [...value.exportedSymbols].reverse(),
			};
		},
	} satisfies DifferentialKernelV1;
	const report = await runDifferentialCase({ fixtureId: 'canonical', input: input(), left, right });
	assert.equal(report.passed, true);
	assert.deepEqual(report.differences, []);
});

test('diagnostic, emitted output, and runtime differences identify exact fields', async () => {
	const diagnostic = {
		code: 'T0001', severity: 'error' as const, message: 'left', sourcePath: 'src/main.virune',
		span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 } },
	};
	const left = {
		name: 'left',
		async compile() { return { ...output(), diagnostics: [diagnostic] }; },
		async execute() { return execution(7, 'first\nsecond\n'); },
	} satisfies DifferentialKernelV1;
	const right = {
		name: 'right',
		async compile() {
			const value = output();
			return {
				...value,
				diagnostics: [{ ...diagnostic, code: 'T9999' }],
				emittedModules: value.emittedModules.map((module, index) => index === 0 ? { ...module, code: `${module.code}// changed\n` } : module),
			};
		},
		async execute() { return execution(8, 'second\nfirst\n'); },
	} satisfies DifferentialKernelV1;
	const report = await runDifferentialCase({ fixtureId: 'intentional', input: input(), left, right });
	assert.equal(report.passed, false);
	const paths = report.unexplainedDifferences.map(item => item.path);
	assert.ok(paths.includes('$.compiler.output.diagnostics[0].code'));
	assert.ok(paths.includes('$.compiler.output.emittedModules[1].code'));
	assert.ok(paths.includes('$.runtime.returnValue'));
	assert.ok(paths.includes('$.runtime.stdout'));
	assert.ok(paths.includes('$.runtime.events[0]'));
});

test('expected divergence requires reason and expiry, and stale entries fail closed', async () => {
	const left = { name: 'left', async compile() { return output(); }, async execute() { return execution(7); } } satisfies DifferentialKernelV1;
	const right = { name: 'right', async compile() { return output(); }, async execute() { return execution(8); } } satisfies DifferentialKernelV1;
	const accepted = await runDifferentialCase({
		fixtureId: 'expected', input: input(), left, right, today: '2026-07-30',
		expectedDivergences: [{ path: '$.runtime.returnValue', reason: 'MVP runtime value encoding differs', expiresOn: '2026-08-30' }],
	});
	assert.equal(accepted.passed, true);
	assert.equal(accepted.status, 'expected-divergence');
	const stale = await runDifferentialCase({
		fixtureId: 'stale', input: input(), left, right: left, today: '2026-07-30',
		expectedDivergences: [{ path: '$.runtime.returnValue', reason: 'must be removed when fixed', expiresOn: '2026-08-30' }],
	});
	assert.equal(stale.passed, false);
	assert.equal(stale.staleExpectedDivergences.length, 1);
	await assert.rejects(
		runDifferentialCase({
			fixtureId: 'expired', input: input(), left, right, today: '2026-07-30',
			expectedDivergences: [{ path: '$.runtime.returnValue', reason: 'expired', expiresOn: '2026-07-29' }],
		}),
		DifferentialPolicyError,
	);
});

test('machine-readable and Markdown artifacts identify fixture and field', async () => {
	const left = { name: 'left', async compile() { return output(); }, async execute() { return execution(7); } } satisfies DifferentialKernelV1;
	const right = { name: 'right', async compile() { return output(); }, async execute() { return execution(8); } } satisfies DifferentialKernelV1;
	const report = await runDifferentialCase({ fixtureId: 'artifact', input: input(), left, right });
	const directory = await mkdtemp(resolve(tmpdir(), 'virune-differential-artifact-'));
	try {
		const paths = await writeDifferentialArtifacts(report, directory);
		const json = JSON.parse(await readFile(paths.jsonPath, 'utf8')) as { readonly fixtureId: string; readonly differences: readonly { readonly path: string }[] };
		const summary = await readFile(paths.summaryPath, 'utf8');
		assert.equal(json.fixtureId, 'artifact');
		assert.ok(json.differences.some(item => item.path === '$.runtime.returnValue'));
		assert.match(summary, /artifact/u);
		assert.match(summary, /\$\.runtime\.returnValue/u);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
