import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const readWorkflow = name => readFile(resolve('.github/workflows', name), 'utf8');

test('normal stable release path cannot overwrite an existing release', async () => {
	const source = await readWorkflow('release.yml');
	assert.match(source, /gh release view "\$GITHUB_REF_NAME"/u);
	assert.match(source, /stable assets are immutable/u);
	assert.match(source, /gh release create "\$GITHUB_REF_NAME" release\/\*/u);
	assert.doesNotMatch(source, /--clobber/u);
});

test('stable releases generate provenance and SBOM attestations', async () => {
	const source = await readWorkflow('release.yml');
	assert.match(source, /attestations:\s+write/u);
	assert.match(source, /artifact-metadata:\s+write/u);
	assert.match(source, /id-token:\s+write/u);
	assert.equal((source.match(/uses: actions\/attest@[0-9a-f]{40}/gu) ?? []).length, 2);
	assert.match(source, /subject-checksums: release\/SHA256SUMS/u);
	assert.match(source, /sbom-path: release\/SBOM\.cdx\.json/u);
});

test('exceptional replacement is manual, confirmed and audited', async () => {
	const source = await readWorkflow('release-repair.yml');
	assert.match(source, /^on:\n  workflow_dispatch:/mu);
	assert.doesNotMatch(source, /^  (?:push|pull_request|schedule):/mu);
	assert.match(source, /inputs\.confirm == 'REPLACE_STABLE_ASSETS'/u);
	assert.match(source, /environment: release-repair/u);
	assert.match(source, /write-release-repair-audit\.mjs/u);
	assert.match(source, /retention-days: 365/u);
	assert.match(source, /gh release upload "\$TAG" release\/\* --clobber/u);
	assert.match(source, /Additions or removals require a new release version/u);
});
