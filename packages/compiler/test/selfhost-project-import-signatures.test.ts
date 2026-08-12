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
	seedSha256: '7'.repeat(64),
};

test('project lowering resolves imported function signatures and emits aliases', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		const input = kernelInputFromProjectBuild(build);
		const result = compileWithProjectCompilerBoundary(module, {
			...input,
			entryPath: 'src/main.virune',
			sources: [
				{
					path: 'src/helper.virune',
					text: 'pub fn double(value: Int) -> Int {\n\treturn value + value\n}\n',
				},
				{
					path: 'src/main.virune',
					text: 'import { double as twice } from "./helper.virune"\n\npub fn main() -> Int {\n\treturn twice(21)\n}\n',
				},
			],
		});
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.dependencies, [{
			modulePath: 'src/main.virune',
			sourceKind: 'virune',
			specifier: './helper.virune',
			resolvedPath: 'src/helper.virune',
			typeOnly: false,
			public: false,
		}]);
		const main = result.emittedModules.find(item => item.sourcePath === 'src/main.virune');
		assert.ok(main);
		assert.match(main.code, /import \{ double as twice \} from "\.\/helper\.js";/u);
		assert.match(main.code, /twice\(/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
