import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { snapshotProjectBuild } from '../src/selfhost/bootstrap-artifact-snapshot.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from '../src/selfhost/bootstrap-execution-probe.js';
import { kernelInputFromProjectBuild } from '../src/selfhost/bootstrap-stage-runner.js';
import {
	compileWithProjectCompilerBoundary,
	hasSelfhostProjectCompilerExports,
	readProjectCompilerCapability,
} from '../src/selfhost/project-compiler-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'e'.repeat(64),
};

async function withGeneratedCompiler<T>(run: (module: Awaited<ReturnType<typeof loadBootstrapCompilerCandidate>>, input: ReturnType<typeof kernelInputFromProjectBuild>) => T | Promise<T>): Promise<T> {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		return await run(module, kernelInputFromProjectBuild(build));
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

test('generated compiler exposes deterministic non-ready linking capability', async () => {
	await withGeneratedCompiler((module) => {
		assert.equal(hasSelfhostProjectCompilerExports(module), true);
		const first = readProjectCompilerCapability(module);
		const second = readProjectCompilerCapability(module);
		assert.deepEqual(first, second);
		assert.deepEqual(first, {
			contractVersion: '1',
			ready: false,
			requestSchema: 'virune.selfhost.project-compiler.request.v1',
			resultSchema: 'virune.selfhost.project-compiler.result.v1',
			blockers: ['project-linking-not-implemented'],
		});
	});
});

test('valid project request parses every source and returns deterministic linking evidence', async () => {
	await withGeneratedCompiler((module, input) => {
		const first = compileWithProjectCompilerBoundary(module, input);
		const second = compileWithProjectCompilerBoundary(module, input);
		assert.deepEqual(first, second);
		assert.equal(first.contractVersion, '1');
		assert.equal(first.languageVersion, '1.0');
		assert.equal(first.platform, 'node');
		assert.equal(first.entryPath, input.entryPath);
		assert.equal(first.accepted, false);
		assert.deepEqual(first.diagnostics.map(item => item.code), ['SHP2001']);
		assert.deepEqual(first.diagnostics[0], {
			code: 'SHP2001',
			severity: 'error',
			message: 'Project-wide linking, checking, and emission are not implemented',
			sourcePath: null,
			span: {
				start: { offset: 0, line: 1, column: 1 },
				end: { offset: 0, line: 1, column: 1 },
			},
			notes: [],
		});
		assert.deepEqual(first.emittedModules, []);
		assert.deepEqual(first.dependencies, []);
		assert.deepEqual(first.exportedSymbols, []);
		assert.deepEqual(first.stats, {
			parsedModules: input.sources.length,
			reusedParsedModules: 0,
			checkedModules: 0,
			reusedCheckedModules: 0,
			emittedModules: 0,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		});
	});
});

test('malformed project source returns path-aware parser diagnostics after parsing the full source set', async () => {
	await withGeneratedCompiler((module, input) => {
		const malformedInput = {
			...input,
			sources: input.sources.map(source => source.path === input.entryPath
				? { ...source, text: 'pub fn broken(' }
				: source),
		};
		const result = compileWithProjectCompilerBoundary(module, malformedInput);
		assert.equal(result.accepted, false);
		assert.equal(result.stats.parsedModules, input.sources.length);
		assert.equal(result.stats.checkedModules, 0);
		assert.equal(result.stats.emittedModules, 0);
		assert.ok(result.diagnostics.length > 0);
		assert.ok(result.diagnostics.every(item => item.code !== 'SHP2001'));
		const entryDiagnostic = result.diagnostics.find(item => item.sourcePath === input.entryPath);
		assert.ok(entryDiagnostic);
		assert.match(entryDiagnostic.code, /^L/u);
		assert.equal(entryDiagnostic.severity, 'error');
		assert.ok(entryDiagnostic.span.start.line >= 1);
		assert.ok(entryDiagnostic.span.end.offset >= entryDiagnostic.span.start.offset);
	});
});

test('unsorted direct project request fails closed before source parsing', async () => {
	await withGeneratedCompiler((module, input) => {
		if (!hasSelfhostProjectCompilerExports(module)) {
			throw new Error('Generated compiler must export the project compiler boundary');
		}
		const resultValue = module.compileProjectMvp(JSON.stringify({
			contractVersion: input.contractVersion,
			languageVersion: input.languageVersion,
			platform: input.platform,
			entryPath: input.entryPath,
			sources: [...input.sources]
				.reverse()
				.map(source => ({ path: source.path, text: source.text })),
			emit: input.emit,
		}));
		assert.equal(resultValue.$tag, 'Ok');
		const result = JSON.parse(resultValue.$values[0] as string) as {
			readonly diagnostics: readonly { readonly code: string; readonly sourcePath: string | null }[];
			readonly stats: { readonly parsedModules: number };
		};
		assert.deepEqual(result.diagnostics.map(item => item.code), ['SHP1012']);
		assert.equal(result.diagnostics[0]?.sourcePath, null);
		assert.equal(result.stats.parsedModules, 0);
	});
});

test('legacy count-only result shape remains rejected', async () => {
	await withGeneratedCompiler((module, input) => {
		const legacyShape = {
			...module,
			compileProjectMvp: (_request: string) => ({
				$tag: 'Ok' as const,
				$values: [JSON.stringify({
					contractVersion: '1',
					accepted: false,
					diagnostics: [{ code: 'SHP2000', severity: 'error', message: 'not implemented' }],
					emittedModuleCount: 0,
				})] as const,
			}),
		};
		assert.throws(
			() => compileWithProjectCompilerBoundary(legacyShape, input),
			/keys must be exactly/u,
		);
	});
});

test('invalid contract data and malformed JSON fail closed', async () => {
	await withGeneratedCompiler((module, input) => {
		if (!hasSelfhostProjectCompilerExports(module)) {
			throw new Error('Generated compiler must export the project compiler boundary');
		}
		const invalidVersion = module.compileProjectMvp(JSON.stringify({
			contractVersion: '2',
			languageVersion: input.languageVersion,
			platform: input.platform,
			entryPath: input.entryPath,
			sources: input.sources.map(source => ({ path: source.path, text: source.text })),
			emit: input.emit,
		}));
		assert.equal(invalidVersion.$tag, 'Ok');
		const result = JSON.parse(invalidVersion.$values[0] as string) as {
			readonly accepted: boolean;
			readonly diagnostics: readonly {
				readonly code: string;
				readonly sourcePath: string | null;
				readonly notes: readonly string[];
			}[];
			readonly emittedModules: readonly unknown[];
			readonly dependencies: readonly unknown[];
			readonly exportedSymbols: readonly unknown[];
			readonly stats: { readonly parsedModules: number };
		};
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), ['SHP1001']);
		assert.equal(result.diagnostics[0]?.sourcePath, null);
		assert.deepEqual(result.diagnostics[0]?.notes, []);
		assert.equal(result.stats.parsedModules, 0);
		assert.deepEqual(result.emittedModules, []);
		assert.deepEqual(result.dependencies, []);
		assert.deepEqual(result.exportedSymbols, []);

		const malformed = module.compileProjectMvp('{');
		assert.equal(malformed.$tag, 'Err');
	});
});
