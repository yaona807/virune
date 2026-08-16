import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { verifyRegistryCliCandidateTarball } from './verify-npm-publication-identity.mjs';

test('release packaging disables lifecycle scripts and stamps both CLI package variants', () => {
	const source = readFileSync(resolve('scripts/package.mjs'), 'utf8');
	assert.match(source, /execNpmSync\(\['pack', '--ignore-scripts', directory, '--pack-destination', out\]/u);
	assert.match(source, /execNpmSync\(\['pack', '--ignore-scripts', registryCliStagingPackage, '--pack-destination', registryCliStagingRoot\]/u);
	assert.doesNotMatch(source, /execNpmSync\(\['pack', directory,/u);
	assert.match(source, /stampCliVersion\(registryCliStagingPackage\);/u);
	assert.match(source, /stampCliVersion\(stagingPackage\);/u);
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
});

function registryCliTarball(manifest, {
	packageTypeFlag = '0',
	licenseTypeFlag = '0',
	noticeTypeFlag = '0',
	embeddedVersion = manifest.version,
} = {}) {
	return gzipSync(buildTar([
		['package/package.json', `${JSON.stringify(manifest)}\n`, packageTypeFlag],
		['package/LICENSE', 'license\n', licenseTypeFlag],
		['package/NOTICE', 'notice\n', noticeTypeFlag],
		['package/dist/src/main.js', `const VERSION = ${JSON.stringify(embeddedVersion)};\n`, '0'],
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
