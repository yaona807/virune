import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import {
	buildNpmPublicationIdentityFromInputs,
	bundledCliReleaseAssetName,
	registryPolicyForVersion,
	registryReleaseAssetNameForPackage,
	verifyPublicationIdentityDocument,
	verifyRegistryCliCandidateTarball,
} from './verify-npm-publication-identity.mjs';

const publishPackages = [
	{ workspaceName: 'virune', registryName: 'virune' },
	{ workspaceName: '@virune/compiler', registryName: '@virune/compiler' },
	{ workspaceName: '@virune/formatter', registryName: '@virune/formatter' },
	{ workspaceName: '@virune/js-interop', registryName: '@virune/js-interop' },
	{ workspaceName: '@virune/runtime', registryName: '@virune/runtime' },
	{ workspaceName: '@virune/stdlib', registryName: '@virune/stdlib' },
];
const expectedAssets = {
	virune: 'virune-npm-1.0.0.tgz',
	'@virune/compiler': 'virune-compiler-1.0.0.tgz',
	'@virune/formatter': 'virune-formatter-1.0.0.tgz',
	'@virune/js-interop': 'virune-js-interop-1.0.0.tgz',
	'@virune/runtime': 'virune-runtime-1.0.0.tgz',
	'@virune/stdlib': 'virune-stdlib-1.0.0.tgz',
};

function fixture(version = '1.0.0') {
	const assetBytes = {};
	const releaseManifestPackages = [];
	const releaseTarballs = [];
	for (const pkg of publishPackages) {
		const file = registryReleaseAssetNameForPackage(pkg.registryName, version);
		const bytes = Buffer.from(`fixture:${pkg.registryName}:${version}\n`, 'utf8');
		assetBytes[file] = bytes;
		releaseTarballs.push(file);
		releaseManifestPackages.push({
			file,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			bytes: bytes.byteLength,
		});
	}
	const bundledCli = bundledCliReleaseAssetName(version);
	const bundledBytes = Buffer.from(`fixture:bundled-cli:${version}\n`, 'utf8');
	assetBytes[bundledCli] = bundledBytes;
	releaseTarballs.push(bundledCli);
	releaseManifestPackages.push({
		file: bundledCli,
		sha256: createHash('sha256').update(bundledBytes).digest('hex'),
		bytes: bundledBytes.byteLength,
	});
	return {
		version,
		publicationReady: false,
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
		publishPackages: structuredClone(publishPackages),
		releaseManifest: { schemaVersion: 1, version, packages: releaseManifestPackages },
		releaseTarballs,
		assetBytes,
	};
}

function build(input = fixture()) {
	return buildNpmPublicationIdentityFromInputs(input);
}

test('current six public packages have independently fixed canonical release asset names', () => {
	for (const [registryName, expected] of Object.entries(expectedAssets)) {
		assert.equal(registryReleaseAssetNameForPackage(registryName, '1.0.0'), expected);
	}
	assert.throws(() => registryReleaseAssetNameForPackage('@other/runtime', '1.0.0'), /expected virune or an @virune\/\* package name/u);
	assert.throws(() => registryReleaseAssetNameForPackage('@virune/runtime', '1.0.0-preview.1'), /expected stable, alpha, beta, rc, or nightly/u);
	assert.equal(bundledCliReleaseAssetName('1.0.0'), 'virune-1.0.0.tgz');
	assert.notEqual(expectedAssets.virune, bundledCliReleaseAssetName('1.0.0'));
});

test('v1.0.0 publication identity is deterministic, byte-bound, and registry-ineligible', () => {
	const input = fixture();
	const identity = build(input);
	assert.equal(identity.version, '1.0.0');
	assert.equal(identity.githubReleaseTag, 'v1.0.0');
	assert.equal(identity.publishSource, 'reviewed-release-registry-candidate-tarball');
	assert.equal(identity.bundledCliReleaseAsset, 'virune-1.0.0.tgz');
	assert.equal(identity.publicationReady, false);
	assert.equal(identity.registryVersionEligible, false);
	assert.equal(identity.distTag, null);
	assert.equal(identity.packages.length, 6);
	assert.deepEqual(identity.packages.map(item => item.registryName), [...publishPackages].map(item => item.registryName).sort());
	for (const item of identity.packages) {
		assert.equal(item.releaseAsset, expectedAssets[item.registryName]);
		assert.match(item.sha256, /^[0-9a-f]{64}$/u);
		assert(item.bytes > 0);
	}

	const reversed = fixture();
	reversed.publishPackages.reverse();
	reversed.releaseManifest.packages.reverse();
	reversed.releaseTarballs.reverse();
	assert.deepEqual(build(reversed), identity);
});

test('version policy fails closed before v1.1.0 and selects only approved stable/prerelease tags', () => {
	const tags = { stable: 'latest', prerelease: 'next', nightly: null };
	assert.deepEqual(registryPolicyForVersion('1.0.1', '1.1.0', tags), { channel: 'stable', registryVersionEligible: false, distTag: null });
	assert.deepEqual(registryPolicyForVersion('1.0.9-rc.1', '1.1.0', tags), { channel: 'prerelease', registryVersionEligible: false, distTag: null });
	assert.deepEqual(registryPolicyForVersion('1.1.0', '1.1.0', tags), { channel: 'stable', registryVersionEligible: true, distTag: 'latest' });
	assert.deepEqual(registryPolicyForVersion('1.1.0-alpha.1', '1.1.0', tags), { channel: 'prerelease', registryVersionEligible: true, distTag: 'next' });
	assert.deepEqual(registryPolicyForVersion('1.1.0-beta.2', '1.1.0', tags), { channel: 'prerelease', registryVersionEligible: true, distTag: 'next' });
	assert.deepEqual(registryPolicyForVersion('1.1.0-rc.3', '1.1.0', tags), { channel: 'prerelease', registryVersionEligible: true, distTag: 'next' });
	assert.deepEqual(registryPolicyForVersion('2.0.0', '1.1.0', tags), { channel: 'stable', registryVersionEligible: true, distTag: 'latest' });
	assert.deepEqual(registryPolicyForVersion('1.1.0-nightly.20260817.1', '1.1.0', tags), { channel: 'nightly', registryVersionEligible: false, distTag: null });
	assert.throws(() => registryPolicyForVersion('1.1.0-preview.1', '1.1.0', tags), /expected stable, alpha, beta, rc, or nightly/u);
	assert.throws(() => registryPolicyForVersion('1.1.0', '1.1.0', { ...tags, stable: 'stable' }), /stable npm publication must use latest/u);
	assert.throws(() => registryPolicyForVersion('1.1.0-rc.1', '1.1.0', { ...tags, prerelease: 'preview' }), /prerelease npm publication must use next/u);
	assert.throws(() => registryPolicyForVersion('1.1.0', '1.1.0', { ...tags, nightly: 'nightly' }), /nightly npm publication must remain disabled/u);
});

test('package and tarball sets must be exact and unique', () => {
	const missingTarball = fixture();
	missingTarball.releaseTarballs.pop();
	assert.throws(() => build(missingTarball), /expected exact release tarball set/u);

	const extraTarball = fixture();
	const extra = 'virune-extra-1.0.0.tgz';
	extraTarball.releaseTarballs.push(extra);
	extraTarball.assetBytes[extra] = Buffer.from('extra');
	assert.throws(() => build(extraTarball), /expected exact release tarball set/u);

	const duplicateTarball = fixture();
	duplicateTarball.releaseTarballs.push(duplicateTarball.releaseTarballs[0]);
	assert.throws(() => build(duplicateTarball), /duplicate tarball/u);

	const missingManifestPackage = fixture();
	missingManifestPackage.releaseManifest.packages.pop();
	assert.throws(() => build(missingManifestPackage), /expected exact release package manifest set/u);

	const extraManifestPackage = fixture();
	extraManifestPackage.releaseManifest.packages.push({ file: 'virune-extra-1.0.0.tgz', sha256: '0'.repeat(64), bytes: 1 });
	assert.throws(() => build(extraManifestPackage), /expected exact release package manifest set/u);

	const duplicateManifestPackage = fixture();
	duplicateManifestPackage.releaseManifest.packages.push(structuredClone(duplicateManifestPackage.releaseManifest.packages[0]));
	assert.throws(() => build(duplicateManifestPackage), /duplicate file/u);

	const duplicateRegistry = fixture();
	duplicateRegistry.publishPackages[1] = structuredClone(duplicateRegistry.publishPackages[0]);
	assert.throws(() => build(duplicateRegistry), /duplicate registryName/u);

	const packageNameDrift = fixture();
	packageNameDrift.publishPackages[1].registryName = '@virune/compiler-renamed';
	assert.throws(() => build(packageNameDrift), /registry package renaming is not supported/u);
});

test('release manifest hash, size, version, and schema are verified against actual bytes', () => {
	const wrongHash = fixture();
	wrongHash.releaseManifest.packages[0].sha256 = '0'.repeat(64);
	assert.throws(() => build(wrongHash), /does not match actual release tarball bytes/u);

	const wrongSize = fixture();
	wrongSize.releaseManifest.packages[0].bytes += 1;
	assert.throws(() => build(wrongSize), /does not match actual release tarball byte size/u);

	const wrongVersion = fixture();
	wrongVersion.releaseManifest.version = '1.0.1';
	assert.throws(() => build(wrongVersion), /releaseManifest\.version: expected 1\.0\.0/u);

	const malformedHash = fixture();
	malformedHash.releaseManifest.packages[0].sha256 = 'ABC';
	assert.throws(() => build(malformedHash), /expected a lowercase SHA-256 digest/u);

	const staleBytes = fixture();
	const first = staleBytes.releaseTarballs[0];
	staleBytes.assetBytes[first] = Buffer.from('changed bytes');
	assert.throws(() => build(staleBytes), /does not match actual release tarball/u);
});


test('Registry CLI candidate is unbundled, publishable, and pinned to the exact Virune dependency version', () => {
	const good = registryCliTarball({
		name: 'virune',
		version: '1.0.0',
		dependencies: { '@virune/compiler': '1.0.0' },
	});
	assert.deepEqual(verifyRegistryCliCandidateTarball(good, '1.0.0'), { name: 'virune', version: '1.0.0', entryCount: 3 });

	const bundledDeclaration = registryCliTarball({
		name: 'virune', version: '1.0.0',
		dependencies: { '@virune/compiler': '1.0.0' },
		bundledDependencies: ['@virune/compiler'],
	});
	assert.throws(() => verifyRegistryCliCandidateTarball(bundledDeclaration, '1.0.0'), /must not declare bundled dependencies/u);

	const bundledFiles = registryCliTarball(
		{ name: 'virune', version: '1.0.0', dependencies: { '@virune/compiler': '1.0.0' } },
		[['package/node_modules/@virune/compiler/package.json', '{}\n']],
	);
	assert.throws(() => verifyRegistryCliCandidateTarball(bundledFiles, '1.0.0'), /must not contain bundled dependency path/u);

	assert.throws(() => verifyRegistryCliCandidateTarball(registryCliTarball({ name: 'virune', version: '1.0.0', private: true }), '1.0.0'), /must omit private/u);
	assert.throws(() => verifyRegistryCliCandidateTarball(registryCliTarball({ name: 'virune', version: '1.0.0', private: false }), '1.0.0'), /must omit private/u);
	assert.throws(() => verifyRegistryCliCandidateTarball(registryCliTarball({ name: 'virune', version: '1.0.0', publishConfig: { access: 'public' } }), '1.0.0'), /publishConfig must not be present/u);
	assert.throws(() => verifyRegistryCliCandidateTarball(registryCliTarball({ name: 'virune', version: '1.0.0', dependencies: { '@virune/compiler': '0.9.0' } }), '1.0.0'), /expected exact release version 1\.0\.0/u);
	assert.throws(() => verifyRegistryCliCandidateTarball(registryCliTarball({ name: 'virune', version: '1.0.0', dependencies: [] }), '1.0.0'), /dependencies: expected an object/u);
	const legal = { expectedLicense: 'Apache-2.0', licenseBytes: Buffer.from('license\n'), noticeBytes: Buffer.from('notice\n') };
	assert.doesNotThrow(() => verifyRegistryCliCandidateTarball(registryCliTarball({ name: 'virune', version: '1.0.0', license: 'Apache-2.0' }), '1.0.0', undefined, legal));
	assert.throws(() => verifyRegistryCliCandidateTarball(registryCliTarball({ name: 'virune', version: '1.0.0', license: 'MIT' }), '1.0.0', undefined, legal), /expected Apache-2\.0/u);
	assert.throws(() => verifyRegistryCliCandidateTarball(registryCliTarball({ name: 'virune', version: '1.0.0', license: 'Apache-2.0' }, [], { notice: 'stale\n' }), '1.0.0', undefined, legal), /NOTICE does not match the canonical repository file/u);
});

test('publication manifest verification rejects stale or mutated evidence', () => {
	const expected = build();
	assert.equal(verifyPublicationIdentityDocument(expected, structuredClone(expected)), expected);
	const mutated = structuredClone(expected);
	mutated.githubReleaseTag = 'v9.9.9';
	assert.throws(() => verifyPublicationIdentityDocument(expected, mutated), /does not match the canonical publication identity/u);
	const mutatedTag = structuredClone(expected);
	mutatedTag.distTag = 'latest';
	assert.throws(() => verifyPublicationIdentityDocument(expected, mutatedTag), /does not match the canonical publication identity/u);
});

test('release packaging writes publication identity before release integrity files', () => {
	const source = readFileSync(resolve('scripts/package.mjs'), 'utf8');
	assert.match(source, /writeNpmPublicationIdentity/u);
	const publicationIndex = source.lastIndexOf('writeNpmPublicationIdentity');
	const integrityIndex = source.lastIndexOf('writeReleaseIntegrityFiles');
	assert(publicationIndex >= 0 && integrityIndex > publicationIndex, 'publication manifest must be written before release integrity files');
});

test('stable release gate validates publication identity after release artifacts are built', () => {
	const policy = JSON.parse(readFileSync(resolve('.github/stable-release-gate.json'), 'utf8'));
	const releaseIndex = policy.checks.findIndex(item => item.id === 'release-artifacts');
	const identityIndex = policy.checks.findIndex(item => item.id === 'npm-publication-identity');
	assert(releaseIndex >= 0);
	assert(identityIndex > releaseIndex);
	assert.deepEqual(policy.checks[identityIndex].command, ['node', 'scripts/verify-npm-publication-identity.mjs']);
	assert.deepEqual(policy.requirements.find(item => item.id === 'npm-publication-identity'), {
		id: 'npm-publication-identity',
		evidence: ['npm-publication-identity'],
	});
});


function registryCliTarball(manifest, extraEntries = [], { license = 'license\n', notice = 'notice\n' } = {}) {
	return gzipSync(buildTar([
		['package/package.json', `${JSON.stringify(manifest)}\n`],
		['package/LICENSE', license],
		['package/NOTICE', notice],
		...extraEntries,
	]));
}

function buildTar(entries) {
	const chunks = [];
	for (const [name, value] of entries) {
		const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
		const header = Buffer.alloc(512);
		Buffer.from(name).copy(header, 0, 0, 100);
		header.write(`${content.byteLength.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
		header[156] = '0'.charCodeAt(0);
		chunks.push(header, content);
		const padding = (512 - content.byteLength % 512) % 512;
		if (padding > 0) chunks.push(Buffer.alloc(padding));
	}
	chunks.push(Buffer.alloc(1024));
	return Buffer.concat(chunks);
}
