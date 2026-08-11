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

test('current repository has a complete prepublication npm plan', () => {
	const result = verifyNpmPublicationPlan(repositoryRoot);
	assert.deepEqual(result, {
		schemaVersion: 1,
		stage: 'prepublication-audit',
		currentVersion: '1.0.0',
		firstStableRegistryRelease: '1.1.0',
		publishPackages: [
			'virune',
			'@virune/compiler',
			'@virune/formatter',
			'@virune/js-interop',
			'@virune/runtime',
			'@virune/stdlib',
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
			/error:|\.runtime\.private: prepublication audit requires private:true/u,
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
