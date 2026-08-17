import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { verifyNpmReleaseCandidateContents } from './verify-npm-release-candidate-contents.mjs';

const version = '1.1.0';
const baseManifest = {
	name: '@virune/runtime',
	version,
	files: ['dist', 'LICENSE', 'NOTICE'],
	exports: { '.': './dist/index.js' },
};

function canonicalCandidate(manifest = baseManifest, extraEntries = []) {
	return buildTarGzip([
		['package/package.json', `${JSON.stringify(manifest)}\n`],
		['package/LICENSE', 'license\n'],
		['package/NOTICE', 'notice\n'],
		['package/dist/index.js', 'export const value = 1;\n'],
		['package/dist/index.d.ts', 'export declare const value: number;\n'],
		...extraEntries,
	]);
}

function identityFor(packages) {
	return {
		version,
		publishSource: 'reviewed-release-registry-candidate-tarball',
		packages: packages.map(({ registryName, releaseAsset, bytes }) => ({
			registryName,
			releaseAsset,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			bytes: bytes.byteLength,
		})),
	};
}

function verifyFixture(packages, options = {}) {
	const identity = identityFor(packages);
	const byAsset = new Map(packages.map(item => [item.releaseAsset, item.bytes]));
	let identityVerified = false;
	return verifyNpmReleaseCandidateContents({
		root: '/fixture',
		releaseDirectory: '/fixture/release',
		verifyIdentity: () => {
			identityVerified = true;
			return options.identity ?? identity;
		},
		readAsset: (_path, logicalPath) => {
			assert.equal(identityVerified, true, `asset read before publication identity verification: ${logicalPath}`);
			const asset = logicalPath.slice('$.registryCandidate.'.length);
			return options.readBytes?.(asset) ?? byAsset.get(asset);
		},
	});
}

test('audits every exact reviewed candidate deterministically after publication identity verification', () => {
	const runtimeBytes = canonicalCandidate();
	const stdlibManifest = { ...baseManifest, name: '@virune/stdlib' };
	const stdlibBytes = canonicalCandidate(stdlibManifest);
	const packages = [
		{ registryName: '@virune/stdlib', releaseAsset: 'virune-stdlib-1.1.0.tgz', bytes: stdlibBytes },
		{ registryName: '@virune/runtime', releaseAsset: 'virune-runtime-1.1.0.tgz', bytes: runtimeBytes },
	];
	const result = verifyFixture(packages);
	assert.equal(result.schemaVersion, 1);
	assert.equal(result.stage, 'exact-reviewed-registry-candidate-contents-audit');
	assert.equal(result.version, version);
	assert.equal(result.packageCount, 2);
	assert.deepEqual(result.packages.map(item => item.registryName), ['@virune/runtime', '@virune/stdlib']);
	for (const item of result.packages) {
		assert.match(item.sha256, /^[0-9a-f]{64}$/u);
		assert.match(item.fileSetSha256, /^[0-9a-f]{64}$/u);
		assert.equal(item.fileCount, 5);
		assert(item.unpackedBytes > 0);
	}
	assert.equal(result.packages[0].fileSetSha256, result.packages[1].fileSetSha256);
});

test('candidate byte drift fails before contents can be accepted as reviewed evidence', () => {
	const reviewed = canonicalCandidate();
	const mutated = canonicalCandidate(baseManifest, [['package/dist/.env', 'SECRET=1\n']]);
	assert.throws(
		() => verifyFixture(
			[{ registryName: '@virune/runtime', releaseAsset: 'virune-runtime-1.1.0.tgz', bytes: reviewed }],
			{ readBytes: () => mutated },
		),
		/exact candidate bytes do not match reviewed publication identity/u,
	);
});

test('exact candidate rejects out-of-allowlist, development, credential-like, nested dependency, and raw-source entries', () => {
	for (const [entryPath, expected] of [
		['package/src/index.js', /unexpected file outside package\.json files allowlist/u],
		['package/dist/.env', /high-risk development or credential file is forbidden/u],
		['package/dist/.env.production', /high-risk development or credential file is forbidden/u],
		['package/dist/helper.test.js', /test artifact is forbidden/u],
		['package/dist/node_modules/dependency.js', /development-only path is forbidden/u],
		['package/dist/source.ts', /raw TypeScript source is forbidden/u],
		['package/dist/private.pem', /credential-like file is forbidden/u],
	]) {
		const bytes = canonicalCandidate(baseManifest, [[entryPath, 'bad\n']]);
		assert.throws(
			() => verifyFixture([{ registryName: '@virune/runtime', releaseAsset: 'virune-runtime-1.1.0.tgz', bytes }]),
			expected,
		);
	}
});

test('exact candidate requires exports and bin targets to exist in the audited tarball', () => {
	const missingExportManifest = { ...baseManifest, exports: { '.': './dist/missing.js' } };
	const missingExport = canonicalCandidate(missingExportManifest);
	assert.throws(
		() => verifyFixture([{ registryName: '@virune/runtime', releaseAsset: 'virune-runtime-1.1.0.tgz', bytes: missingExport }]),
		/target is missing from npm pack contents: \.\/dist\/missing\.js/u,
	);

	const cliManifest = {
		name: 'virune',
		version,
		files: ['dist', 'LICENSE', 'NOTICE'],
		exports: { '.': './dist/index.js' },
		bin: { virune: './dist/missing-cli.js' },
	};
	const missingBin = canonicalCandidate(cliManifest);
	assert.throws(
		() => verifyFixture([{ registryName: 'virune', releaseAsset: 'virune-npm-1.1.0.tgz', bytes: missingBin }]),
		/target is missing from npm pack contents: \.\/dist\/missing-cli\.js/u,
	);
});

test('exact candidate rejects malformed, duplicate, non-canonical, outside-prefix, and non-regular tar entries', () => {
	const badCases = [
		{
			bytes: Buffer.from('not-gzip'),
			expected: /invalid gzip tarball/u,
		},
		{
			bytes: canonicalCandidate(baseManifest, [['outside.txt', 'bad\n']]),
			expected: /tar entry must be under package\//u,
		},
		{
			bytes: canonicalCandidate(baseManifest, [['package/dist/..\/secret.js', 'bad\n']]),
			expected: /package path must already be normalized/u,
		},
		{
			bytes: buildTarGzip([
				['package/package.json', `${JSON.stringify(baseManifest)}\n`],
				['package/LICENSE', 'license\n'],
				['package/NOTICE', 'notice\n'],
				['package/dist/index.js', 'one\n'],
				['package/dist/index.js', 'two\n'],
			]),
			expected: /duplicate tar entry package\/dist\/index\.js/u,
		},
		{
			bytes: buildTarGzip([
				['package/package.json', `${JSON.stringify(baseManifest)}\n`],
				['package/LICENSE', 'license\n'],
				['package/NOTICE', 'notice\n'],
				['package/dist/index.js', 'target\n', '2'],
				['package/dist/index.d.ts', 'export declare const value: number;\n'],
			]),
			expected: /non-regular tar entry is forbidden/u,
		},
	];
	for (const { bytes, expected } of badCases) {
		assert.throws(
			() => verifyFixture([{ registryName: '@virune/runtime', releaseAsset: 'virune-runtime-1.1.0.tgz', bytes }]),
			expected,
		);
	}
});

test('release paths require exact candidate contents after candidate generation and identity binding', () => {
	const policy = JSON.parse(readFileSync('.github/stable-release-gate.json', 'utf8'));
	const releaseIndex = policy.checks.findIndex(item => item.id === 'release-artifacts');
	const identityIndex = policy.checks.findIndex(item => item.id === 'npm-publication-identity');
	const contentsIndex = policy.checks.findIndex(item => item.id === 'npm-exact-candidate-contents');
	assert(releaseIndex >= 0 && identityIndex > releaseIndex && contentsIndex > identityIndex);
	assert.deepEqual(policy.checks[contentsIndex].command, ['node', 'scripts/verify-npm-release-candidate-contents.mjs']);
	assert.deepEqual(policy.requirements.find(item => item.id === 'npm-exact-candidate-contents'), {
		id: 'npm-exact-candidate-contents',
		evidence: ['npm-exact-candidate-contents'],
	});

	const rootManifest = JSON.parse(readFileSync('package.json', 'utf8'));
	assert.equal(
		rootManifest.scripts['verify:release'],
		'npm run pack:virune && node scripts/verify-npm-release-candidate-contents.mjs && npm run pack:vscode && npm run smoke:release',
	);
});

function buildTarGzip(entries) {
	const chunks = [];
	for (const [name, value, typeFlag = '0'] of entries) {
		const content = Buffer.isBuffer(value) ? value : Buffer.from(value);
		const header = Buffer.alloc(512);
		Buffer.from(name).copy(header, 0, 0, 100);
		header.write(`${content.byteLength.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
		header[156] = typeFlag.charCodeAt(0);
		chunks.push(header, content);
		const padding = (512 - content.byteLength % 512) % 512;
		if (padding > 0) chunks.push(Buffer.alloc(padding));
	}
	chunks.push(Buffer.alloc(1024));
	return gzipSync(Buffer.concat(chunks));
}
