import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageArtifact } from '../src/selfhost/bootstrap-stage-executor.js';
import type { KernelInputV1, KernelOutputV1 } from '../src/selfhost/contract.js';
import type { ProjectCompilerResultV1 } from '../src/selfhost/project-compiler-adapter.js';
import {
	materializeStageCompilerFacade,
	projectCompilerResultToKernelOutput,
} from '../src/selfhost/stage-compiler-facade.js';

const input: KernelInputV1 = {
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: 'pub fn main() -> Int {\n\treturn 0\n}\n' }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
};

function projectResult(code: string): ProjectCompilerResultV1 {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: input.entryPath,
		accepted: true,
		diagnostics: [],
		emittedModules: [{ sourcePath: input.entryPath, outputPath: 'dist/main.js', code, sourceMap: '' }],
		dependencies: [],
		exportedSymbols: [{ modulePath: input.entryPath, name: 'main', declarationKind: 'FunctionDeclaration' }],
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 1,
			reusedCheckedModules: 0,
			emittedModules: 1,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
}

function kernelOutput(marker: string): KernelOutputV1 {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: input.entryPath,
		accepted: true,
		diagnostics: [],
		emittedModules: [{
			sourcePath: input.entryPath,
			outputPath: 'dist/main.js',
			code: `export const compiler = ${JSON.stringify(marker)};\n`,
			sourceMap: '',
		}],
		dependencies: [],
		exportedSymbols: [],
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 1,
			reusedCheckedModules: 0,
			emittedModules: 1,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
}

function compilerModuleSource(output: ProjectCompilerResultV1): string {
	const capability = {
		contractVersion: '1',
		ready: true,
		requestSchema: 'virune.selfhost.project-compiler.request.v1',
		resultSchema: 'virune.selfhost.project-compiler.result.v2',
		blockers: [],
	};
	const compilation = {
		accepted: true,
		diagnostics: [],
		codeBody: 'export const value = 1;',
		exports: [{ name: 'value', declarationKind: 'VariableDeclaration' }],
	};
	return [
		`const output = ${JSON.stringify(output)};`,
		`const capability = ${JSON.stringify(capability)};`,
		`const compilation = ${JSON.stringify(compilation)};`,
		"export const compileMvp = () => ({ $tag: 'Ok', $values: [JSON.stringify(compilation)] });",
		"export const projectCompilerCapability = () => ({ $tag: 'Ok', $values: [JSON.stringify(capability)] });",
		"export const compileProjectMvp = () => ({ $tag: 'Ok', $values: [JSON.stringify(output)] });",
		'',
	].join('\n');
}

test('materialized Stage facade preserves Legacy default and explicit Self-host opt-in', async () => {
	const temporaryRoot = await mkdtemp(join(tmpdir(), 'virune-stage-facade-test-'));
	const selfHostResult = projectResult('export const compiler = "self-host";\n');
	const artifact = stageArtifact(
		'stage1',
		projectResult(compilerModuleSource(selfHostResult)),
	);
	let legacyCalls = 0;
	const facade = await materializeStageCompilerFacade(artifact, temporaryRoot, {
		legacyCompiler: () => {
			legacyCalls += 1;
			return kernelOutput('legacy');
		},
	});

	assert.equal(facade.defaultSelection, 'legacy');
	assert.equal(facade.selfHostAvailable, true);
	assert.equal(facade.artifactSha256, artifact.sha256);
	assert.match(facade.candidateRoot, /selfhost-stage-/u);
	assert.equal(
		(await facade.compile(input)).emittedModules[0]?.code,
		'export const compiler = "legacy";\n',
	);
	assert.equal(
		(await facade.compile(input, { selection: 'self-host' })).emittedModules[0]?.code,
		'export const compiler = "self-host";\n',
	);
	assert.equal(legacyCalls, 1);

	await facade.dispose();
	await facade.dispose();
	assert.deepEqual(await readdir(temporaryRoot), []);
	await assert.rejects(facade.compile(input), /materialized Stage compiler facade has been disposed/u);
	await assert.rejects(
		facade.compile(input, { selection: 'self-host' }),
		/materialized Stage compiler facade has been disposed/u,
	);
	await rm(temporaryRoot, { recursive: true, force: true });
});

test('project compiler results map null boundaries and notes into the Kernel contract', () => {
	const result: ProjectCompilerResultV1 = {
		...projectResult(''),
		accepted: false,
		diagnostics: [{
			code: 'L9999',
			severity: 'error',
			message: 'invalid source',
			sourcePath: null,
			span: {
				start: { offset: 0, line: 1, column: 1 },
				end: { offset: 1, line: 1, column: 2 },
			},
			notes: ['first note', 'second note'],
		}],
		emittedModules: [],
		dependencies: [{
			modulePath: input.entryPath,
			sourceKind: 'virune',
			specifier: './dependency',
			resolvedPath: null,
			typeOnly: false,
			public: false,
		}],
		exportedSymbols: [],
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 1,
			reusedCheckedModules: 0,
			emittedModules: 0,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
	const output = projectCompilerResultToKernelOutput(result);

	assert.equal(output.accepted, false);
	assert.equal(output.diagnostics[0]?.help, 'first note\nsecond note');
	assert.equal(Object.hasOwn(output.diagnostics[0] ?? {}, 'sourcePath'), false);
	assert.equal(Object.hasOwn(output.dependencies[0] ?? {}, 'resolvedPath'), false);
	assert.deepEqual(output.stats, result.stats);
});
