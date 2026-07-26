import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('release security policy matches the implemented artifact controls', async () => {
	const policy = JSON.parse(await readFile('.github/release-security-policy.json', 'utf8'));
	assert.equal(policy.schemaVersion, 1);
	assert.deepEqual(policy.sbom, {
		file: 'release/SBOM.cdx.json',
		format: 'CycloneDX',
		specVersion: '1.6',
	});
	assert.equal(policy.attestations.action, 'actions/attest');
	assert.match(policy.attestations.reference, /^[0-9a-f]{40}$/u);
	assert.equal(policy.attestations.subjects, 'release/SHA256SUMS');
	assert.equal(policy.attestations.provenance, true);
	assert.equal(policy.attestations.sbom, true);
	assert.equal(policy.stableAssets.normalReplacementAllowed, false);
	assert.equal(policy.stableAssets.repairWorkflow, 'release-repair.yml');
	assert.equal(policy.stableAssets.confirmation, 'REPLACE_STABLE_ASSETS');
	assert.equal(policy.stableAssets.assetSetMustMatch, true);
	assert.equal(policy.stableAssets.auditRetentionDays, 365);
});
