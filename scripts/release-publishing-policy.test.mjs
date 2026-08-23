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

test('packaged release installation guidance follows the reviewed npm publication identity', async () => {
	const source = await readFile(resolve('scripts/package.mjs'), 'utf8');
	assert.match(source, /const publicationIdentity = writeNpmPublicationIdentity\(\{ releaseDirectory: out \}\);/u);
	assert.match(source, /publicationIdentity\.registryVersionEligible === true && publicationIdentity\.publicationReady === true/u);
	assert.match(source, /The public npm Registry is the canonical package distribution for this Virune release\./u);
	assert.match(source, /npm install --global virune@\$\{version\}/u);
	assert.match(source, /GitHub Releases retain the reviewed release artifacts, checksums, SBOM, attestations/u);
	assert.match(source, /public npm Registryを正式なpackage配布経路とします/u);
	assert.match(source, /Virune is not published to the npm Registry/u);
	assert.match(source, /Viruneはnpm Registryへ公開しません/u);
});

test('public release verification binds required npm Registry consumer evidence before committed success', async () => {
	const source = await readWorkflow('release-public-verify.yml');
	assert.doesNotMatch(source, /Public prerelease verification requires a prerelease version/u);
	assert.match(source, /node --test scripts\/verify-public-release\.test\.mjs scripts\/verify-public-npm-registry-channel\.test\.mjs/u);
	assert.match(source, /name: Resolve public npm Registry verification requirement/u);
	assert.match(source, /report\.npmPublication/u);
	assert.match(source, /required=\$\{publication\.registryVersionEligible\}/u);
	assert.match(source, /if: steps\.npm-verification\.outputs\.required == 'true'/u);
	assert.match(source, /scripts\/verify-public-npm-registry\.mjs/u);
	assert.match(source, /--publication-manifest=\.cache\/public-release\/PUBLICATION-MANIFEST\.json/u);
	assert.match(source, /--public-release-report=\.cache\/public-release\/public-release-report\.json/u);
	assert.match(source, /--bind-public-release-report/u);
	assert.match(source, /if: steps\.npm-verification\.outputs\.required == 'false'/u);
	assert.match(source, /bindPublicNpmRegistryEvidence/u);
	assert.match(source, /name: Validate final public verification evidence/u);
	assert.match(source, /report\.npmRegistry\?\.required !== required/u);
	assert.match(source, /\.cache\/public-npm-registry\//u);
	assert.doesNotMatch(source, /npm install --global virune/u);

	const download = source.indexOf('name: Download and verify public release assets and clean CLI installation');
	const requirement = source.indexOf('name: Resolve public npm Registry verification requirement');
	const attestations = source.indexOf('name: Verify provenance and CycloneDX attestations');
	const prerequisites = source.indexOf('name: Finalize GitHub Release verification prerequisites');
	const registry = source.indexOf('name: Verify public npm Registry consumer path');
	const notRequired = source.indexOf('name: Record npm Registry verification as not required');
	const finalEvidence = source.indexOf('name: Validate final public verification evidence');
	const upload = source.indexOf('name: Upload public verification evidence');
	const commit = source.indexOf('name: Commit verification record');
	for (const [label, position] of Object.entries({ download, requirement, attestations, prerequisites, registry, notRequired, finalEvidence, upload, commit })) {
		assert.notEqual(position, -1, `missing public verification boundary: ${label}`);
	}
	assert(download < requirement, 'Registry requirement must come from the freshly downloaded exact public-release report');
	assert(requirement < attestations, 'Registry requirement must be fixed before final prerequisite verification');
	assert(attestations < prerequisites, 'attestation verification must finish before prerequisite evidence is finalized');
	assert(prerequisites < registry, 'npm Registry verification must consume finalized GitHub Release prerequisites');
	assert(prerequisites < notRequired, 'historical no-Registry evidence must consume finalized GitHub Release prerequisites');
	assert(registry < finalEvidence && notRequired < finalEvidence, 'both Registry branches must converge before the final evidence guard');
	assert(finalEvidence < upload, 'final evidence guard must precede artifact upload');
	assert(upload < commit, 'only uploaded passing evidence may be committed');
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
