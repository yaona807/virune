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
const canonicalPublicationPlan = JSON.parse(readFileSync(resolve(repositoryRoot, '.github/release/npm-publication-v1.json'), 'utf8'));
const version = '1.1.0-rc.1';
const registry = 'https://registry.npmjs.org/';

function readyPublicationPlan() {
	const plan = structuredClone(canonicalPublicationPlan);
	plan.publicationReady = true;
	plan.unresolvedRequirements = [];
	return plan;
}

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
	const publicationPlan = readyPublicationPlan();
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
	return { publicationPlan, publicationManifest, metadata, packuments, packageBytes, tarballs, failedTarballs, malformedJson, fetchImpl };
}

function successfulRunCommand(expectedVersion = version, { inspectInstall } = {}) {
	return (command, args, options = {}) => {
		if (command === 'npm') {
			assert(args.includes(`virune@${version}`));
			assert(args.includes(`--registry=${registry}`));
			inspectInstall?.(args, options);
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
		publicationPlan: current.publicationPlan,
		outputPath: null,
		fetchImpl: current.fetchImpl,
		runCommand: successfulRunCommand(),
		platform: 'linux',
	});
	assert.equal(report.version, version);
	assert.equal(report.distTag, 'next');
	assert.equal(report.packages.length, current.publicationPlan.packages.length);
	assert.deepEqual(report.packages.map(item => item.registryName), [...report.packages.map(item => item.registryName)].sort());
	assert.equal(report.installation.package, `virune@${version}`);
	assert.equal(report.installation.versionOutput, `virune ${version}`);
});

test('publication manifest and publication plan readiness are exact and fail closed', () => {
	const current = fixture();
	const good = current.publicationManifest;
	assert.equal(validateReviewedPublicationManifest(good, current.publicationPlan).packages.length, current.publicationPlan.packages.length);

	const sourceNotReady = structuredClone(current.publicationPlan);
	sourceNotReady.publicationReady = false;
	assert.throws(() => validateReviewedPublicationManifest(good, sourceNotReady), /publication-ready release source/u);

	const unresolvedSource = structuredClone(current.publicationPlan);
	unresolvedSource.unresolvedRequirements = ['trusted-publishing'];
	assert.throws(() => validateReviewedPublicationManifest(good, unresolvedSource), /zero unresolved npm publication requirements/u);

	const notReady = structuredClone(good);
	notReady.publicationReady = false;
	assert.throws(() => validateReviewedPublicationManifest(notReady, current.publicationPlan), /publication-ready candidate/u);

	const missing = structuredClone(good);
	missing.packages.pop();
	assert.throws(() => validateReviewedPublicationManifest(missing, current.publicationPlan), /expected exact Registry package set/u);

	const duplicate = structuredClone(good);
	duplicate.packages.push(structuredClone(duplicate.packages[0]));
	assert.throws(() => validateReviewedPublicationManifest(duplicate, current.publicationPlan), /duplicate registryName/u);

	const unknown = structuredClone(good);
	unknown.packages[0].registryName = '@virune/unknown';
	unknown.packages[0].releaseAsset = registryReleaseAssetNameForPackage('@virune/unknown', version);
	assert.throws(() => validateReviewedPublicationManifest(unknown, current.publicationPlan), /expected exact Registry package set/u);

	const staleTag = structuredClone(good);
	staleTag.distTag = 'latest';
	assert.throws(() => validateReviewedPublicationManifest(staleTag, current.publicationPlan), /expected next/u);

	const unknownField = structuredClone(good);
	unknownField.unreviewed = true;
	assert.throws(() => validateReviewedPublicationManifest(unknownField, current.publicationPlan), /expected exact keys/u);
});

test('Registry observations reject missing, malformed, partial and stale metadata', async () => {
	const first = canonicalPublicationPlan.packages[0].registryName;
	for (const mutate of [
		current => current.metadata.delete(first),
		current => current.packuments.delete(first),
		current => current.malformedJson.add(`version:${first}`),
		current => current.malformedJson.add(`package:${first}`),
		current => { current.metadata.get(first).name = '@virune/wrong'; },
		current => { current.metadata.get(first).version = '1.1.0-rc.2'; },
		current => { delete current.metadata.get(first).dist; },
		current => { current.metadata.get(first).dist.tarball = 'https://example.invalid/package.tgz'; },
		current => { current.metadata.get(first).dist.integrity = 'sha256-invalid'; },
		current => { current.metadata.get(first).dist.shasum = '0'.repeat(40); },
		current => { current.packuments.get(first).name = '@virune/wrong'; },
		current => { delete current.packuments.get(first)['dist-tags']; },
		current => { current.packuments.get(first)['dist-tags'].next = '1.1.0-rc.2'; },
		current => current.failedTarballs.add(first),
	]) {
		const current = fixture();
		mutate(current);
		await assert.rejects(() => verifyPublicNpmRegistry({
			publicationManifest: current.publicationManifest,
			publicationPlan: current.publicationPlan,
			outputPath: null,
			fetchImpl: current.fetchImpl,
			runCommand: successfulRunCommand(),
			platform: 'linux',
		}));
	}
});

test('Registry tarball integrity, shasum, SHA-256 and byte-size drift fail closed', async () => {
	const first = canonicalPublicationPlan.packages[0].registryName;
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
			publicationPlan: current.publicationPlan,
			outputPath: null,
			fetchImpl: current.fetchImpl,
			runCommand: successfulRunCommand(),
			platform: 'linux',
		}));
	}
});

test('clean global install uses isolated npm state and strips ambient credentials', async () => {
	await verifyCleanGlobalCliInstall(version, {
		platform: 'linux',
		baseEnv: {
			PATH: '/usr/bin',
			NODE_AUTH_TOKEN: 'node-secret',
			NPM_TOKEN: 'npm-secret',
			GH_TOKEN: 'gh-secret',
			GITHUB_TOKEN: 'github-secret',
			NPM_CONFIG_REGISTRY: 'https://evil.invalid/',
		},
		runCommand: successfulRunCommand(version, {
			inspectInstall: (_args, options) => {
				assert.equal(options.env.NODE_AUTH_TOKEN, undefined);
				assert.equal(options.env.NPM_TOKEN, undefined);
				assert.equal(options.env.GH_TOKEN, undefined);
				assert.equal(options.env.GITHUB_TOKEN, undefined);
				assert.equal(options.env.NPM_CONFIG_REGISTRY, registry);
				assert.equal(options.env.NPM_CONFIG_REPLACE_REGISTRY_HOST, 'never');
				assert.equal(options.env.NPM_CONFIG_CACHE, resolve(options.cwd, 'npm-cache'));
				assert.equal(options.env.NPM_CONFIG_USERCONFIG, resolve(options.cwd, 'user.npmrc'));
				assert.equal(options.env.NPM_CONFIG_GLOBALCONFIG, resolve(options.cwd, 'global.npmrc'));
			},
		}),
	});
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
