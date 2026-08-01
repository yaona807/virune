import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KernelOutputV1 } from '../src/selfhost/contract.js';
import {
	runSelfhostStageBootstrap,
	snapshotKernelOutputAsBootstrapArtifact,
} from '../src/selfhost/bootstrap-stage-runner.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const seedSha256 = 'c'.repeat(64);
const options = {
	temporaryRoot,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256,
};

test('Stage 0 generates real Stage 1 and Stage 1 generates equivalent Stage 2', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	try {
		const first = await runSelfhostStageBootstrap(mvpRoot, options);
		const second = await runSelfhostStageBootstrap(mvpRoot, options);

		assert.equal(first.stage0Compiler.artifact.metadata.stage, 'stage0');
		assert.equal(first.stage1.artifact.artifact.metadata.stage, 'stage1');
		assert.equal(first.stage2.artifact.artifact.metadata.stage, 'stage2');
		assert.equal(first.stage1.evidence.compilerArtifactSha256, first.stage0Compiler.sha256);
		assert.equal(first.stage2.evidence.compilerArtifactSha256, first.stage1.artifact.sha256);
		assert.equal(first.stage1.evidence.sourceManifestSha256, first.sourceManifest.sha256);
		assert.equal(first.stage2.evidence.sourceManifestSha256, first.sourceManifest.sha256);
		assert.equal(first.stage1.evidence.outputArtifactSha256, first.stage1.artifact.sha256);
		assert.equal(first.stage2.evidence.outputArtifactSha256, first.stage2.artifact.sha256);
		assert.equal(first.stage1.evidence.productionEligible, false);
		assert.equal(first.stage2.evidence.productionEligible, false);
		assert.equal(first.stage1.evidence.entryModulePath, 'src/main.js');
		assert.equal(first.stage2.evidence.entryModulePath, 'src/main.js');

		assert.equal(first.shadowReport.report.status, 'equivalent');
		assert.equal(first.shadowReport.report.blocking, false);
		assert.deepEqual(first.shadowReport.report.unexpectedChanges, []);
		assert.deepEqual(first.shadowReport.report.expectedChanges.map(change => change.path), ['metadata.stage']);
		assert.equal(first.stage1.artifact.artifact.modules[0]?.code, first.stage2.artifact.artifact.modules[0]?.code);
		assert.deepEqual(first.stage1.artifact.artifact.moduleOrder, ['src/main.js']);
		assert.deepEqual(first.stage2.artifact.artifact.moduleOrder, ['src/main.js']);

		assert.equal(first.stage0Compiler.serialized, second.stage0Compiler.serialized);
		assert.equal(first.sourceManifest.serialized, second.sourceManifest.serialized);
		assert.equal(first.stage1.artifact.serialized, second.stage1.artifact.serialized);
		assert.equal(first.stage2.artifact.serialized, second.stage2.artifact.serialized);
		assert.equal(first.stage1.serializedEvidence, second.stage1.serializedEvidence);
		assert.equal(first.stage2.serializedEvidence, second.stage2.serializedEvidence);
		assert.equal(first.shadowReport.serialized, second.shadowReport.serialized);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('stage snapshot fails closed for rejected output and source maps', () => {
	const rejected = output({ accepted: false, emittedModules: [], exportedSymbols: [] });
	assert.throws(
		() => snapshotKernelOutputAsBootstrapArtifact(rejected, 'stage1', 'd'.repeat(64), options),
		/stage1 compiler generation failed/u,
	);

	const withSourceMap = output({
		accepted: true,
		emittedModules: [{
			sourcePath: 'src/main.virune',
			outputPath: '.selfhost-output/src/main.js',
			code: 'export function compileMvp() {}',
			sourceMap: '{}',
		}],
		exportedSymbols: [{ modulePath: 'src/main.virune', name: 'compileMvp', declarationKind: 'function' }],
	});
	assert.throws(
		() => snapshotKernelOutputAsBootstrapArtifact(withSourceMap, 'stage2', 'd'.repeat(64), options),
		/unexpected source map/u,
	);
});

function output(overrides: Pick<KernelOutputV1, 'accepted' | 'emittedModules' | 'exportedSymbols'>): KernelOutputV1 {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: 'src/main.virune',
		accepted: overrides.accepted,
		diagnostics: [],
		emittedModules: overrides.emittedModules,
		dependencies: [],
		exportedSymbols: overrides.exportedSymbols,
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 1,
			reusedCheckedModules: 0,
			emittedModules: overrides.emittedModules.length,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
}
