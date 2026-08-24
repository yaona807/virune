import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';
import { verifyReleaseChannelDocumentation } from './verify-release-channel.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceDirectories = [
	'cli',
	'compiler',
	'formatter',
	'js-interop',
	'language-server',
	'runtime',
	'stdlib',
	'vscode',
];

const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const runtimeDependencySections = ['dependencies', 'peerDependencies', 'optionalDependencies'];

test('current repository has a minimal disabled npm publication contract', () => {
	const result = verifyNpmPublicationPlan(repositoryRoot);
	assert.deepEqual(result, {
		publicationReady: false,
		currentVersion: '1.0.0',
		forbidRegistryPublishThroughVersion: '1.0.0',
		firstStableRegistryRelease: '1.1.0',
		distTagPolicy: {
			stable: 'latest',
			prerelease: 'next',
			nightly: null,
		},
		publishPackages: [
			{ workspaceName: 'virune', registryName: 'virune' },
			{ workspaceName: '@virune/compiler', registryName: '@virune/compiler' },
			{ workspaceName: '@virune/formatter', registryName: '@virune/formatter' },
			{ workspaceName: '@virune/js-interop', registryName: '@virune/js-interop' },
			{ workspaceName: '@virune/runtime', registryName: '@virune/runtime' },
			{ workspaceName: '@virune/stdlib', registryName: '@virune/stdlib' },
		],
		excludedWorkspacePackages: ['@virune/language-server', 'virune-vscode'],
	});
});

test('release-channel documentation is bound to the canonical npm publication policy', () => {
	const publicationPlan = verifyNpmPublicationPlan(repositoryRoot);
	const english = readFileSync(resolve(repositoryRoot, 'docs/release-channels.md'), 'utf8');
	const japanese = readFileSync(resolve(repositoryRoot, 'docs/release-channels_ja.md'), 'utf8');
	assert.doesNotThrow(() => verifyReleaseChannelDocumentation(publicationPlan, english, japanese));
	assert.throws(
		() => verifyReleaseChannelDocumentation(
			publicationPlan,
			english.replace('stable uses `latest`', 'stable uses `stable`'),
			japanese,
		),
		/English release-channel documentation does not match the canonical npm publication plan/u,
	);
	assert.throws(
		() => verifyReleaseChannelDocumentation(
			publicationPlan,
			english,
			japanese.replace('stableは`latest`', 'stableは`stable`'),
		),
		/Japanese release-channel documentation does not match the canonical npm publication plan/u,
	);
	assert.throws(
		() => verifyReleaseChannelDocumentation(
			publicationPlan,
			`${english}\nVirune packages are not published to the npm Registry and do not use npm Registry dist-tags.\n`,
			japanese,
		),
		/English release-channel documentation contains the superseded GitHub-only npm policy/u,
	);
	assert.throws(
		() => verifyReleaseChannelDocumentation(
			publicationPlan,
			english,
			`${japanese}\nViruneパッケージをnpm Registryへ公開せず、npm Registryのdist-tagも使用しません。\n`,
		),
		/Japanese release-channel documentation contains the superseded GitHub-only npm policy/u,
	);
});

test('workspace layout changes fail until publication-plan enumeration is updated', () => {
	withFixture(root => {
		const path = resolve(root, 'package.json');
		const manifest = readJson(path);
		manifest.workspaces = ['packages/*', 'apps/*'];
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\$root\.workspaces: expected canonical workspace layout packages\/\*/u,
		);
	});
});

test('publication remains disabled while planned package manifests are private', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/runtime/package.json');
		const manifest = readJson(path);
		manifest.private = false;
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.runtime\.private: publication remains disabled until the publication-enablement change/u,
		);
	});
});

test('dependency sections must remain package-name maps', () => {
	for (const section of dependencySections) {
		withFixture(root => {
			const path = resolve(root, 'packages/compiler/package.json');
			const manifest = readJson(path);
			manifest[section] = [];
			writeJson(path, manifest);
			assert.throws(
				() => verifyNpmPublicationPlan(root),
				new RegExp(`\\.compiler\\.${section}: expected an object`, 'u'),
			);
		});
	}
});

test('internal Virune dependencies stay on the exact reviewed release version in every dependency section', () => {
	for (const section of dependencySections) {
		withFixture(root => {
			const path = resolve(root, 'packages/compiler/package.json');
			const manifest = readJson(path);
			manifest[section] ??= {};
			manifest[section]['@virune/runtime'] = '^1.0.0';
			writeJson(path, manifest);
			assert.throws(
				() => verifyNpmPublicationPlan(root),
				new RegExp(`\\.compiler\\.${section}\\.@virune/runtime: internal Virune dependencies must use the exact reviewed release version`, 'u'),
			);
		});
	}
});

test('publishable packages cannot require excluded workspace packages at install or runtime', () => {
	for (const section of runtimeDependencySections) {
		withFixture(root => {
			const path = resolve(root, 'packages/compiler/package.json');
			const manifest = readJson(path);
			manifest[section] ??= {};
			manifest[section]['@virune/language-server'] = '1.0.0';
			writeJson(path, manifest);
			assert.throws(
				() => verifyNpmPublicationPlan(root),
				/publishable package cannot require an excluded workspace package at install\/runtime/u,
			);
		});
	}

	withFixture(root => {
		const path = resolve(root, 'packages/compiler/package.json');
		const manifest = readJson(path);
		manifest.devDependencies ??= {};
		manifest.devDependencies['@virune/language-server'] = '1.0.0';
		writeJson(path, manifest);
		assert.doesNotThrow(() => verifyNpmPublicationPlan(root));
	});
});

test('undeclared Virune namespace dependencies fail closed', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/compiler/package.json');
		const manifest = readJson(path);
		manifest.dependencies['@virune/not-in-publication-plan'] = '1.0.0';
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/Virune dependency must refer to a workspace package declared by the publication plan/u,
		);
	});
});

test('duplicated package metadata is not part of the executable publication contract', () => {
	for (const [key, value] of [['registryName', 'virune'], ['role', 'cli']]) {
		withFixture(root => {
			const path = resolve(root, '.github/release/npm-publication-v1.json');
			const plan = readJson(path);
			plan.packages[0][key] = value;
			writeJson(path, plan);
			assert.throws(
				() => verifyNpmPublicationPlan(root),
				/\.packages\[0\]: expected keys directory, workspaceName/u,
			);
		});
	}
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.excludedWorkspacePackages[0].reason = 'descriptive only';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.excludedWorkspacePackages\[0\]: expected keys directory, workspaceName/u,
		);
	});
});

test('every workspace package must be explicitly public or excluded', () => {
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.excludedWorkspacePackages = plan.excludedWorkspacePackages.filter(item => item.directory !== 'language-server');
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/workspace package missing from publication plan: language-server/u,
		);
	});
});

test('publishable package metadata remains bound to reviewed root license and Node runtime baseline', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/runtime/package.json');
		const manifest = readJson(path);
		manifest.license = 'MIT';
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.runtime\.license: must match reviewed root license Apache-2\.0/u,
		);
	});
	withFixture(root => {
		const path = resolve(root, 'packages/runtime/package.json');
		const manifest = readJson(path);
		manifest.engines.node = '>=99.0.0';
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.runtime\.engines\.node: must match reviewed root Node engine >=24\.0\.0/u,
		);
	});
});

test('only the canonical CLI package may expose the virune npm executable', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/runtime/package.json');
		const manifest = readJson(path);
		manifest.bin = { 'runtime-tool': './dist/src/tool.js' };
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.runtime\.bin: non-CLI npm packages must not expose npm executables/u,
		);
	});
	withFixture(root => {
		const path = resolve(root, 'packages/cli/package.json');
		const manifest = readJson(path);
		manifest.bin.extra = './dist/src/entry.js';
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.cli\.bin: expected keys virune/u,
		);
	});
});

test('publishable package metadata requires exports and a substantive unique files allowlist', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/runtime/package.json');
		const manifest = readJson(path);
		delete manifest.exports;
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.runtime\.exports: non-empty exports metadata is required/u,
		);
	});
	withFixture(root => {
		const path = resolve(root, 'packages/runtime/package.json');
		const manifest = readJson(path);
		manifest.files = ['   '];
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.runtime\.files\[0\]: expected a non-empty non-whitespace string/u,
		);
	});
	withFixture(root => {
		const path = resolve(root, 'packages/runtime/package.json');
		const manifest = readJson(path);
		manifest.files = ['dist/src', 'dist/src'];
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.runtime\.files: duplicate file dist\/src/u,
		);
	});
});

test('publication plan cannot become ready without deliberate enablement', () => {
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.publicationReady = true;
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/publicationReady: must remain false until deliberate publication enablement/u,
		);
	});
});

test('descriptive progress metadata is not part of the executable publication contract', () => {
	const removedMetadata = {
		schemaVersion: 1,
		stage: 'prepublication-audit',
		unresolvedRequirements: ['trusted-publishing'],
		trustedPublishingRequired: true,
		publicVerificationRequired: true,
		sameReviewedReleaseIdentityRequired: true,
	};
	for (const [key, value] of Object.entries(removedMetadata)) {
		withFixture(root => {
			const path = resolve(root, '.github/release/npm-publication-v1.json');
			const plan = readJson(path);
			plan[key] = value;
			writeJson(path, plan);
			assert.throws(
				() => verifyNpmPublicationPlan(root),
				/\$: expected keys distTagPolicy, excludedWorkspacePackages, firstStableRegistryRelease, forbidRegistryPublishThroughVersion, packages, publicationReady/u,
			);
		});
	}
});

test('retro-publish and first-stable npm release boundaries cannot drift', () => {
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.forbidRegistryPublishThroughVersion = '0.9.0';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/forbidRegistryPublishThroughVersion: expected 1\.0\.0 retro-publish boundary/u,
		);
	});
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.firstStableRegistryRelease = '1.2.0';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/firstStableRegistryRelease: expected first stable npm release 1\.1\.0/u,
		);
	});
});

test('npm dist-tag policy fails closed on drift, malformed tags, and nightly enablement', () => {
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.distTagPolicy.stable = 'stable';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/distTagPolicy\.stable: stable npm releases must use the latest dist-tag/u,
		);
	});
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.distTagPolicy.prerelease = 'next!';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/distTagPolicy\.prerelease: invalid npm dist-tag/u,
		);
	});
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.distTagPolicy.nightly = 'nightly';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/distTagPolicy\.nightly: nightly releases must not be published to npm/u,
		);
	});
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.distTagPolicy.preview = 'preview';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/distTagPolicy: expected keys nightly, prerelease, stable/u,
		);
	});
});

function withFixture(run) {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-publication-plan-'));
	try {
		mkdirSync(resolve(root, '.github/release'), { recursive: true });
		writeFileSync(
			resolve(root, '.github/release/npm-publication-v1.json'),
			readFileSync(resolve(repositoryRoot, '.github/release/npm-publication-v1.json')),
		);
		writeFileSync(resolve(root, 'package.json'), readFileSync(resolve(repositoryRoot, 'package.json')));
		for (const directory of workspaceDirectories) {
			mkdirSync(resolve(root, 'packages', directory), { recursive: true });
			writeFileSync(
				resolve(root, 'packages', directory, 'package.json'),
				readFileSync(resolve(repositoryRoot, 'packages', directory, 'package.json')),
			);
		}
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
