import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	parseChecksums,
	readReviewedNpmPublicationPolicy,
	resolveReviewedCommit,
	validateDownloadedRelease,
	validateReleaseRecord,
} from './verify-public-release.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const version = '1.0.0-rc.1';
const registryVersion = '1.1.0-rc.1';
const requiredNames = [
	'LICENSE', 'MANIFEST.json', 'NOTICE', 'README.md', 'README_ja.md', 'RELEASE-MANIFEST.json', 'SBOM.cdx.json', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_ja.md', 'package.json',
	`virune-${version}.tgz`, `virune-compiler-${version}.tgz`, `virune-formatter-${version}.tgz`, `virune-js-interop-${version}.tgz`, `virune-runtime-${version}.tgz`, `virune-stdlib-${version}.tgz`, `virune-vscode-${version}.vsix`,
];
const registryRequiredNames = [
	'LICENSE', 'MANIFEST.json', 'NOTICE', 'README.md', 'README_ja.md', 'RELEASE-MANIFEST.json', 'SBOM.cdx.json', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_ja.md', 'package.json',
	`virune-${registryVersion}.tgz`, `virune-compiler-${registryVersion}.tgz`, `virune-formatter-${registryVersion}.tgz`, `virune-js-interop-${registryVersion}.tgz`, `virune-runtime-${registryVersion}.tgz`, `virune-stdlib-${registryVersion}.tgz`, `virune-vscode-${registryVersion}.vsix`,
	'PUBLICATION-MANIFEST.json', `virune-npm-${registryVersion}.tgz`,
];
const reviewedLegalFiles = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_ja.md'];

test('accepts a published prerelease with the complete required asset set', () => {
	assert.doesNotThrow(() => validateReleaseRecord({
		tag_name: `v${version}`,
		draft: false,
		prerelease: true,
		assets: requiredNames.map(name => ({ name })),
	}, { tag: `v${version}`, version }));
});

test('rejects drafts, stable releases and incomplete candidates', () => {
	assert.throws(() => validateReleaseRecord({ tag_name: `v${version}`, draft: true, prerelease: true, assets: requiredNames.map(name => ({ name })) }, { tag: `v${version}`, version }), /draft/u);
	assert.throws(() => validateReleaseRecord({ tag_name: `v${version}`, draft: false, prerelease: false, assets: requiredNames.map(name => ({ name })) }, { tag: `v${version}`, version }), /prerelease/u);
	assert.throws(() => validateReleaseRecord({ tag_name: `v${version}`, draft: false, prerelease: true, assets: [] }, { tag: `v${version}`, version }), /no uploaded assets/u);
	assert.throws(
		() => validateReleaseRecord({ tag_name: `v${version}`, draft: false, prerelease: true, assets: requiredNames.filter(name => name !== 'LICENSE').map(name => ({ name })) }, { tag: `v${version}`, version }),
		/Release is missing LICENSE/u,
	);
	assert.throws(
		() => validateReleaseRecord({ tag_name: `v${version}`, draft: false, prerelease: true, assets: requiredNames.filter(name => name !== 'NOTICE').map(name => ({ name })) }, { tag: `v${version}`, version }),
		/Release is missing NOTICE/u,
	);
});

test('requires npm publication identity assets for registry-eligible prereleases', () => {
	assert.doesNotThrow(() => validateReleaseRecord({
		tag_name: `v${registryVersion}`,
		draft: false,
		prerelease: true,
		assets: registryRequiredNames.map(name => ({ name })),
	}, { tag: `v${registryVersion}`, version: registryVersion }));
	assert.throws(
		() => validateReleaseRecord({ tag_name: `v${registryVersion}`, draft: false, prerelease: true, assets: registryRequiredNames.filter(name => name !== 'PUBLICATION-MANIFEST.json').map(name => ({ name })) }, { tag: `v${registryVersion}`, version: registryVersion }),
		/Release is missing PUBLICATION-MANIFEST\.json/u,
	);
	assert.throws(
		() => validateReleaseRecord({ tag_name: `v${registryVersion}`, draft: false, prerelease: true, assets: registryRequiredNames.filter(name => name !== `virune-npm-${registryVersion}.tgz`).map(name => ({ name })) }, { tag: `v${registryVersion}`, version: registryVersion }),
		new RegExp(`Release is missing virune-npm-${registryVersion.replaceAll('.', '\\.')}\\.tgz`, 'u'),
	);
});

test('duplicate or unknown assets cannot substitute for missing npm publication identity evidence', () => {
	const incomplete = registryRequiredNames.filter(name => name !== 'PUBLICATION-MANIFEST.json').map(name => ({ name }));
	incomplete.push({ name: 'LICENSE' }, { name: 'unexpected-extra-asset.txt' });
	assert.throws(
		() => validateReleaseRecord({ tag_name: `v${registryVersion}`, draft: false, prerelease: true, assets: incomplete }, { tag: `v${registryVersion}`, version: registryVersion }),
		/Release is missing PUBLICATION-MANIFEST\.json/u,
	);
});

test('registry eligibility follows the reviewed release policy rather than a stale checkout policy', () => {
	const withoutNpmIdentity = registryRequiredNames
		.filter(name => name !== 'PUBLICATION-MANIFEST.json' && name !== `virune-npm-${registryVersion}.tgz`)
		.map(name => ({ name }));
	const release = { tag_name: `v${registryVersion}`, draft: false, prerelease: true, assets: withoutNpmIdentity };
	const reviewedPolicy = {
		firstStableRegistryRelease: '1.2.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
	};
	const staleCheckoutPolicy = {
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
	};
	assert.doesNotThrow(() => validateReleaseRecord(release, {
		tag: `v${registryVersion}`,
		version: registryVersion,
		npmPublicationPolicy: reviewedPolicy,
	}));
	assert.throws(() => validateReleaseRecord(release, {
		tag: `v${registryVersion}`,
		version: registryVersion,
		npmPublicationPolicy: staleCheckoutPolicy,
	}), /Release is missing PUBLICATION-MANIFEST\.json/u);
});

test('the resolved Git tag commit is the reviewed source even without an expected-commit fence', () => {
	const tag = `v${registryVersion}`;
	const tagCommit = 'a'.repeat(40);
	assert.equal(resolveReviewedCommit(tag, tagCommit, undefined), tagCommit);
	assert.equal(resolveReviewedCommit(tag, tagCommit, tagCommit), tagCommit);
	assert.throws(() => resolveReviewedCommit(tag, undefined, undefined), /did not resolve to a commit SHA/u);
	assert.throws(() => resolveReviewedCommit(tag, 'ABC', undefined), /did not resolve to a commit SHA/u);
	assert.throws(() => resolveReviewedCommit(tag, tagCommit, 'b'.repeat(40)), /points to .* expected/u);
});

test('missing reviewed npm policy falls back only for legacy Registry-ineligible versions', async () => {
	const fallbackPolicy = {
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
	};
	const missingPolicy = async () => { throw new Error('reviewed policy missing'); };
	assert.equal(await readReviewedNpmPublicationPolicy('a'.repeat(40), version, {
		readReviewed: missingPolicy,
		fallbackPolicy,
	}), fallbackPolicy);
	await assert.rejects(() => readReviewedNpmPublicationPolicy('a'.repeat(40), registryVersion, {
		readReviewed: missingPolicy,
		fallbackPolicy,
	}), /reviewed policy missing/u);
	await assert.rejects(() => readReviewedNpmPublicationPolicy('a'.repeat(40), version, {
		readReviewed: async () => Buffer.from('{ malformed'),
		fallbackPolicy,
	}), /Reviewed npm publication policy is malformed/u);
});

test('parses strict checksum records and rejects duplicates', () => {
	const digest = 'a'.repeat(64);
	assert.equal(parseChecksums(`${digest}  example.tgz\n`).get('example.tgz'), digest);
	assert.throws(() => parseChecksums(`${digest} example.tgz\n`), /Invalid SHA256SUMS/u);
	assert.throws(() => parseChecksums(`${digest}  example.tgz\n${digest}  example.tgz\n`), /Duplicate checksum/u);
});

test('validates downloaded checksums, reviewed legal assets and CycloneDX 1.6 SBOM', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'virune-public-release-test-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeDownloadedReleaseFixture(directory);
	const result = await validateDownloadedRelease(directory, version);
	assert.equal(result.manifest.schemaVersion, 2);
	assert.equal(result.sbom.specVersion, '1.6');
	assert.equal(result.sbom.license, 'Apache-2.0');
	assert.equal(result.assets.length, 8);
});

test('validates reviewed legal assets against an immutable Git commit object', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'virune-public-release-commit-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeDownloadedReleaseFixture(directory);
	const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	const reviewedCommit = result.stdout.trim();
	assert.match(reviewedCommit, /^[0-9a-f]{40}$/u);
	await assert.doesNotReject(() => validateDownloadedRelease(directory, version, { reviewedCommit }));
});

test('rejects a downloaded release whose package metadata has a stale license', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'virune-public-release-package-license-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeDownloadedReleaseFixture(directory, { packageLicense: 'MIT' });
	await assert.rejects(
		() => validateDownloadedRelease(directory, version),
		/Public release package\.json license must be exactly Apache-2\.0/u,
	);
});

test('rejects a downloaded release whose legal assets differ from reviewed source', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'virune-public-release-legal-drift-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeDownloadedReleaseFixture(directory, { legalOverrides: { NOTICE: 'tampered notice\n' } });
	await assert.rejects(
		() => validateDownloadedRelease(directory, version),
		/Public release NOTICE does not match the reviewed release source/u,
	);
});

test('rejects a downloaded release whose SBOM root license is stale', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'virune-public-release-license-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	await writeDownloadedReleaseFixture(directory, { sbomLicense: 'MIT' });
	await assert.rejects(
		() => validateDownloadedRelease(directory, version),
		/Release SBOM root license must be exactly Apache-2\.0/u,
	);
});

async function writeDownloadedReleaseFixture(directory, {
	packageLicense = 'Apache-2.0',
	sbomLicense = 'Apache-2.0',
	legalOverrides = {},
} = {}) {
	const payloads = new Map([
		['artifact.tgz', Buffer.from('artifact')],
		['package.json', Buffer.from(`${JSON.stringify({ name: 'virune-local-release', version, license: packageLicense }, null, 2)}\n`)],
		['SBOM.cdx.json', Buffer.from(`${JSON.stringify({
			bomFormat: 'CycloneDX',
			specVersion: '1.6',
			serialNumber: 'urn:uuid:00000000-0000-5000-8000-000000000000',
			metadata: { component: { version, licenses: [{ license: { id: sbomLicense } }] },
			components: [],
		}, null, 2)}\n`)],
	]);
	for (const file of reviewedLegalFiles) {
		const override = legalOverrides[file];
		payloads.set(file, override === undefined ? await readFile(resolve(repositoryRoot, file)) : Buffer.from(override));
	}

	const records = [];
	for (const [file, bytes] of payloads) {
		await writeFile(join(directory, file), bytes);
		records.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength });
	}
	const sbomRecord = records.find(item => item.file === 'SBOM.cdx.json');
	const manifest = {
		schemaVersion: 2,
		version,
		sbom: { ...sbomRecord, format: 'CycloneDX', specVersion: '1.6', serialNumber: 'urn:uuid:00000000-0000-5000-8000-000000000000' },
		files: records,
	};
	await writeFile(join(directory, 'RELEASE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	const manifestBytes = await readFile(join(directory, 'RELEASE-MANIFEST.json'));
	const checksumEntries = [...records, {
		file: 'RELEASE-MANIFEST.json',
		sha256: createHash('sha256').update(manifestBytes).digest('hex'),
		bytes: manifestBytes.byteLength,
	}];
	await writeFile(
		join(directory, 'SHA256SUMS'),
		`${checksumEntries.sort((left, right) => left.file.localeCompare(right.file)).map(item => `${item.sha256}  ${item.file}`).join('\n')}\n`,
	);
}
