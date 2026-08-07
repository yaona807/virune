import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isTemporaryArtifactPath, verifyTemporaryArtifacts } from './verify-selfhost-temporary-artifacts.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const emptyRegistry = { schemaVersion: 1, artifacts: [] };
const retiredReadinessBridgePaths = Object.freeze([
	'.github/scripts/tmp-apply-full-language-readiness.py',
	'.github/workflows/tmp-selfhost-full-language-readiness-pr.yml',
	'.github/workflows/tmp-selfhost-full-language-readiness.yml',
]);

function registryFor(path) {
	return {
		schemaVersion: 1,
		artifacts: [{
			id: 'readiness-probe',
			path,
			responsiblePullRequest: 279,
			removalTrigger: 'Canonical readiness evidence is available from the permanent command.',
			mergeDisposition: 'do-not-merge',
		}],
	};
}

test('recognizes only reviewed temporary-artifact naming rules', () => {
	assert.equal(isTemporaryArtifactPath('.github/workflows/tmp-readiness.yml'), true);
	assert.equal(isTemporaryArtifactPath('.github/scripts/tmp-apply-patch.py'), true);
	assert.equal(isTemporaryArtifactPath('scripts/probe.temporary.mjs'), true);
	assert.equal(isTemporaryArtifactPath('scripts/temporary-artifact-policy.mjs'), false);
	assert.equal(isTemporaryArtifactPath('docs/tmp-guide.md'), false);
});

test('accepts a clean repository inventory', () => {
	const result = verifyTemporaryArtifacts({
		paths: ['package.json', 'scripts/verify-selfhost-temporary-artifacts.mjs'],
		registry: emptyRegistry,
	});
	assert.equal(result.status, 'clean');
	assert.equal(result.temporaryArtifactCount, 0);
});

test('requires every temporary artifact to be declared', () => {
	assert.throws(
		() => verifyTemporaryArtifacts({
			paths: ['.github/workflows/tmp-readiness.yml'],
			registry: emptyRegistry,
		}),
		/not declared/u,
	);
});

test('accepts a declared diagnostic-only artifact outside clean mode', () => {
	const path = '.github/workflows/tmp-readiness.yml';
	const result = verifyTemporaryArtifacts({ paths: [path], registry: registryFor(path) });
	assert.equal(result.status, 'declared');
	assert.equal(result.artifacts[0].mergeDisposition, 'do-not-merge');
});

test('rejects declared artifacts in merge-clean mode', () => {
	const path = '.github/workflows/tmp-readiness.yml';
	assert.throws(
		() => verifyTemporaryArtifacts({ paths: [path], registry: registryFor(path), requireClean: true }),
		/must be removed before merge/u,
	);
});

test('rejects stale registry entries and unsafe merge disposition', () => {
	const path = '.github/scripts/tmp-apply.py';
	assert.throws(
		() => verifyTemporaryArtifacts({ paths: [], registry: registryFor(path) }),
		/registry entry is stale/u,
	);
	const invalid = registryFor(path);
	invalid.artifacts[0].mergeDisposition = 'merge';
	assert.throws(
		() => verifyTemporaryArtifacts({ paths: [path], registry: invalid }),
		/must be do-not-merge/u,
	);
});

test('keeps the PR #279 readiness bridge retired from the tracked tree', () => {
	for (const path of retiredReadinessBridgePaths) {
		assert.equal(isTemporaryArtifactPath(path), true, path);
	}
	const tracked = spawnSync('git', ['ls-files', '--', ...retiredReadinessBridgePaths], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(tracked.status, 0, tracked.stderr || tracked.stdout);
	assert.equal(tracked.stdout.trim(), '');

	const verification = spawnSync(process.execPath, [
		'scripts/verify-selfhost-temporary-artifacts.mjs',
		'--require-clean',
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(verification.status, 0, verification.stderr || verification.stdout);
	const evidence = JSON.parse(verification.stdout);
	assert.equal(evidence.claim, 'selfhost-temporary-artifact-inventory');
	assert.equal(evidence.status, 'clean');
	assert.equal(evidence.requireClean, true);
	assert.equal(evidence.temporaryArtifactCount, 0);
	assert.deepEqual(evidence.artifacts, []);
});
