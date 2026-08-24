import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';
import { verifyWorkspaceLicenseLock } from './verify-workspace-license-lock.mjs';

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

test('excluded workspace licenses remain bound to the reviewed root license', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/vscode/package.json');
		const manifest = readJson(path);
		manifest.license = 'MIT';
		writeJson(path, manifest);
		assert.throws(
			() => verifyNpmPublicationPlan(root),
			/\.vscode\.license: must match reviewed root license Apache-2\.0/u,
		);
	});
});

test('publishable package allowlists retain Apache license and notice files', () => {
	for (const requiredLicenseFile of ['LICENSE', 'NOTICE']) {
		withFixture(root => {
			const path = resolve(root, 'packages/runtime/package.json');
			const manifest = readJson(path);
			manifest.files = manifest.files.filter(file => file !== requiredLicenseFile);
			writeJson(path, manifest);
			assert.throws(
				() => verifyNpmPublicationPlan(root),
				new RegExp(`\\.runtime\\.files: required license file ${requiredLicenseFile} is missing`, 'u'),
			);
		});
	}
});

test('workspace lock license metadata remains synchronized with Apache-2.0', () => {
	assert.doesNotThrow(() => verifyWorkspaceLicenseLock(repositoryRoot, 'Apache-2.0'));
	for (const lockPath of ['', 'packages/vscode']) {
		withFixture(root => {
			const path = resolve(root, 'package-lock.json');
			const lock = readJson(path);
			lock.packages[lockPath].license = 'MIT';
			writeJson(path, lock);
			assert.throws(
				() => verifyWorkspaceLicenseLock(root, 'Apache-2.0'),
				/package-lock\.json: packages\[.*\]\.license must match reviewed root license Apache-2\.0/u,
			);
		});
	}
});

function withFixture(run) {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-license-policy-'));
	try {
		mkdirSync(resolve(root, '.github/release'), { recursive: true });
		writeFileSync(
			resolve(root, '.github/release/npm-publication-v1.json'),
			readFileSync(resolve(repositoryRoot, '.github/release/npm-publication-v1.json')),
		);
		writeFileSync(resolve(root, 'package.json'), readFileSync(resolve(repositoryRoot, 'package.json')));
		writeFileSync(resolve(root, 'package-lock.json'), readFileSync(resolve(repositoryRoot, 'package-lock.json')));
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
