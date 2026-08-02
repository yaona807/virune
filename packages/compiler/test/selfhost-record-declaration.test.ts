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
	seedSha256: 'b'.repeat(64),
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
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

const recordSource = `pub record User derives Eq, Debug, Json {
	id: Int
	name: String
}

pub fn main() -> Int {
	return 1
}
`;

test('project lowering preserves record AST metadata while erasing its runtime declaration', async () => {
	await withGeneratedCompiler((module, input) => {
		const projectInput: ProjectInput = {
			...input,
			entryPath: 'src/main.virune',
			sources: [{ path: 'src/main.virune', text: recordSource }],
		};
		const result = compileWithProjectCompilerBoundary(module, projectInput);
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.exportedSymbols, [
			{ modulePath: 'src/main.virune', name: 'User', declarationKind: 'RecordDeclaration' },
			{ modulePath: 'src/main.virune', name: 'main', declarationKind: 'FunctionDeclaration' },
		]);
		assert.equal(result.stats.parsedModules, 1);
		assert.equal(result.stats.checkedModules, 1);
		assert.equal(result.emittedModules.length, 1);
		assert.match(result.emittedModules[0]?.code ?? '', /export function main/u);
		assert.doesNotMatch(result.emittedModules[0]?.code ?? '', /record User/u);
	});
});

test('malformed record declarations remain rejected by the full frontend before runtime lowering', async () => {
	await withGeneratedCompiler((module, input) => {
		const projectInput: ProjectInput = {
			...input,
			entryPath: 'src/main.virune',
			sources: [{
				path: 'src/main.virune',
				text: 'pub record Broken {\n\tname String\n}\n',
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
