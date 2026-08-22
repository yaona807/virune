import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	validateGeneratedNpmProjectManifest,
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
const reviewedCommit = 'a'.repeat(40);

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

function publicReleaseReportFor(publicationManifest, commit = reviewedCommit) {
	const bytes = Buffer.from(`${JSON.stringify(publicationManifest, null, 2)}\n`, 'utf8');
	return {
		schemaVersion: 1,
		version,
		tag: `v${version}`,
		tagCommit: commit,
		expectedCommit: commit,
		release: { draft: false, prerelease: true },
		assets: [{
			file: 'PUBLICATION-MANIFEST.json',
			sha256: createHash('sha256').update(bytes).digest('hex'),
			bytes: bytes.byteLength,
		}],
		attestations: { provenance: 'passed', cyclonedx: 'passed' },
		vsix: {
			file: `virune-vscode-${version}.vsix`,
			cleanInstall: 'passed',
			activation: 'passed',
			languageServer: 'passed',
			uninstall: 'passed',
		},
		passed: true,
	};
}

function fixture({ commit = reviewedCommit } = {}) {
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
	const current = {
		publicationManifest,
		publicReleaseReport: publicReleaseReportFor(publicationManifest, commit),
		metadata,
		packuments,
		packageBytes,
		tarballs,
		failedTarballs,
		malformedJson,
		fetchImpl: null,
	};
	current.fetchImpl = async url => {
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
	return current;
}

function refreshReleaseBinding(current, commit = reviewedCommit) {
	current.publicReleaseReport = publicReleaseReportFor(current.publicationManifest, commit);
}

function generatedProjectManifest(generatedVersion = version) {
	return {
		name: 'generated-project',
		private: true,
		type: 'module',
		scripts: {
			build: 'virune build',
			start: 'virune run',
			test: 'virune test',
			check: 'virune check',
			fmt: 'virune fmt .',
		},
		dependencies: {
			'@virune/runtime': generatedVersion,
			'@virune/stdlib': generatedVersion,
		},
		devDependencies: { virune: generatedVersion },
	};
}

function successfulRunCommand(expectedVersion = version, { inspectInstall, mutateGeneratedManifest, startOutput = 'Hello from Virune\n' } = {}) {
	return (command, args, options = {}) => {
		if (command === 'npm' && args[0] === 'install' && args.includes('--global')) {
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
		if (command === 'npm' && args[0] === 'install') {
			assert(args.includes(`--registry=${registry}`));
			assert(args.includes('--package-lock=false'));
			assert.equal(readFileSync(resolve(options.cwd, 'package.json'), 'utf8').includes('github.com/yaona807/virune/releases'), false);
			return { status: 0, stdout: '', stderr: '' };
		}
		if (command === 'npm' && args[0] === 'run') {
			assert(['check', 'build', 'start'].includes(args[1]));
			return { status: 0, stdout: args[1] === 'start' ? startOutput : '', stderr: '' };
		}
		if (args.length === 1 && args[0] === '--version') return { status: 0, stdout: `virune ${expectedVersion}\n`, stderr: '' };
		if (args[0] === 'init') {
			assert.equal(args[2], '--dependency-source=npm');
			const project = args[1];
			mkdirSync(project, { recursive: true });
			const manifest = generatedProjectManifest();
			mutateGeneratedManifest?.(manifest);
			writeFileSync(resolve(project, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
			return { status: 0, stdout: `Initialized Virune project in ${project}\n`, stderr: '' };
		}
		throw new Error(`Unexpected command ${command} ${args.join(' ')}`);
	};
}

function verifyOptions(current, overrides = {}) {
	return {
		reviewedCommit,
		publicationManifest: current.publicationManifest,
		publicReleaseReport: current.publicReleaseReport,
		publicationPlan,
		outputPath: null,
		fetchImpl: current.fetchImpl,
		runCommand: successfulRunCommand(),
		platform: 'linux',
		...overrides,
	};
}

test('verifies exact reviewed package bytes, tags and clean global CLI installation', async () => {
	const current = fixture();
	const report = await verifyPublicNpmRegistry(verifyOptions(current));
	assert.equal(report.version, version);
	assert.equal(report.reviewedCommit, reviewedCommit);
	assert.equal(report.distTag, 'next');
	assert.match(report.releaseBinding.publicationManifestSha256, /^[0-9a-f]{64}$/u);
	assert(report.releaseBinding.publicationManifestBytes > 0);
	assert.equal(report.packages.length, publicationPlan.packages.length);
	assert.deepEqual(report.packages.map(item => item.registryName), [...report.packages.map(item => item.registryName)].sort());
	assert.equal(report.installation.package, `virune@${version}`);
	assert.equal(report.installation.versionOutput, `virune ${version}`);
	assert.deepEqual(report.installation.generatedProject, {
		dependencySource: 'npm',
		dependencies: { '@virune/runtime': version, '@virune/stdlib': version },
		devDependencies: { virune: version },
		install: 'passed',
		check: 'passed',
		build: 'passed',
		run: 'passed',
	});
});

test('loads npm publication policy from the exact reviewed Git commit when not injected', async () => {
	const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' });
	assert.equal(git.status, 0, git.stderr);
	const exactHead = git.stdout.trim();
	assert.match(exactHead, /^[0-9a-f]{40}$/u);
	const current = fixture({ commit: exactHead });
	const report = await verifyPublicNpmRegistry(verifyOptions(current, {
		reviewedCommit: exactHead,
		publicationPlan: undefined,
	}));
	assert.equal(report.reviewedCommit, exactHead);
});

test('rejects missing or malformed reviewed commit identity before Registry observation', async () => {
	const current = fixture();
	await assert.rejects(() => verifyPublicNpmRegistry(verifyOptions(current, { reviewedCommit: undefined })), /full lowercase commit SHA/u);
	await assert.rejects(() => verifyPublicNpmRegistry(verifyOptions(current, { reviewedCommit: 'ABC' })), /full lowercase commit SHA/u);
});

test('public Registry verification is bound to finalized exact public-release evidence', async () => {
	for (const mutate of [
		current => { current.publicReleaseReport.passed = false; },
		current => { current.publicReleaseReport.expectedCommit = 'b'.repeat(40); },
		current => { current.publicReleaseReport.tagCommit = 'b'.repeat(40); },
		current => { current.publicReleaseReport.version = '1.1.0-rc.2'; },
		current => { current.publicReleaseReport.release.draft = true; },
		current => { current.publicReleaseReport.release.prerelease = false; },
		current => { delete current.publicReleaseReport.attestations; },
		current => { current.publicReleaseReport.attestations.provenance = 'failed'; },
		current => { current.publicReleaseReport.attestations.cyclonedx = 'failed'; },
		current => { delete current.publicReleaseReport.vsix; },
		current => { current.publicReleaseReport.vsix.cleanInstall = 'failed'; },
		current => { current.publicReleaseReport.vsix.activation = 'failed'; },
		current => { current.publicReleaseReport.vsix.languageServer = 'failed'; },
		current => { current.publicReleaseReport.vsix.uninstall = 'failed'; },
		current => { current.publicReleaseReport.vsix.file = 'virune-vscode-wrong.vsix'; },
		current => { current.publicReleaseReport.assets = []; },
		current => { current.publicReleaseReport.assets.push(structuredClone(current.publicReleaseReport.assets[0])); },
		current => { current.publicReleaseReport.assets[0].sha256 = '0'.repeat(64); },
		current => { current.publicReleaseReport.assets[0].bytes += 1; },
	]) {
		const current = fixture();
		mutate(current);
		await assert.rejects(() => verifyPublicNpmRegistry(verifyOptions(current)));
	}
});

test('publication manifest validation is exact, unique and fail closed', () => {
	const good = fixture().publicationManifest;
	assert.equal(validateReviewedPublicationManifest(good, publicationPlan).packages.length, publicationPlan.packages.length);

	const notReady = structuredClone(good);
	notReady.publicationReady = false;
	assert.throws(() => validateReviewedPublicationManifest(notReady, publicationPlan), /publication-ready candidate/u);

	const ineligible = structuredClone(good);
	ineligible.registryVersionEligible = false;
	assert.throws(() => validateReviewedPublicationManifest(ineligible, publicationPlan), /Registry-eligible version/u);

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

test('generated npm project manifest must be exact and cannot hide GitHub URLs or mutable versions', () => {
	const good = generatedProjectManifest();
	assert.deepEqual(validateGeneratedNpmProjectManifest(good, version), {
		dependencySource: 'npm',
		dependencies: { '@virune/runtime': version, '@virune/stdlib': version },
		devDependencies: { virune: version },
	});
	for (const mutate of [
		value => { value.dependencies['@virune/runtime'] = '^1.1.0'; },
		value => { value.dependencies['@virune/stdlib'] = 'https://github.com/yaona807/virune/releases/download/v1.1.0/virune-stdlib-1.1.0.tgz'; },
		value => { value.devDependencies.virune = 'next'; },
		value => { value.dependencies['@virune/extra'] = version; },
		value => { value.scripts.check = 'true'; },
		value => { value.unexpected = true; },
	]) {
		const changed = generatedProjectManifest();
		mutate(changed);
		assert.throws(() => validateGeneratedNpmProjectManifest(changed, version));
	}
});

test('Registry observations reject missing, malformed, partial and stale metadata', async () => {
	const first = publicationPlan.packages[0].registryName;
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
		await assert.rejects(() => verifyPublicNpmRegistry(verifyOptions(current)));
	}
});

test('Registry tarball integrity, shasum, SHA-256 and byte-size drift fail closed', async () => {
	const first = publicationPlan.packages[0].registryName;
	for (const mutate of [
		current => { current.metadata.get(first).dist.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`; },
		current => { current.metadata.get(first).dist.shasum = 'f'.repeat(40); },
		current => {
			current.publicationManifest.packages.find(item => item.registryName === first).sha256 = '0'.repeat(64);
			refreshReleaseBinding(current);
		},
		current => {
			current.publicationManifest.packages.find(item => item.registryName === first).bytes += 1;
			refreshReleaseBinding(current);
		},
		current => current.packageBytes.set(first, Buffer.from('changed Registry bytes\n')),
	]) {
		const current = fixture();
		mutate(current);
		await assert.rejects(() => verifyPublicNpmRegistry(verifyOptions(current)));
	}
});

test('clean global install uses isolated npm state and an allowlisted process environment', async () => {
	await verifyCleanGlobalCliInstall(version, {
		platform: 'linux',
		baseEnv: {
			PATH: '/usr/bin',
			LANG: 'C.UTF-8',
			CI: 'true',
			HOME: '/home/original',
			USERPROFILE: 'C:\\Users\\original',
			NODE_AUTH_TOKEN: 'node-secret',
			NPM_TOKEN: 'npm-secret',
			GH_TOKEN: 'gh-secret',
			GITHUB_TOKEN: 'github-secret',
			AWS_SECRET_ACCESS_KEY: 'aws-secret',
			SSH_AUTH_SOCK: '/tmp/agent.sock',
			NODE_OPTIONS: '--require ./unexpected.cjs',
			NPM_CONFIG_REGISTRY: 'https://evil.invalid/',
		},
		runCommand: successfulRunCommand(version, {
			inspectInstall: (_args, options) => {
				assert.equal(options.env.PATH, '/usr/bin');
				assert.equal(options.env.LANG, 'C.UTF-8');
				assert.equal(options.env.CI, 'true');
				assert.equal(options.env.NODE_AUTH_TOKEN, undefined);
				assert.equal(options.env.NPM_TOKEN, undefined);
				assert.equal(options.env.GH_TOKEN, undefined);
				assert.equal(options.env.GITHUB_TOKEN, undefined);
				assert.equal(options.env.AWS_SECRET_ACCESS_KEY, undefined);
				assert.equal(options.env.SSH_AUTH_SOCK, undefined);
				assert.equal(options.env.NODE_OPTIONS, undefined);
				assert.equal(options.env.HOME, options.cwd);
				assert.equal(options.env.USERPROFILE, options.cwd);
				assert.equal(options.env.XDG_CONFIG_HOME, resolve(options.cwd, 'xdg-config'));
				assert.equal(options.env.NPM_CONFIG_REGISTRY, registry);
				assert.equal(options.env.NPM_CONFIG_REPLACE_REGISTRY_HOST, 'never');
				assert.equal(options.env.NPM_CONFIG_CACHE, resolve(options.cwd, 'npm-cache'));
				assert.equal(options.env.NPM_CONFIG_USERCONFIG, resolve(options.cwd, 'user.npmrc'));
				assert.equal(options.env.NPM_CONFIG_GLOBALCONFIG, resolve(options.cwd, 'global.npmrc'));
			},
		}),
	});
});

test('generated-project smoke fails closed on CLI init, manifest, run, or version failure', async () => {
	await assert.rejects(
		() => verifyCleanGlobalCliInstall(version, {
			runCommand: successfulRunCommand(version, { mutateGeneratedManifest: value => { value.devDependencies.virune = 'next'; } }),
			platform: 'linux',
		}),
		/expected exact 1\.1\.0-rc\.1/u,
	);
	await assert.rejects(
		() => verifyCleanGlobalCliInstall(version, {
			runCommand: successfulRunCommand(version, { startOutput: 'wrong output\n' }),
			platform: 'linux',
		}),
		/did not execute the shipped hello-world/u,
	);
	await assert.rejects(
		() => verifyCleanGlobalCliInstall(version, { runCommand: () => { throw new Error('install failed'); }, platform: 'linux' }),
		/install failed/u,
	);
	await assert.rejects(
		() => verifyCleanGlobalCliInstall(version, { runCommand: successfulRunCommand('1.1.0-rc.2'), platform: 'linux' }),
		/expected virune 1\.1\.0-rc\.1/u,
	);
});
