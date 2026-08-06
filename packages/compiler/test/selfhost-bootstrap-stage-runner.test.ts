import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	evaluateSelfhostStageBootstrapReadiness,
	readinessBlockers,
} from '../src/selfhost/bootstrap-stage-runner.js';
import type { SelfhostMvpModule } from '../src/selfhost/mvp-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const options = {
	temporaryRoot,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'c'.repeat(64),
};

const capabilityValue = (ready: boolean, blockers: readonly string[]) => ({
	contractVersion: '1' as const,
	ready,
	requestSchema: 'virune.selfhost.project-compiler.request.v1' as const,
	resultSchema: 'virune.selfhost.project-compiler.result.v2' as const,
	blockers,
});

const capability = (ready: boolean, blockers: readonly string[]) => JSON.stringify(
	capabilityValue(ready, blockers),
);

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

test('current multi-module Self-host compiler satisfies Stage 1 and Stage 2 readiness', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	try {
		const first = await evaluateSelfhostStageBootstrapReadiness(mvpRoot, options);
		const second = await evaluateSelfhostStageBootstrapReadiness(mvpRoot, options);
		const expectedCapability = capabilityValue(true, []);

		assert.equal(first.stage0Compiler.artifact.metadata.stage, 'stage0');
		assert.equal(first.evidence.policyVersion, 3);
		assert.equal(first.evidence.claim, 'stage1-stage2-bootstrap-readiness');
		assert.equal(first.evidence.productionEligible, false);
		assert.equal(first.evidence.ready, true);
		assert.ok(first.evidence.sourceCount > 1);
		assert.equal(first.evidence.sourceCount, first.sourceManifest.manifest.sources.length);
		assert.equal(first.evidence.entryPath, 'src/main.virune');
		assert.deepEqual(first.evidence.requiredExports, ['projectCompilerCapability', 'compileProjectMvp']);
		assert.deepEqual(first.evidence.capability, expectedCapability);
		assert.equal(first.evidence.capabilitySha256, sha256(JSON.stringify(expectedCapability)));
		assert.match(first.evidence.capabilitySha256 ?? '', /^[0-9a-f]{64}$/u);
		assert.equal(first.evidence.capabilityReady, true);
		assert.deepEqual(first.evidence.capabilityBlockers, []);
		assert.equal(first.evidence.compilerArtifactSha256, first.stage0Compiler.sha256);
		assert.equal(first.evidence.sourceManifestSha256, first.sourceManifest.sha256);
		assert.deepEqual(first.evidence.blockers, []);
		assert.equal(first.serialized, second.serialized);
		assert.equal(first.sha256, second.sha256);
		assert.equal(first.stage0Compiler.serialized, second.stage0Compiler.serialized);
		assert.equal(first.sourceManifest.serialized, second.sourceManifest.serialized);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});

test('function stubs do not clear readiness without a ready capability', () => {
	const singleSource: SelfhostMvpModule = {
		compileMvp: (_source: string) => ({ $tag: 'Ok', $values: ['{}'] }),
	};
	assert.deepEqual(readinessBlockers(singleSource, 1), ['project-compiler-export-missing']);
	assert.deepEqual(readinessBlockers(singleSource, 20), [
		'multi-module-project-requires-project-compiler',
		'project-compiler-export-missing',
	]);

	const nonReadyProjectCompiler = {
		...singleSource,
		projectCompilerCapability: () => ({
			$tag: 'Ok' as const,
			$values: [capability(false, ['full-language-lowering-not-implemented'])] as const,
		}),
		compileProjectMvp: (_request: string) => ({ $tag: 'Ok' as const, $values: ['{}'] as const }),
	};
	assert.deepEqual(readinessBlockers(nonReadyProjectCompiler, 20), [
		'multi-module-project-requires-project-compiler',
		'project-compiler-not-ready',
	]);

	const readyProjectCompiler = {
		...nonReadyProjectCompiler,
		projectCompilerCapability: () => ({
			$tag: 'Ok' as const,
			$values: [capability(true, [])] as const,
		}),
	};
	assert.deepEqual(readinessBlockers(readyProjectCompiler, 20), []);
	assert.throws(() => readinessBlockers(readyProjectCompiler, 0), /positive safe integer/u);
});
