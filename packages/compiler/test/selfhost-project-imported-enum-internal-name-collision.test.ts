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
import { validateKernelInput, type KernelInputV1 } from '../src/selfhost/contract.js';
import { compileWithLegacyKernel } from '../src/selfhost/legacy-adapter.js';
import { executeKernelOutputWithNode } from '../src/selfhost/node-executor.js';
import { createSelfhostProjectKernel } from '../src/selfhost/project-differential-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: '9'.repeat(64),
};

type GeneratedCompiler = Awaited<ReturnType<typeof loadBootstrapCompilerCandidate>>;

async function withGeneratedCompiler<T>(run: (module: GeneratedCompiler) => T | Promise<T>): Promise<T> {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		return await run(await loadBootstrapCompilerCandidate(root, 'dist/main.js'));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function projectInput(main: string): KernelInputV1 {
	return validateKernelInput({
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: 'src/main.virune',
		sources: [
			{ path: 'src/domain.virune', text: 'pub enum Status {\n\tPending\n}\n' },
			{ path: 'src/main.virune', text: main },
		],
		interopManifest: { version: '1', modules: [] },
		emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
	});
}

function assertEntryNotEmitted(output: { readonly emittedModules: readonly { readonly sourcePath: string }[] }, context: string): void {
	assert.equal(
		output.emittedModules.some(item => item.sourcePath === 'src/main.virune'),
		false,
		context,
	);
}

const validAliasInput = projectInput(
	'import { Status as MvpType } from "./domain.virune"\n\n'
		+ 'pub fn main() -> MvpType {\n\treturn MvpType.Pending\n}\n',
);

const unknownVariantInput = projectInput(
	'import { Status as MvpType } from "./domain.virune"\n\n'
		+ 'fn bad() -> MvpType {\n\treturn MvpType.IntType\n}\n\n'
		+ 'pub fn main() -> Int {\n\treturn 1\n}\n',
);

test('imported enum aliases take precedence over Self-host internal qualified enum names', async () => {
	const legacyValid = await compileWithLegacyKernel(validAliasInput);
	assert.equal(legacyValid.accepted, true, JSON.stringify(legacyValid.diagnostics, null, 2));
	assert.deepEqual(legacyValid.diagnostics, []);
	const legacyExecution = await executeKernelOutputWithNode(validAliasInput, legacyValid);
	assert.equal(legacyExecution.exitCode, 0);
	assert.equal(legacyExecution.signal, null);
	assert.equal(legacyExecution.panic, null);
	assert.deepEqual(legacyExecution.returnValue, { $tag: 'Pending', $values: [] });

	const legacyUnknown = await compileWithLegacyKernel(unknownVariantInput);
	assert.equal(legacyUnknown.accepted, false, 'Legacy must resolve MvpType to the imported Status enum, not a Self-host internal enum');
	assertEntryNotEmitted(legacyUnknown, 'Legacy must not emit the rejected entry module');

	await withGeneratedCompiler(async module => {
		const kernel = createSelfhostProjectKernel(module);

		const valid = await kernel.compile(validAliasInput);
		assert.equal(valid.accepted, true, JSON.stringify(valid.diagnostics, null, 2));
		assert.deepEqual(valid.diagnostics, []);
		const execution = await executeKernelOutputWithNode(validAliasInput, valid);
		assert.equal(execution.exitCode, 0);
		assert.equal(execution.signal, null);
		assert.equal(execution.panic, null);
		assert.deepEqual(execution.returnValue, { $tag: 'Pending', $values: [] });

		const unknown = await kernel.compile(unknownVariantInput);
		assert.equal(unknown.accepted, false, 'Self-host must not fall through to the internal MvpType qualified-variant allowlist');
		assertEntryNotEmitted(unknown, 'Self-host must not emit the rejected entry module');
		assert.ok(unknown.diagnostics.some(item =>
			item.sourcePath === 'src/main.virune'
			&& item.code === 'L1010'
			&& item.message === 'Unknown name MvpType.IntType'
		));
	});
});
