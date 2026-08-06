import assert from 'node:assert/strict';
import test from 'node:test';
import { isTemporaryArtifactPath, verifyTemporaryArtifacts } from './verify-selfhost-temporary-artifacts.mjs';

const emptyRegistry = { schemaVersion: 1, artifacts: [] };

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
