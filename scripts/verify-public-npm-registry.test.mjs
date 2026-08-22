import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	validateReviewedPublicationManifest,
	verifyCleanGlobalCliInstall,
	verifyPublicNpmRegistry,
} from './verify-public-npm-registry.mjs';
import {
	bundledCliReleaseAssetName,
	registryReleaseAssetNameForPackage,
} from './verify-npm-publication-identity.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicationPlan = JSON.parse(readFileSync(resolve(repositoryRoot, '.github/release/npm-publication-v1.json'), 'utf8'));
const version = '1.1.0-rc.1';
const registry = 'https://registry.npmjs.org/';

function registryPackageUrl(name) {
	return `${registry}${encodeURIComponent(name)}`;
}

function registryVersionUrl(name) {
	return `${registryPackageUrl(name)}/${encodeURIComponent(version)}`;
}

function registryTarballUrl(name, releaseAsset) {
	return `${registry}${encodeURIComponent(name)}/-/${encodeURIComponent(releaseAsset)}`;
}

function responseJson(value) {
	return {
		ok: true,
		status: 200,
		async json() { return structuredClone(value); },
	};
}

function responseBytes(bytes) {
	return {
		ok: true,
		status: 200,
		async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
	};
}

function fixture() {
	const packageBytes = new Map();
	const metadata = new Map();
	const packuments = new Map();
	const tarballs = new Map();
	const failedTarballs = new Set();
	const malformedJson = new Set();
	const packages = publicationPlan.packages.map(item => {
		const registryName = item.registryName;
		const releaseAsset = registryReleaseAssetNameForPackage(registryName, version);
		const bytes = Buffer.from(`registry fixture:${registryName}:${version}\n`, 'utf8');
		const tarball = registryTarballUrl(registryName, releaseAsset);
		const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
		const shasum = createHash('sha1').update(bytes).digest('hex');
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		packageBytes.set(registryName, bytes);
		tarballs.set(registryName, tarball);
		metadata.set(registryName, { name: registryName, version, dist: { tarball, integrity, shasum } });
		packuments.set(registryName, { name: registryName, 'dist-tags': { next: version } });
		return { registryName, releaseAsset, sha256, bytes: bytes.byteLength };
	});
	const publicationManifest = {
		schemaVersion: 1,
		version,
		githubReleaseTag: `v${version}`,
		publishSource: 'reviewed-release-registry-candidate-tarball',
		bundledCliReleaseAsset: bundledCliReleaseAssetName(version),
		publicationReady: true,
		registryVersionEligible: true,
		distTag: 'next',
		packages,
	};
	const fetchImpl = async url => {
		for (const pkg of packages) {
			const name = pkg.registryName;
			if (url === registryVersionUrl(name)) {
				if (malformedJson.has(`version:${name}`)) return { ok: true, status: 200, async json() { throw new SyntaxError('bad json'); } };
				const value = metadata.get(name);
				return value === undefined ? { ok: false, status: 404 } : responseJson(value);
			}
			if (url === registryPackageUrl(name)) {
				if (malformedJson.has(`package:${name}`)) return { ok: true, status: 200, async json() { throw new SyntaxError('bad json'); } };
				const value = packuments.get(name);
				return value === undefined ? { ok: false, status: 404 } : responseJson(value);
			}
			if (url === tarballs.get(name)) {
				if (failedTarballs.has(name)) return { ok: false, status: 503 };
				return responseBytes(packageBytes.get(name));
			}
		}
		return { ok: false, status: 404 };
	};
	return { publicationManifest, metadata, packuments, packageBytes, failedTarballs, malformedJson, fetchImpl };
}

function successfulRunCommand(expectedVersion = version) {
	return (command, args, options = {}) => {
		if (command === 'npm') {
			assert(args.includes(`virune@${version}`));
			assert(args.includes(`--registry=${registry}`));
			const prefixArgument = args.find(argument => argument.startsWith('--prefix='));
			assert(prefixArgument !== undefined);
			const prefix = prefixArgument.slice('--prefix='.length);
			mkdirSync(resolve(prefix, 'bin'), { recursive: true });
			writeFileSync(resolve(prefix, 'bin/virune'), '#!/bin/sh\n');
			return { status: 0, stdout: '', stderr: '' };
		}
		if (args.length === 1 && args[0] === '--version') return { status: 0, stdout: `virune ${expectedVersion}\n`, stderr: '' };
		throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
	};
}

test('verifies exact reviewed package bytes, tags and clean global CLI installation', async () => {
	const current = fixture();
	const report = await verifyPublicNpmRegistry({
		publicationManifest: current.publicationManifest,
		publicationPlan,
		outputPath: null,
		fetchImpl: current.fetchImpl,
		runCommand: successfulRunCommand(),
		platform: 'linux',
	});
	assert.equal(report.version, version);
	assert.equal(report.distTag, 'next');
	assert.equal(report.packages.length, publicationPlan.packages.length);
	assert.deepEqual(report.packages.map(item => item.registryName), [...report.packages.map(item => item.registryName)].sort());
	assert.equal(report.installation.package, `virune@${version}`);
	assert.equal(report.installation.versionOutput, `virune ${version}`);
});

test('publication manifest validation is exact, unique and fail-closed', () => {
	const good = fixture().publicationManifest;
	assert.equal(validateReviewedPublicationManifest(good, publicationPlan).packages.length, publicationPlan.packages.length);

	const notReady = structuredClone(good);
	notReady.publicationReady = false;
	assert.throws(() => validateReviewedPublicationManifest(notReady, publicationPlan), /publication-ready/u);

	const missing = structuredClone(good);
	missing.packages.pop();
	assert.throws(() => validateReviewedPublicationManifest(missing, publicationPlan), /expected exact Registry package set/u);

	const duplicate = structuredClone(good);
	duplicate.packages.push(structuredClone(duplicate.packages[0]));
	assert.throws(() => validateReviewedPublicationManifest(duplicate, publicationPlan), /duplicate registryName/u);

	const unknown = structuredClone(good);
	unknown.packages[0].registryName = '@virune/unknown';
	unknown.packages[0].releaseAsset = registryReleaseAssetNameForPackage('@virune/unknown', version);
	assert.throws(() => validateReviewedPublicationManifest(unknown, publicationPlan), /expected exact Registry package set/u);

	const staleTag = structuredClone(good);
	staleTag.distTag = 'latest';
	assert.throws(() => validateReviewedPublicationManifest(staleTag, publicationPlan), /expected next/u);

	const unknownField = structuredClone(good);
	unknownField.unreviewed = true;
	assert.throws(() => validateReviewedPublicationManifest(unknownField, publicationPlan), /expected exact keys/u);
});

test('Registry observations reject missing, malformed, partial and stale metadata', async () => {
	const first = publicationPlan.packages[0].registryName;
	for (const mutate of [
		current => current.metadata.delete(first),
		current => current.malformedJson.add(`version:${first}`),
		current => { current.metadata.get(first).version = '1.1.0-rc.2'; },
		current => { current.metadata.get(first).dist.integrity = 'sha256-invalid'; },
		current => { current.metadata.get(first).dist.shasum = '0'.repeat(40); },
		current => { delete current.packuments.get(first)['dist-tags']; },
		current => { current.packuments.get(first)['dist-tags'].next = '1.1.0-rc.2'; },
		current => current.failedTarballs.add(first),
	]) {
		const current = fixture();
		mutate(current);
		await assert.rejects(() => verifyPublicNpmRegistry({
			publicationManifest: current.publicationManifest,
			publicationPlan,
			outputPath: null,
			fetchImpl: current.fetchImpl,
			runCommand: successfulRunCommand(),
			platform: 'linux',
		}));
	}
});

test('Registry tarball integrity, shasum, SHA-256 and byte-size drift fail closed', async () => {
	const first = publicationPlan.packages[0].registryName;
	for (const mutate of [
		current => { current.metadata.get(first).dist.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`; },
		current => { current.metadata.get(first).dist.shasum = 'f'.repeat(40); },
		current => { current.publicationManifest.packages.find(item => item.registryName === first).sha256 = '0'.repeat(64); },
		current => { current.publicationManifest.packages.find(item => item.registryName === first).bytes += 1; },
		current => current.packageBytes.set(first, Buffer.from('changed Registry bytes\n')),
	]) {
		const current = fixture();
		mutate(current);
		await assert.rejects(() => verifyPublicNpmRegistry({
			publicationManifest: current.publicationManifest,
			publicationPlan,
			outputPath: null,
			fetchImpl: current.fetchImpl,
			runCommand: successfulRunCommand(),
			platform: 'linux',
		}));
	}
});

test('clean global install rejects command failure and CLI version mismatch', async () => {
	await assert.rejects(
		() => verifyCleanGlobalCliInstall(version, { runCommand: () => { throw new Error('install failed'); }, platform: 'linux' }),
		/install failed/u,
	);
	await assert.rejects(
		() => verifyCleanGlobalCliInstall(version, { runCommand: successfulRunCommand('1.1.0-rc.2'), platform: 'linux' }),
		/expected virune 1\.1\.0-rc\.1/u,
	);
});
