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
	seedSha256: 'f'.repeat(64),
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

const conditionalSource = `fn choose(flag: Bool, left: Int, right: Int) -> Int {
	return if flag then left else right
}

fn nested(first: Bool, second: Bool) -> Int {
	return if first then if second then 1 else 2 else 3
}

pub fn main() -> Int {
	return choose(true, nested(true, false), 22)
}
`;

test('conditional expressions type-check and emit with stable precedence', async () => {
	await withGeneratedCompiler((module, input) => {
		const projectInput: ProjectInput = {
			...input,
			entryPath: 'src/main.virune',
			sources: [{ path: 'src/main.virune', text: conditionalSource }],
		};
		const result = compileWithProjectCompilerBoundary(module, projectInput);
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.equal(result.stats.parsedModules, 1);
		assert.equal(result.stats.checkedModules, 1);
		assert.equal(result.stats.emittedModules, 1);
		const code = result.emittedModules[0]?.code ?? '';
		assert.match(code, /return \(flag \? left : right\);/u);
		assert.match(code, /return \(first \? \(second \? 1 : 2\) : 3\);/u);
		assert.match(code, /export function main/u);
	});
});

test('conditional expressions reject non-Bool conditions and mismatched branches', async () => {
	await withGeneratedCompiler((module, input) => {
		for (const text of [
			'pub fn main() -> Int {\n\treturn if 1 then 2 else 3\n}\n',
			'pub fn main() -> Int {\n\treturn if true then 2 else "three"\n}\n',
		]) {
			const projectInput: ProjectInput = {
				...input,
				entryPath: 'src/main.virune',
				sources: [{ path: 'src/main.virune', text }],
			};
			const result = compileWithProjectCompilerBoundary(module, projectInput);
			assert.equal(result.accepted, false);
			assert.equal(result.stats.parsedModules, 1);
			assert.equal(result.stats.checkedModules, 0);
			assert.deepEqual(result.emittedModules, []);
			assert.ok(result.diagnostics.some(item => item.sourcePath === 'src/main.virune'));
		}
	});
});
