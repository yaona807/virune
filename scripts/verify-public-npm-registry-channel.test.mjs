import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
	bindPublicNpmRegistryEvidence,
	validatePublicReleaseBinding,
	validateReviewedPublicationManifest,
	verifyCleanGlobalCliInstall,
	verifyPublicNpmRegistry,
} from './verify-public-npm-registry.mjs';
import {
	bundledCliReleaseAssetName,
	registryReleaseAssetNameForPackage,
} from './verify-npm-publication-identity.mjs';
import {
	validateBundledGeneratedProject,
	validateReleaseRecord,
} from './verify-public-release.mjs';

const reviewedCommit = 'a'.repeat(40);
const publicRegistry = 'https://registry.npmjs.org/';

function fixture(version, prerelease) {
	const publicationManifestBytes = Buffer.from(`reviewed-publication-manifest:${version}\n`, 'utf8');
	return {
		publicationManifestBytes,
		report: {
			schemaVersion: 1,
			version,
			tag: `v${version}`,
			tagCommit: reviewedCommit,
			expectedCommit: reviewedCommit,
			release: { draft: false, prerelease },
			npmPublication: {
				registryVersionEligible: true,
				distTag: prerelease ? 'next' : 'latest',
			},
			assets: [{
				file: 'PUBLICATION-MANIFEST.json',
				sha256: createHash('sha256').update(publicationManifestBytes).digest('hex'),
				bytes: publicationManifestBytes.byteLength,
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
		},
	};
}

function registryReport(version, distTag) {
	return {
		schemaVersion: 1,
		registry: publicRegistry,
		version,
		githubReleaseTag: `v${version}`,
		reviewedCommit,
		distTag,
		releaseBinding: { publicationManifestSha256: 'a'.repeat(64), publicationManifestBytes: 123 },
		packages: [{ registryName: 'virune', version, distTag }],
		installation: {
			package: `virune@${version}`,
			registry: publicRegistry,
			versionOutput: `virune ${version}`,
			generatedProject: {
				commands: ['npm install', 'npm run check', 'npm run build', 'npm run start'],
			},
			npx: {
				package: `virune@${version}`,
				registry: publicRegistry,
				acquisition: 'npm-exec',
				nonInteractive: true,
				generatedProject: {},
			},
		},
		passed: true,
	};
}

function releaseAssets(version, registryEligible) {
	const assets = [
		'LICENSE', 'MANIFEST.json', 'NOTICE', 'README.md', 'README_ja.md', 'RELEASE-MANIFEST.json', 'SBOM.cdx.json', 'SHA256SUMS', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES_ja.md', 'package.json',
		`virune-${version}.tgz`, `virune-compiler-${version}.tgz`, `virune-formatter-${version}.tgz`, `virune-js-interop-${version}.tgz`, `virune-runtime-${version}.tgz`, `virune-stdlib-${version}.tgz`, `virune-vscode-${version}.vsix`,
	];
	if (registryEligible) assets.push('PUBLICATION-MANIFEST.json', `virune-npm-${version}.tgz`);
	return assets.map(name => ({ name }));
}

function npmGeneratedProject(version) {
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
			'@virune/runtime': version,
			'@virune/stdlib': version,
		},
		devDependencies: { virune: version },
	};
}

test('public-release binding accepts the canonical prerelease flag for RC and stable channels', () => {
	for (const [version, prerelease] of [['1.1.0-rc.1', true], ['1.1.0', false]]) {
		const current = fixture(version, prerelease);
		assert.doesNotThrow(() => validatePublicReleaseBinding(current.report, {
			reviewedCommit,
			publicationManifestBytes: current.publicationManifestBytes,
			version,
		}));
	}
});

test('public-release binding rejects a prerelease flag that contradicts the release version channel', () => {
	for (const [version, prerelease] of [['1.1.0-rc.1', false], ['1.1.0', true]]) {
		const current = fixture(version, prerelease);
		assert.throws(() => validatePublicReleaseBinding(current.report, {
			reviewedCommit,
			publicationManifestBytes: current.publicationManifestBytes,
			version,
		}), /release must/u);
	}
});

test('bootstrap public Registry verification accepts only the reviewed non-ready Registry-eligible candidate', () => {
	const version = '1.1.0-rc.1';
	const bootstrapPlan = {
		stage: 'bootstrap-candidate',
		publicationReady: false,
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: { stable: 'latest', prerelease: 'next', nightly: null },
		packages: [{ registryName: 'virune' }],
	};
	const manifest = {
		schemaVersion: 1,
		version,
		githubReleaseTag: `v${version}`,
		publishSource: 'reviewed-release-registry-candidate-tarball',
		bundledCliReleaseAsset: bundledCliReleaseAssetName(version),
		publicationReady: false,
		registryVersionEligible: true,
		distTag: 'next',
		packages: [{
			registryName: 'virune',
			releaseAsset: registryReleaseAssetNameForPackage('virune', version),
			sha256: 'a'.repeat(64),
			bytes: 1,
		}],
	};
	assert.doesNotThrow(() => validateReviewedPublicationManifest(manifest, bootstrapPlan));

	const ready = structuredClone(manifest);
	ready.publicationReady = true;
	assert.throws(() => validateReviewedPublicationManifest(ready, bootstrapPlan), /non-ready bootstrap candidate/u);

	const ineligible = structuredClone(manifest);
	ineligible.registryVersionEligible = false;
	assert.throws(() => validateReviewedPublicationManifest(ineligible, bootstrapPlan), /Registry-eligible version/u);
});

test('public release record validation supports exact stable and prerelease channels from reviewed policy', () => {
	const stable = '1.1.0';
	const stablePolicy = validateReleaseRecord({
		tag_name: `v${stable}`,
		draft: false,
		prerelease: false,
		assets: releaseAssets(stable, true),
	}, { tag: `v${stable}`, version: stable });
	assert.equal(stablePolicy.channel, 'stable');
	assert.equal(stablePolicy.registryVersionEligible, true);
	assert.equal(stablePolicy.distTag, 'latest');
	assert.throws(() => validateReleaseRecord({
		tag_name: `v${stable}`,
		draft: false,
		prerelease: true,
		assets: releaseAssets(stable, true),
	}, { tag: `v${stable}`, version: stable }), /Stable version must not be published as a prerelease/u);

	const rc = '1.1.0-rc.1';
	const rcPolicy = validateReleaseRecord({
		tag_name: `v${rc}`,
		draft: false,
		prerelease: true,
		assets: releaseAssets(rc, true),
	}, { tag: `v${rc}`, version: rc });
	assert.equal(rcPolicy.channel, 'prerelease');
	assert.equal(rcPolicy.registryVersionEligible, true);
	assert.equal(rcPolicy.distTag, 'next');
});

test('bundled GitHub Release CLI preserves legacy URL validation but delegates Registry-enabled consumer execution', () => {
	const stable = '1.1.0';
	const generated = npmGeneratedProject(stable);
	const registryResult = validateBundledGeneratedProject(generated, stable, true);
	assert.equal(registryResult.downstreamVerification, 'public-npm-registry-required');
	assert.deepEqual(registryResult.dependencies, { '@virune/runtime': stable, '@virune/stdlib': stable });
	const drifted = structuredClone(generated);
	drifted.dependencies['@virune/runtime'] = '1.1.1';
	assert.throws(() => validateBundledGeneratedProject(drifted, stable, true), /expected 1\.1\.0/u);

	const legacy = '1.0.0';
	const legacyProject = {
		dependencies: {
			'@virune/runtime': `https://github.com/yaona807/virune/releases/download/v${legacy}/virune-runtime-${legacy}.tgz`,
			'@virune/stdlib': `https://github.com/yaona807/virune/releases/download/v${legacy}/virune-stdlib-${legacy}.tgz`,
		},
		devDependencies: {
			virune: `https://github.com/yaona807/virune/releases/download/v${legacy}/virune-${legacy}.tgz`,
		},
	};
	assert.equal(validateBundledGeneratedProject(legacyProject, legacy, false).dependencyCount, 3);
	assert.throws(() => validateBundledGeneratedProject(npmGeneratedProject(legacy), legacy, false), /non-candidate dependency/u);
});

test('npm Registry evidence binding is required for eligible releases and rejects missing or stale output', () => {
	const version = '1.1.0-rc.1';
	const current = fixture(version, true);
	const registry = registryReport(version, 'next');
	const bound = bindPublicNpmRegistryEvidence(current.report, registry);
	assert.deepEqual(bound.npmRegistry.required, true);
	assert.equal(bound.npmRegistry.passed, true);
	assert.equal(bound.npmRegistry.registry, publicRegistry);
	assert.equal(bound.npmRegistry.version, version);
	assert.equal(bound.npmRegistry.reviewedCommit, reviewedCommit);
	assert.equal(bound.npmRegistry.distTag, 'next');
	assert.equal(bound.npmRegistry.packageCount, 1);
	assert.match(bound.npmRegistry.reportSha256, /^[0-9a-f]{64}$/u);
	assert.equal(bound.npmRegistry.globalCli, 'passed');
	assert.equal(bound.npmRegistry.generatedProject, 'passed');
	assert.equal(bound.npmRegistry.npmExec, 'passed');
	assert.throws(() => bindPublicNpmRegistryEvidence(current.report), /expected an object/u);
	const stale = structuredClone(registry);
	stale.reviewedCommit = 'b'.repeat(40);
	assert.throws(() => bindPublicNpmRegistryEvidence(current.report, stale), /reviewedCommit/u);
	const malformed = structuredClone(registry);
	malformed.installation.generatedProject.commands = ['npm install'];
	assert.throws(() => bindPublicNpmRegistryEvidence(current.report, malformed), /canonical generated-project consumer commands/u);
});

test('historical Registry-ineligible evidence remains valid without a Registry report and rejects accidental Registry binding', () => {
	const current = fixture('1.0.0', false);
	current.report.npmPublication = { registryVersionEligible: false, distTag: null };
	const bound = bindPublicNpmRegistryEvidence(current.report);
	assert.deepEqual(bound.npmRegistry, { required: false });
	assert.throws(() => bindPublicNpmRegistryEvidence(current.report, registryReport('1.0.0', 'latest')), /must not bind Registry verification output/u);
});

test('a failed verification invalidates stale passing Registry evidence before validation starts', async () => {
	const root = mkdtempSync(join(tmpdir(), 'virune-public-registry-evidence-'));
	try {
		const outputPath = resolve(root, 'public-npm-registry-report.json');
		writeFileSync(outputPath, '{"schemaVersion":1,"passed":true}\n', 'utf8');
		await assert.rejects(
			() => verifyPublicNpmRegistry({ reviewedCommit: 'not-a-commit', outputPath }),
			/full lowercase commit SHA/u,
		);
		assert.equal(existsSync(outputPath), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('clean install verification does not repair a non-executable installed CLI before checking it', async () => {
	const version = '1.1.0-rc.1';
	let executableChecked = false;
	const writeGeneratedProject = projectRoot => {
		mkdirSync(projectRoot, { recursive: true });
		writeFileSync(resolve(projectRoot, 'package.json'), `${JSON.stringify({
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
				'@virune/runtime': version,
				'@virune/stdlib': version,
			},
			devDependencies: { virune: version },
		}, null, 2)}\n`, 'utf8');
	};
	await verifyCleanGlobalCliInstall(version, {
		platform: 'linux',
		baseEnv: { PATH: process.env.PATH ?? '/usr/bin' },
		runCommand(command, args, options = {}) {
			if (command === 'npm') {
				if (args[0] === 'install' && args.includes('--global')) {
					const prefixArgument = args.find(argument => argument.startsWith('--prefix='));
					assert(prefixArgument !== undefined);
					const prefix = prefixArgument.slice('--prefix='.length);
					mkdirSync(resolve(prefix, 'bin'), { recursive: true });
					writeFileSync(resolve(prefix, 'bin/virune'), '#!/bin/sh\n', { mode: 0o644 });
					return { status: 0, stdout: '', stderr: '' };
				}
				if (args[0] === 'exec') {
					assert.equal(executableChecked, true, 'executable mode must be checked before npm exec consumer initialization');
					const separator = args.indexOf('--');
					assert(separator >= 0);
					assert.equal(args[separator + 1], `virune@${version}`);
					assert.equal(args[separator + 2], 'init');
					assert.equal(typeof args[separator + 3], 'string');
					writeGeneratedProject(resolve(args[separator + 3]));
					return { status: 0, stdout: 'Initialized Virune project\n', stderr: '' };
				}
				if (args[0] === 'install') return { status: 0, stdout: '', stderr: '' };
				if (args[0] === 'run') {
					return { status: 0, stdout: args[1] === 'start' ? 'Hello from Virune\n' : '', stderr: '' };
				}
				throw new Error(`Unexpected npm command: ${args.join(' ')}`);
			}
			if (args[0] === '--version') {
				assert.deepEqual(args, ['--version']);
				assert.equal(statSync(command).mode & 0o111, 0, 'verifier must not chmod the installed CLI');
				executableChecked = true;
				return { status: 0, stdout: `virune ${version}\n`, stderr: '' };
			}
			if (args[0] === 'init') {
				assert.equal(executableChecked, true, 'executable mode must be checked before consumer initialization');
				writeGeneratedProject(resolve(args[1]));
				return { status: 0, stdout: 'Initialized Virune project\n', stderr: '' };
			}
			throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
		},
	});
	assert.equal(executableChecked, true);
});
