import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { readRegularReleaseAsset, verifyRegistryCandidateTarball, verifyRegistryCliCandidateTarball } from './verify-npm-publication-identity.mjs';

const registryPackages = [
	'virune',
	'@virune/compiler',
	'@virune/formatter',
	'@virune/js-interop',
	'@virune/runtime',
	'@virune/stdlib',
];
const registryDirectories = ['cli', 'compiler', 'formatter', 'js-interop', 'runtime', 'stdlib'];

test('release packaging stages every Registry candidate as publishable while keeping bundled CLI private', () => {
	const source = readFileSync(resolve('scripts/package.mjs'), 'utf8');
	assert.match(source, /const registryPackages = \[\.\.\.internalPackages, registryCliPackage\];/u);
	assert.match(source, /if \(stagingManifest\.private !== true\) throw new Error\(`Registry source workspace \$\{item\.name\} must remain private:true\.`\);/u);
	assert.match(source, /delete stagingManifest\.private;/u);
	assert.match(source, /for \(const item of registryPackages\) stageRegistryPackage\(item\);/u);
	assert.match(source, /execNpmSync\(\['pack', '--ignore-scripts', stagingPackage, '--pack-destination', stagingRoot\]/u);
	assert.match(source, /if \(item\.name === 'virune'\) stampCliVersion\(stagingPackage\);/u);
	assert.match(source, /stagingManifest\.private = true;/u);
	assert.match(source, /stagingManifest\.bundledDependencies = Object\.keys\(stagingManifest\.dependencies \?\? \{\}\)\.sort\(\);/u);
	assert.doesNotMatch(source, /execNpmSync\(\['pack', directory,/u);
});

test('release smoke derives Registry candidates from canonical publication policy and keeps the bundled CLI private', () => {
	const source = readFileSync(resolve('scripts/smoke-release.mjs'), 'utf8');
	assert.match(source, /const publicationPlan = verifyNpmPublicationPlan\(\);/u);
	assert.match(source, /\.map\(item => registryReleaseAssetNameForPackage\(item\.registryName, version\)\)/u);
	assert.match(source, /if \('private' in packageManifest\) throw new Error\(`\$\{file\} must omit private so the reviewed Registry candidate is publishable\.`\);/u);
	assert.match(source, /if \(packageManifest\.private !== true\) throw new Error\(`\$\{file\} must remain private because it is the bundled direct-install CLI artifact\.`\);/u);
});

test('all planned source workspaces remain private and publishConfig-free', () => {
	for (const directory of registryDirectories) {
		const manifest = JSON.parse(readFileSync(resolve('packages', directory, 'package.json'), 'utf8'));
		assert.equal(manifest.private, true, `${directory} must remain private:true in source`);
		assert.equal(manifest.publishConfig, undefined, `${directory} must not define publishConfig in source`);
	}
});

test('all six Registry candidate manifests are publishable and reject private or stale internal metadata', () => {
	const legal = {
		expectedLicense: 'Apache-2.0',
		licenseBytes: Buffer.from('license\n'),
		noticeBytes: Buffer.from('notice\n'),
	};
	for (const name of registryPackages) {
		const manifest = {
			name,
			version: '1.0.0',
			license: 'Apache-2.0',
			homepage: 'https://example.test/readme',
			dependencies: name === 'virune' ? { '@virune/runtime': '1.0.0' } : {},
		};
		assert.doesNotThrow(() => verifyRegistryCandidateTarball(
			registryTarball(manifest),
			'1.0.0',
			name,
			undefined,
			{ ...legal, expectedManifest: { ...manifest, private: true } },
		));
		assert.throws(() => verifyRegistryCandidateTarball(
			registryTarball({ ...manifest, private: true }),
			'1.0.0',
			name,
			undefined,
			legal,
		), /must omit private/u);
		const { homepage: _homepage, ...metadataDrift } = manifest;
		assert.throws(() => verifyRegistryCandidateTarball(
			registryTarball(metadataDrift),
			'1.0.0',
			name,
			undefined,
			{ ...legal, expectedManifest: { ...manifest, private: true } },
		), /must match the reviewed source manifest with only private removed/u);
	}
	assert.throws(() => verifyRegistryCandidateTarball(
		registryTarball({ name: '@virune/runtime', version: '1.0.0', license: 'Apache-2.0', publishConfig: { access: 'public' } }),
		'1.0.0',
		'@virune/runtime',
		undefined,
		legal,
	), /publishConfig must not be present/u);
	assert.throws(() => verifyRegistryCandidateTarball(
		registryTarball({ name: '@virune/runtime', version: '1.0.0', license: 'Apache-2.0', bundledDependencies: ['@virune/stdlib'] }),
		'1.0.0',
		'@virune/runtime',
		undefined,
		legal,
	), /must not declare bundled dependencies/u);
	assert.throws(() => verifyRegistryCandidateTarball(
		registryTarball({ name: '@virune/runtime', version: '1.0.0', license: 'Apache-2.0', peerDependencies: { '@virune/stdlib': '0.9.0' } }),
		'1.0.0',
		'@virune/runtime',
		undefined,
		legal,
	), /expected exact release version 1\.0\.0/u);
	assert.throws(() => verifyRegistryCandidateTarball(
		registryTarball({ name: '@virune/runtime', version: '1.0.0', license: 'Apache-2.0', optionalDependencies: [] }),
		'1.0.0',
		'@virune/runtime',
		undefined,
		legal,
	), /optionalDependencies: expected an object/u);
	assert.throws(() => verifyRegistryCandidateTarball(
		gzipSync(buildTar([['package/LICENSE', 'license\n', '0'], ['package/NOTICE', 'notice\n', '0']])),
		'1.0.0',
		'@virune/runtime',
		undefined,
		legal,
	), /package\/package\.json must be a regular file/u);
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

function registryTarball(manifest) {
	return gzipSync(buildTar([
		['package/package.json', `${JSON.stringify(manifest)}\n`, '0'],
		['package/LICENSE', 'license\n', '0'],
		['package/NOTICE', 'notice\n', '0'],
	]));
}

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
		header.fill(0x20, 148, 156);
		const checksum = header.reduce((total, byte) => total + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
		chunks.push(header, content);
		const padding = (512 - content.byteLength % 512) % 512;
		if (padding > 0) chunks.push(Buffer.alloc(padding));
	}
	chunks.push(Buffer.alloc(1024));
	return Buffer.concat(chunks);
}