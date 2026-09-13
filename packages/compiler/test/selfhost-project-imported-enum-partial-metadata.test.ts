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

function projectInput(main: string) {
	return validateKernelInput({
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: 'src/main.virune',
		sources: [
			{
				path: 'src/domain.virune',
				text: 'pub record User {\n\tname: String\n}\n\npub enum Status {\n\tPending\n\tFailed(User)\n}\n',
			},
			{ path: 'src/main.virune', text: main },
		],
		interopManifest: { version: '1', modules: [] },
		emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
	});
}

test('unsupported payload variants stay blocked without hiding independently grounded siblings', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		const kernel = createSelfhostProjectKernel(module);

		const supported = await kernel.compile(projectInput(
			'import { Status } from "./domain.virune"\n\npub fn main() -> Status {\n\treturn Status.Pending\n}\n',
		));
		assert.equal(supported.accepted, true, JSON.stringify(supported.diagnostics, null, 2));
		assert.deepEqual(supported.diagnostics, []);

		const unsupported = await kernel.compile(projectInput(
			'import { Status } from "./domain.virune"\n\npub fn main() -> Status {\n\treturn Status.Failed("boom")\n}\n',
		));
		assert.equal(unsupported.accepted, false, 'an unsupported nominal payload must not be guessed from its source type name');
		assert.equal(
			unsupported.emittedModules.some(item => item.sourcePath === 'src/main.virune'),
			false,
			'the rejected entry module must not be emitted',
		);
		assert.ok(unsupported.diagnostics.some(item =>
			item.sourcePath === 'src/main.virune'
			&& item.code === 'L1010'
			&& item.message === 'Unknown name Status.Failed'
		));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
