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

test('generated compiler exposes deterministic non-ready project capability', async () => {
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
			blockers: ['project-semantics-not-implemented'],
		});
	});
});

test('valid project request returns deterministic not-implemented evidence', async () => {
	await withGeneratedCompiler((module, input) => {
		const first = compileWithProjectCompilerBoundary(module, input);
		const second = compileWithProjectCompilerBoundary(module, input);
		assert.deepEqual(first, second);
		assert.equal(first.contractVersion, '1');
		assert.equal(first.accepted, false);
		assert.equal(first.emittedModuleCount, 0);
		assert.deepEqual(first.diagnostics.map(item => item.code), ['SHP2000']);
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
			readonly diagnostics: readonly { readonly code: string }[];
		};
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), ['SHP1001']);

		const malformed = module.compileProjectMvp('{');
		assert.equal(malformed.$tag, 'Err');
	});
});
