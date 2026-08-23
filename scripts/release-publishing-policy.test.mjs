import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import './release-security-policy.test.mjs';

const readWorkflow = name => readFile(resolve('.github/workflows', name), 'utf8');

test('normal release path cannot overwrite an existing release', async () => {
	const source = await readWorkflow('release.yml');
	assert.match(source, /gh release view "\$TAG"/u);
	assert.match(source, /release assets are immutable/u);
	assert.match(source, /gh release create "\$\{release_args\[@\]\}"/u);
	assert.doesNotMatch(source, /--clobber/u);
});

test('release-candidate branches are restricted to matching prerelease versions', async () => {
	const source = await readWorkflow('release.yml');
	assert.match(source, /branches:\n\s+- 'release-candidate\/v\*'/u);
	assert.match(source, /expected_branch="release-candidate\/\$\{tag\}"/u);
	assert.match(source, /Release-candidate branches may publish prerelease versions only/u);
	assert.match(source, /gh api --method POST .*refs\/tags\/\$TAG/u);
	assert.match(source, /release_args\+=\(--prerelease\)/u);
});

test('releases generate provenance and SBOM attestations for every asset', async () => {
	const source = await readWorkflow('release.yml');
	assert.match(source, /attestations:\s+write/u);
	assert.match(source, /artifact-metadata:\s+write/u);
	assert.match(source, /id-token:\s+write/u);
	assert.equal((source.match(/uses: actions\/attest@[0-9a-f]{40}/gu) ?? []).length, 2);
	assert.equal((source.match(/subject-path: release\/\*/gu) ?? []).length, 2);
	assert.match(source, /sbom-path: release\/SBOM\.cdx\.json/u);
});

test('normal npm publication uses verified eligibility and precedes immutable GitHub Release creation', async () => {
	const source = await readWorkflow('release.yml');
	assert.match(source, /id-token:\s+write/u);
	assert.match(source, /concurrency:\n\s+group: virune-release-publication\n\s+cancel-in-progress: false/u);
	assert.doesNotMatch(source, /group:\s+release-\$\{\{\s*github\.ref\s*\}\}/u);
	assert.match(source, /name: Resolve verified npm publication eligibility/u);
	assert.match(source, /import \{ verifyNpmPublicationIdentity \} from '\.\/scripts\/verify-npm-publication-identity\.mjs';/u);
	assert.match(source, /const identity = verifyNpmPublicationIdentity\(\);/u);
	assert.match(source, /eligible=\$\{identity\.registryVersionEligible\}/u);
	assert.equal((source.match(/if: steps\.npm-publication\.outputs\.eligible == 'true'/gu) ?? []).length, 2);
	assert.match(source, /npm install --global npm@11\.19\.0 --registry=https:\/\/registry\.npmjs\.org\/ --ignore-scripts --no-audit --no-fund/u);
	assert.match(source, /test "\$\(npm --version\)" = "11\.19\.0"/u);
	assert.match(source, /node scripts\/publish-npm-release\.mjs --expected-commit="\$GITHUB_SHA"/u);
	assert.doesNotMatch(source, /NPM_TOKEN|NODE_AUTH_TOKEN/u);
	assert.doesNotMatch(source, /npm\s+dist-tag/u);
	assert.doesNotMatch(source, /registry-url:/u);

	const releaseGate = source.indexOf('npm run release:gate');
	const provenance = source.indexOf('name: Attest release build provenance');
	const sbom = source.indexOf('name: Attest release SBOM');
	const eligibility = source.indexOf('name: Resolve verified npm publication eligibility');
	const npmPin = source.indexOf('name: Pin npm Trusted Publishing client');
	const npmPublish = source.indexOf('name: Publish reviewed npm Registry packages');
	const githubRelease = source.indexOf('name: Create immutable GitHub Release');
	for (const [label, position] of Object.entries({ releaseGate, provenance, sbom, eligibility, npmPin, npmPublish, githubRelease })) {
		assert.notEqual(position, -1, `missing release workflow boundary: ${label}`);
	}
	assert(releaseGate < provenance, 'release gate must precede release attestations');
	assert(provenance < sbom, 'build provenance must precede SBOM attestation');
	assert(sbom < eligibility, 'release attestations must complete before npm eligibility is derived from reviewed artifacts');
	assert(eligibility < npmPin, 'npm-ineligible releases must be identified before the npm client network fetch');
	assert(npmPin < npmPublish, 'the exact npm client must be selected before publication');
	assert(npmPublish < githubRelease, 'npm publication/recovery must run before immutable GitHub Release creation');
});

test('public and restored VSIX legal verification are pinned to their reviewed commits', async () => {
	const publicWorkflow = await readWorkflow('release-public-verify.yml');
	assert.match(publicWorkflow, /VIRUNE_REVIEWED_COMMIT: \$\{\{ steps\.request\.outputs\.expected_commit \}\}/u);
	const restoreWorkflow = await readWorkflow('release-restore.yml');
	assert.match(restoreWorkflow, /VIRUNE_REVIEWED_COMMIT: \$\{\{ steps\.verified\.outputs\.expected_commit \}\}/u);
	const smoke = await readFile(resolve('scripts/vsix-smoke-suite.mjs'), 'utf8');
	assert.match(smoke, /createReviewedRepositorySourceReader/u);
	assert.match(smoke, /packages\/vscode\/package\.json/u);
	assert.match(smoke, /reviewedManifest\.license/u);
	assert.doesNotMatch(smoke, /extension\.packageJSON\.license,\s*'Apache-2\.0'/u);
	assert.match(smoke, /scripts\/vscode-third-party-licenses\.mjs', \{ optional: true \}/u);
});

test('exceptional replacement is manual, confirmed and audited', async () => {
	const source = await readWorkflow('release-repair.yml');
	assert.match(source, /^on:\n  workflow_dispatch:/mu);
	assert.doesNotMatch(source, /^  (?:push|pull_request|schedule):/mu);
	assert.match(source, /inputs\.confirm == 'REPLACE_STABLE_ASSETS'/u);
	assert.match(source, /environment: release-repair/u);
	assert.match(source, /write-release-repair-audit\.mjs/u);
	assert.match(source, /retention-days: 365/u);
	assert.equal((source.match(/subject-path: release\/\*/gu) ?? []).length, 2);
	assert.match(source, /gh release upload "\$TAG" release\/\* --clobber/u);
	assert.match(source, /Additions or removals require a new release version/u);
});
