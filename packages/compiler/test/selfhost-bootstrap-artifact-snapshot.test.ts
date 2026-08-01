import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	extractGeneratedModuleExports,
	snapshotProjectBuild,
} from '../src/selfhost/bootstrap-artifact-snapshot.js';
import { diffBootstrapArtifacts } from '../src/selfhost/bootstrap-artifact-normalizer.js';
import { buildProject, type ProjectBuildResult } from '../src/project/project.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = resolve(repositoryRoot, 'selfhost/mvp');
const seedSha256 = 'a'.repeat(64);

test('independent self-host MVP builds produce one canonical bootstrap snapshot', async () => {
	const firstBuild = await buildProject(mvpRoot, { write: false });
	const secondBuild = await buildProject(mvpRoot, { write: false });
	const first = snapshotProjectBuild(firstBuild, {
		stage: 'stage0',
		compilerVersion: '1.0.0',
		runtimeAbi: '1',
		interopAbi: '1',
		seedSha256,
		generatedAt: '2026-08-01T01:00:00Z',
		runId: 'first-build',
	});
	const second = snapshotProjectBuild(secondBuild, {
		stage: 'stage0',
		compilerVersion: '1.0.0',
		runtimeAbi: '1',
		interopAbi: '1',
		seedSha256: seedSha256.toUpperCase(),
		generatedAt: '2026-08-01T02:00:00Z',
		runId: 'second-build',
	});

	assert.equal(first.serialized, second.serialized);
	assert.equal(first.sha256, second.sha256);
	assert.equal(diffBootstrapArtifacts(first, second).equal, true);
	assert.ok(first.artifact.moduleOrder.length > 0);
	assert.ok(first.artifact.moduleOrder.every(path => path.startsWith('dist/')));
	assert.equal(first.artifact.checksumManifest.length, first.artifact.modules.length * 2);
	assert.equal(first.artifact.metadata.stage, 'stage0');
	assert.equal(first.artifact.metadata.seedSha256, seedSha256);
	assert.equal('generatedAt' in first.artifact.metadata, false);
	assert.equal('runId' in first.artifact.metadata, false);
	const main = first.artifact.modules.find(module => module.path === 'dist/main.js');
	assert.ok(main?.exports.includes('compileMvp'));
	assert.ok(main?.exports.includes('checkFrontendFfiContract'));
});

test('meaningful generated JavaScript differences remain visible', async () => {
	const build = await buildProject(mvpRoot, { write: false });
	const changed = changeFirstOutput(build);
	const options = {
		stage: 'stage0' as const,
		compilerVersion: '1.0.0',
		runtimeAbi: '1',
		interopAbi: '1',
	};
	const before = snapshotProjectBuild(build, options);
	const after = snapshotProjectBuild(changed, options);
	const diff = diffBootstrapArtifacts(before, after);

	assert.equal(diff.equal, false);
	assert.ok(diff.changes.some(change => change.section === 'modules' && change.path.endsWith('.code')));
	assert.ok(diff.changes.some(change => change.section === 'checksumManifest' && change.path.endsWith('.sha256')));
});

test('generated export extraction covers emitter declaration and export-list forms', () => {
	assert.deepEqual(extractGeneratedModuleExports([
		'export const Value = 1;',
		'export async function run() {}',
		'const internal = 1;',
		'export { internal as publicValue, Value };',
	].join('\n')), ['Value', 'run', 'publicValue', 'Value']);
	assert.throws(
		() => extractGeneratedModuleExports('export { internal as invalid-name };'),
		/Unsupported generated export entry/u,
	);
});

test('invalid snapshot metadata and failed builds are rejected explicitly', async () => {
	const build = await buildProject(mvpRoot, { write: false });
	assert.throws(() => snapshotProjectBuild(build, {
		stage: 'stage0',
		compilerVersion: '',
		runtimeAbi: '1',
		interopAbi: '1',
	}), /compilerVersion/u);
	assert.throws(() => snapshotProjectBuild(build, {
		stage: 'stage0',
		compilerVersion: '1.0.0',
		runtimeAbi: '1',
		interopAbi: '1',
		seedSha256: 'invalid',
	}), /seedSha256/u);
	const failed = {
		...build,
		diagnostics: [{ severity: 'error' }],
	} as unknown as ProjectBuildResult;
	assert.throws(() => snapshotProjectBuild(failed, {
		stage: 'stage0',
		compilerVersion: '1.0.0',
		runtimeAbi: '1',
		interopAbi: '1',
	}), /failed project build/u);
});

function changeFirstOutput(build: ProjectBuildResult): ProjectBuildResult {
	let changed = false;
	return {
		...build,
		modules: build.modules.map(module => {
			if (changed || module.output === undefined) return module;
			changed = true;
			return { ...module, output: { ...module.output, code: `${module.output.code}\n// meaningful change\n` } };
		}),
	};
}
