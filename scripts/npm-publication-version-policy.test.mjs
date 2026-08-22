import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReleaseVersion, registryPolicyForVersion } from './npm-publication-version-policy.mjs';

const tags = { stable: 'latest', prerelease: 'next', nightly: null };

test('canonical npm version policy separates stable, prerelease and nightly channels', () => {
	assert.deepEqual(registryPolicyForVersion('1.1.0', '1.1.0', tags), {
		channel: 'stable', registryVersionEligible: true, distTag: 'latest',
	});
	for (const version of ['1.1.0-alpha.1', '1.1.0-beta.2', '1.1.0-rc.3']) {
		assert.deepEqual(registryPolicyForVersion(version, '1.1.0', tags), {
			channel: 'prerelease', registryVersionEligible: true, distTag: 'next',
		});
	}
	assert.deepEqual(registryPolicyForVersion('1.1.0-nightly.20260822.1', '1.1.0', tags), {
		channel: 'nightly', registryVersionEligible: false, distTag: null,
	});
});

test('versions before the first stable Registry boundary stay ineligible in every supported channel', () => {
	for (const version of ['1.0.0', '1.0.1-rc.1', '1.0.9-nightly.20260822.1']) {
		assert.equal(registryPolicyForVersion(version, '1.1.0', tags).registryVersionEligible, false);
	}
});

test('version policy rejects malformed versions, non-stable boundary and dist-tag drift', () => {
	for (const version of ['1.1', '01.1.0', '1.1.0-preview.1', '1.1.0-rc', '1.1.0-nightly.2026.1']) {
		assert.throws(() => parseReleaseVersion(version));
	}
	assert.throws(() => registryPolicyForVersion('1.1.0', '1.1.0-rc.1', tags), /stable semantic version/u);
	assert.throws(() => registryPolicyForVersion('1.1.0', '1.1.0', { ...tags, stable: 'stable' }), /must use latest/u);
	assert.throws(() => registryPolicyForVersion('1.1.0-rc.1', '1.1.0', { ...tags, prerelease: 'rc' }), /must use next/u);
	assert.throws(() => registryPolicyForVersion('1.1.0', '1.1.0', { ...tags, nightly: 'nightly' }), /must remain disabled/u);
});
