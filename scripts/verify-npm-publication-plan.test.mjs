import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';

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

const unresolvedRequirements = [
	'clean-registry-install-smoke',
	'documentation-sync',
	'generated-project-registry-smoke',
	'package-contents-audit',
	'package-publication-enablement',
	'public-registry-verification',
	'publication-gate-integration',
	'recovery-policy',
	'registry-ownership',
	'release-identity-integration',
	'stable-prerelease-dist-tag-policy',
	'trusted-publishing',
];

test('current repository has a complete but explicitly non-ready npm prepublication plan', () => {
	const result = verifyNpmPublicationPlan(repositoryRoot);
	assert.deepEqual(result, {
		schemaVersion: 1,
		stage: 'prepublication-audit',
		publicationReady: false,
		unresolvedRequirements,
		currentVersion: '1.0.0',
		firstStableRegistryRelease: '1.1.0',
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

test('prepublication audit fails if a planned package becomes publishable early', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/runtime/package.json');
		const manifest = readJson(path);
		manifest.private = false;
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.runtime\.private: prepublication audit requires private:true/u,
		);
	});
});

test('internal registry dependencies must stay on the exact reviewed release version', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/cli/package.json');
		const manifest = readJson(path);
		manifest.dependencies['@virune/runtime'] = '^1.0.0';
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.cli\.dependencies\.@virune\/runtime: internal published dependencies must use the exact reviewed release version/u,
		);
	});
});

test('registry package names must match current workspace package identities', () => {
	for (const directory of ['runtime', 'cli']) {
		withFixture(root => {
			const path = resolve(root, '.github/release/npm-publication-v1.json');
			const plan = readJson(path);
			const item = plan.packages.find(value => value.directory === directory);
			item.registryName = directory === 'cli' ? '@virune/cli' : '@example/runtime';
			writeJson(path, plan);
			assert.throws(
				() => verifyNpmPublicationPlan(root),
				/registry package renaming is not modeled by the current release packaging path/u,
			);
		});
	}
});

test('every workspace package must be explicitly public or excluded with a substantive reason', () => {
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
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.excludedWorkspacePackages.find(item => item.directory === 'language-server').reason = '   ';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/excludedWorkspacePackages\[0\]\.reason: expected a non-empty non-whitespace string/u,
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

test('prepublication plan cannot claim readiness while required work is unresolved', () => {
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.publicationReady = true;
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/publicationReady: prepublication audit must not claim publication readiness/u,
		);
	});
});

test('prepublication blockers cannot be silently dropped', () => {
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.unresolvedRequirements = plan.unresolvedRequirements.filter(item => item !== 'package-contents-audit');
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/unresolvedRequirements: expected unresolved prepublication requirements/u,
		);
	});
});

test('v1.0.0 retro-publish boundary must precede the first stable npm release', () => {
	withFixture(root => {
		const path = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(path);
		plan.firstStableRegistryRelease = '1.0.0';
		writeJson(path, plan);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/firstStableRegistryRelease: must be later than the forbidden retro-publish boundary/u,
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
