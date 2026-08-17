import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { readRegularReleaseAsset, verifyRegistryCliCandidateTarball } from './verify-npm-publication-identity.mjs';

test('release packaging disables lifecycle scripts and stamps both CLI package variants', () => {
	const source = readFileSync(resolve('scripts/package.mjs'), 'utf8');
	assert.match(source, /execNpmSync\(\['pack', '--ignore-scripts', directory, '--pack-destination', out\]/u);
	assert.match(source, /execNpmSync\(\['pack', '--ignore-scripts', registryCliStagingPackage, '--pack-destination', registryCliStagingRoot\]/u);
	assert.doesNotMatch(source, /execNpmSync\(\['pack', directory,/u);
	assert.match(source, /stampCliVersion\(registryCliStagingPackage\);/u);
	assert.match(source, /stampCliVersion\(stagingPackage\);/u);
});

test('publication identity binds validation and reads to one file descriptor', () => {
	const source = readFileSync(resolve('scripts/verify-npm-publication-identity.mjs'), 'utf8');
	assert.match(source, /const fd = openSync\(path, constants\.O_RDONLY \| portableNoFollowFlag\);/u);
	assert.match(source, /const opened = fstatSync\(fd, \{ bigint: true \}\);/u);
	assert.match(source, /const bytes = readFileSync\(fd\);/u);
	assert.match(source, /const current = lstatSync\(path, \{ bigint: true \}\);/u);
	assert.match(source, /current\.dev === opened\.dev && current\.ino === opened\.ino/u);
	assert.match(source, /finally \{\s*closeSync\(fd\);\s*\}/u);
});

test('descriptor fallback rejects symlink tarballs when O_NOFOLLOW is unavailable', () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-publication-fd-'));
	const target = resolve(root, 'target.tgz');
	const link = resolve(root, 'link.tgz');
	try {
		writeFileSync(target, 'reviewed-bytes\n');
		assert.equal(
			readRegularReleaseAsset(target, '$.releaseTarballs.target.tgz', { noFollowFlag: null }).toString('utf8'),
			'reviewed-bytes\n',
		);
		symlinkSync(target, link, 'file');
		assert.throws(
			() => readRegularReleaseAsset(link, '$.releaseTarballs.link.tgz', { noFollowFlag: null }),
			/release tarball must be a regular file/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('Registry CLI legal entries accept canonical regular typeflags, reject symlinks, and bind embedded version', () => {
	const legal = {
		expectedLicense: 'Apache-2.0',
		licenseBytes: Buffer.from('license\n'),
		noticeBytes: Buffer.from('notice\n'),
		requireEmbeddedCliVersion: true,
	};
	const manifest = {
		name: 'virune',
		version: '1.0.0',
		private: true,
		license: 'Apache-2.0',
		dependencies: { '@virune/runtime': '1.0.0' },
	};
	assert.doesNotThrow(() => verifyRegistryCliCandidateTarball(
		registryCliTarball(manifest, { packageTypeFlag: '\0', licenseTypeFlag: '\0', noticeTypeFlag: '\0' }),
		'1.0.0',
		undefined,
		legal,
	));
	assert.throws(() => verifyRegistryCliCandidateTarball(
		registryCliTarball(manifest, { noticeTypeFlag: '2' }),
		'1.0.0',
		undefined,
		legal,
	), /package\/NOTICE must be a regular file/u);
	assert.throws(() => verifyRegistryCliCandidateTarball(
		registryCliTarball(manifest, { embeddedVersion: '0.9.0' }),
		'1.0.0',
		undefined,
		legal,
	), /embedded VERSION 0\.9\.0 does not match 1\.0\.0/u);
	assert.throws(() => verifyRegistryCliCandidateTarball(
		registryCliTarball(manifest, { embeddedSource: 'export const main = 1;\n' }),
		'1.0.0',
		undefined,
		legal,
	), /expected exactly one embedded VERSION declaration; found 0/u);
	assert.throws(() => verifyRegistryCliCandidateTarball(
		registryCliTarball(manifest, { embeddedSource: 'const VERSION = "1.0.0";\nconst VERSION = "1.0.0";\n' }),
		'1.0.0',
		undefined,
		legal,
	), /expected exactly one embedded VERSION declaration; found 2/u);
});

function registryCliTarball(manifest, {
	packageTypeFlag = '0',
	licenseTypeFlag = '0',
	noticeTypeFlag = '0',
	embeddedVersion = manifest.version,
	embeddedSource,
} = {}) {
	const cliSource = embeddedSource ?? `const VERSION = ${JSON.stringify(embeddedVersion)};\n`;
	return gzipSync(buildTar([
		['package/package.json', `${JSON.stringify(manifest)}\n`, packageTypeFlag],
		['package/LICENSE', 'license\n', licenseTypeFlag],
		['package/NOTICE', 'notice\n', noticeTypeFlag],
		['package/dist/src/main.js', cliSource, '0'],
	]));
}

function buildTar(entries) {
	const chunks = [];
	for (const [name, value, typeFlag] of entries) {
		const content = Buffer.from(value);
		const header = Buffer.alloc(512);
		Buffer.from(name).copy(header, 0, 0, 100);
		header.write(`${content.byteLength.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
		header[156] = typeFlag === '\0' ? 0 : typeFlag.charCodeAt(0);
		chunks.push(header, content);
		const padding = (512 - content.byteLength % 512) % 512;
		if (padding > 0) chunks.push(Buffer.alloc(padding));
	}
	chunks.push(Buffer.alloc(1024));
	return Buffer.concat(chunks);
}
