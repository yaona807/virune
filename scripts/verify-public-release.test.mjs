import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseChecksums, validateDownloadedRelease, validateReleaseRecord } from './verify-public-release.mjs';

const version = '1.0.0-rc.1';
const requiredNames = [
	'MANIFEST.json', 'README.md', 'README_ja.md', 'RELEASE-MANIFEST.json', 'SBOM.cdx.json', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_ja.md', 'package.json',
	`virune-${version}.tgz`, `virune-compiler-${version}.tgz`, `virune-formatter-${version}.tgz`, `virune-js-interop-${version}.tgz`, `virune-runtime-${version}.tgz`, `virune-stdlib-${version}.tgz`, `virune-vscode-${version}.vsix`,
];

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
});

test('parses strict checksum records and rejects duplicates', () => {
	const digest = 'a'.repeat(64);
	assert.equal(parseChecksums(`${digest}  example.tgz\n`).get('example.tgz'), digest);
	assert.throws(() => parseChecksums(`${digest} example.tgz\n`), /Invalid SHA256SUMS/u);
	assert.throws(() => parseChecksums(`${digest}  example.tgz\n${digest}  example.tgz\n`), /Duplicate checksum/u);
});

test('validates downloaded checksums, schema v2 manifest and CycloneDX 1.6 SBOM', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'virune-public-release-test-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const payloads = new Map([
		['artifact.tgz', Buffer.from('artifact')],
		['SBOM.cdx.json', Buffer.from(`${JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', serialNumber: 'urn:uuid:00000000-0000-5000-8000-000000000000', metadata: { component: { version } }, components: [] }, null, 2)}\n`)],
	]);
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
	const checksumEntries = [...records, { file: 'RELEASE-MANIFEST.json', sha256: createHash('sha256').update(manifestBytes).digest('hex'), bytes: manifestBytes.byteLength }];
	await writeFile(join(directory, 'SHA256SUMS'), `${checksumEntries.sort((left, right) => left.file.localeCompare(right.file)).map(item => `${item.sha256}  ${item.file}`).join('\n')}\n`);
	const result = await validateDownloadedRelease(directory, version);
	assert.equal(result.manifest.schemaVersion, 2);
	assert.equal(result.sbom.specVersion, '1.6');
	assert.equal(result.assets.length, 3);
});
