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
import { compileWithProjectCompilerBoundary } from '../src/selfhost/project-compiler-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'c'.repeat(64),
};

type ProjectInput = ReturnType<typeof kernelInputFromProjectBuild>;
type GeneratedCompiler = Awaited<ReturnType<typeof loadBootstrapCompilerCandidate>>;

async function withGeneratedCompiler<T>(
	run: (module: GeneratedCompiler, input: ProjectInput) => T | Promise<T>,
): Promise<T> {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		return await run(module, kernelInputFromProjectBuild(build));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

const enumSource = `pub enum Status derives Eq, Debug, Json {
	Pending
	Ready(Int)
}

pub fn main() -> Int {
	return 1
}
`;

test('project lowering preserves enum metadata and emits the public enum runtime namespace', async () => {
	await withGeneratedCompiler((module, input) => {
		const projectInput: ProjectInput = {
			...input,
			entryPath: 'src/main.virune',
			sources: [{ path: 'src/main.virune', text: enumSource }],
		};
		const result = compileWithProjectCompilerBoundary(module, projectInput);
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.dependencies, []);
		assert.deepEqual(result.exportedSymbols, [
			{ modulePath: 'src/main.virune', name: 'Status', declarationKind: 'EnumDeclaration' },
			{ modulePath: 'src/main.virune', name: 'main', declarationKind: 'FunctionDeclaration' },
		]);
		assert.equal(result.stats.parsedModules, 1);
		assert.equal(result.stats.checkedModules, 1);
		assert.equal(result.stats.emittedModules, 1);
		assert.equal(result.emittedModules.length, 1);
		const emittedCode = result.emittedModules[0]?.code ?? '';
		assert.match(emittedCode, /export function main/u);
		assert.match(emittedCode, /\/\/ enum Status/u);
		assert.match(
			emittedCode,
			/export const Pending = Object\.freeze\(makeVariant\("Pending", \[\], "project:src\/main\.virune#Status"\)\);/u,
		);
		assert.match(
			emittedCode,
			/export function Ready\(\$value0\) \{ return makeVariant\("Ready", \[\$value0\], "project:src\/main\.virune#Status"\); \}/u,
		);
		assert.match(emittedCode, /export const Status = Object\.freeze\(\{ Pending, Ready \}\);/u);
	});
});

test('malformed enum declarations remain rejected before Pure Core lowering', async () => {
	await withGeneratedCompiler((module, input) => {
		const projectInput: ProjectInput = {
			...input,
			entryPath: 'src/main.virune',
			sources: [{
				path: 'src/main.virune',
				text: 'pub enum Broken {\n\tReady(\n}\n',
			}],
		};
		const result = compileWithProjectCompilerBoundary(module, projectInput);
		assert.equal(result.accepted, false);
		assert.equal(result.stats.parsedModules, 1);
		assert.equal(result.stats.checkedModules, 0);
		assert.deepEqual(result.emittedModules, []);
		assert.ok(result.diagnostics.some(item => item.sourcePath === 'src/main.virune'));
	});
});
