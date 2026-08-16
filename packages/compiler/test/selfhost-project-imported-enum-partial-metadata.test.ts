import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import test from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { snapshotProjectBuild } from '../src/selfhost/bootstrap-artifact-snapshot.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from '../src/selfhost/bootstrap-execution-probe.js';
import { validateKernelInput } from '../src/selfhost/contract.js';
import { createSelfhostProjectKernel } from '../src/selfhost/project-differential-adapter.js';

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

test('an unsupported payload variant invalidates the imported enum metadata as a whole', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		const kernel = createSelfhostProjectKernel(module);
		const input = validateKernelInput({
			contractVersion: '1',
			languageVersion: '1.0',
			platform: 'node',
			entryPath: 'src/main.virune',
			sources: [
				{
					path: 'src/domain.virune',
					text: 'pub record User {\n\tname: String\n}\n\npub enum Status {\n\tPending\n\tFailed(User)\n}\n',
				},
				{
					path: 'src/main.virune',
					text: 'import { Status } from "./domain.virune"\n\npub fn main() -> Status {\n\treturn Status.Pending\n}\n',
				},
			],
			interopManifest: { version: '1', modules: [] },
			emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
		});
		const output = await kernel.compile(input);
		assert.equal(output.accepted, false, 'partial enum metadata must not expose the otherwise-lowerable Pending variant');
		assert.deepEqual(output.emittedModules, []);
		assert.ok(output.diagnostics.some(item =>
			item.sourcePath === 'src/main.virune'
			&& item.code === 'L1010'
			&& item.message === 'Unknown name Status.Pending'
		));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
