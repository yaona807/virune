import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { verifyReleaseLicenseArtifacts } from './verify-release-license-artifacts.mjs';

const version = '1.0.0';
const expectedLicense = 'Apache-2.0';
const workspaceDirectories = ['compiler', 'runtime'];
const tarballs = [
	`virune-runtime-${version}.tgz`,
	`virune-compiler-${version}.tgz`,
	`virune-formatter-${version}.tgz`,
	`virune-js-interop-${version}.tgz`,
	`virune-stdlib-${version}.tgz`,
	`virune-${version}.tgz`,
];

test('accepts release artifacts whose license metadata and legal files match the repository', () => {
	withFixture(root => {
		assert.deepEqual(verifyReleaseLicenseArtifacts(root), { license: expectedLicense, packageCount: 6 });
	});
});

test('rejects stale release package license metadata', () => {
	withFixture(root => {
		writeJson(resolve(root, 'release/package.json'), { name: 'virune-local-release', version, license: 'MIT' });
		assert.throws(() => verifyReleaseLicenseArtifacts(root), /release\/package\.json license "MIT" does not match Apache-2\.0/u);
	});
});

test('rejects a tarball whose package manifest has a stale license', () => {
	withFixture(root => {
		writeViruneTarball(root, tarballs[0], { license: 'MIT' });
		assert.throws(() => verifyReleaseLicenseArtifacts(root), /package license "MIT" does not match Apache-2\.0/u);
	});
});

test('rejects a tarball that drops the Virune NOTICE file', () => {
	withFixture(root => {
		writeViruneTarball(root, tarballs[0], { includeNotice: false });
		assert.throws(() => verifyReleaseLicenseArtifacts(root), /is missing package\/NOTICE/u);
	});
});

test('rejects release legal files that differ from the repository canonical files', () => {
	withFixture(root => {
		writeFileSync(resolve(root, 'release/NOTICE'), 'stale notice\n');
		assert.throws(() => verifyReleaseLicenseArtifacts(root), /release\/NOTICE does not match the canonical repository file/u);
	});
});

test('rejects modified release third-party notices', () => {
	withFixture(root => {
		writeFileSync(resolve(root, 'release/THIRD_PARTY_NOTICES.md'), 'stale third-party notice\n');
		assert.throws(
			() => verifyReleaseLicenseArtifacts(root),
			/release\/THIRD_PARTY_NOTICES\.md does not match the canonical repository file/u,
		);
	});
});

test('rejects a release that drops the Japanese third-party notices', () => {
	withFixture(root => {
		unlinkSync(resolve(root, 'release/THIRD_PARTY_NOTICES_ja.md'));
		assert.throws(
			() => verifyReleaseLicenseArtifacts(root),
			/THIRD_PARTY_NOTICES_ja\.md/u,
		);
	});
});

test('rejects a stale SBOM root license', () => {
	withFixture(root => {
		const sbom = readJson(resolve(root, 'release/SBOM.cdx.json'));
		sbom.metadata.component.licenses[0].license.id = 'MIT';
		writeJson(resolve(root, 'release/SBOM.cdx.json'), sbom);
		assert.throws(() => verifyReleaseLicenseArtifacts(root), /SBOM root component license must be exactly Apache-2\.0/u);
	});
});

test('rejects a stale Virune workspace license in the SBOM', () => {
	withFixture(root => {
		const sbom = readJson(resolve(root, 'release/SBOM.cdx.json'));
		const runtime = sbom.components.find(component => component.properties.some(property => property.value === 'packages/runtime'));
		runtime.licenses[0].license.id = 'MIT';
		writeJson(resolve(root, 'release/SBOM.cdx.json'), sbom);
		assert.throws(() => verifyReleaseLicenseArtifacts(root), /SBOM packages\/runtime component license must be exactly Apache-2\.0/u);
	});
});

test('rejects a missing Virune workspace component in the SBOM', () => {
	withFixture(root => {
		const sbom = readJson(resolve(root, 'release/SBOM.cdx.json'));
		sbom.components = sbom.components.filter(component => !component.properties.some(property => property.value === 'packages/runtime'));
		writeJson(resolve(root, 'release/SBOM.cdx.json'), sbom);
		assert.throws(() => verifyReleaseLicenseArtifacts(root), /SBOM workspace component set must exactly match repository workspaces/u);
	});
});

test('rejects a stale removed Virune workspace component in the SBOM', () => {
	withFixture(root => {
		const sbom = readJson(resolve(root, 'release/SBOM.cdx.json'));
		sbom.components.push({
			name: '@virune/removed-workspace',
			version,
			licenses: [{ license: { id: expectedLicense } }],
			properties: [{ name: 'virune:package-lock:path', value: 'packages/removed-workspace' }],
		});
		writeJson(resolve(root, 'release/SBOM.cdx.json'), sbom);
		assert.throws(() => verifyReleaseLicenseArtifacts(root), /SBOM workspace component set must exactly match repository workspaces/u);
	});
});

function withFixture(run) {
	const root = mkdtempSync(join(tmpdir(), 'virune-release-license-'));
	try {
		mkdirSync(resolve(root, 'release'), { recursive: true });
		writeJson(resolve(root, 'package.json'), { name: 'virune-monorepo', version, license: expectedLicense });
		writeFileSync(resolve(root, 'LICENSE'), 'canonical Apache license text\n');
		writeFileSync(resolve(root, 'NOTICE'), 'Virune\nCopyright 2026 Yaona and the Virune project authors\n');
		writeFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), '# Third-Party Notices\n\nExample notice\n');
		writeFileSync(resolve(root, 'THIRD_PARTY_NOTICES_ja.md'), '# 第三者ライセンス\n\nExample notice ja\n');
		for (const directory of workspaceDirectories) {
			mkdirSync(resolve(root, 'packages', directory), { recursive: true });
			writeJson(resolve(root, 'packages', directory, 'package.json'), {
				name: `@virune/${directory}`,
				version,
				license: expectedLicense,
			});
		}
		writeJson(resolve(root, 'release/package.json'), { name: 'virune-local-release', version, license: expectedLicense });
		for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_ja.md']) {
			writeFileSync(resolve(root, 'release', file), readFileSync(resolve(root, file)));
		}
		writeJson(resolve(root, 'release/SBOM.cdx.json'), {
			metadata: { component: { licenses: [{ license: { id: expectedLicense } }] } },
			components: workspaceDirectories.map(directory => ({
				name: `@virune/${directory}`,
				version,
				licenses: [{ license: { id: expectedLicense } }],
				properties: [{ name: 'virune:package-lock:path', value: `packages/${directory}` }],
			})),
		});
		for (const file of tarballs) writeViruneTarball(root, file);
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function writeViruneTarball(root, file, { license = expectedLicense, includeNotice = true } = {}) {
	const entries = [
		['package/package.json', `${JSON.stringify({ name: file, version, license })}\n`],
		['package/LICENSE', readFileSync(resolve(root, 'LICENSE'))],
	];
	if (includeNotice) entries.push(['package/NOTICE', readFileSync(resolve(root, 'NOTICE'))]);
	writeFileSync(resolve(root, 'release', file), gzipSync(buildTar(entries)));
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

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
