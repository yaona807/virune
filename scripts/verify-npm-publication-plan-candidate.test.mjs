import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NPM_PUBLICATION_POST_WRITE_REQUIREMENTS } from './npm-publication-authorization-contract.mjs';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspaceDirectories = [
	'cli', 'compiler', 'formatter', 'js-interop', 'language-server', 'runtime', 'stdlib', 'vscode',
];
const dependencySections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const candidateVersion = '1.1.0-rc.1';

test('a reviewed future publication-candidate state is representable without making source workspaces publishable', () => {
	withCandidateFixture(root => {
		const result = verifyNpmPublicationPlan(root);
		assert.equal(result.stage, 'publication-candidate');
		assert.equal(result.publicationReady, true);
		assert.equal(result.currentVersion, candidateVersion);
		assert.deepEqual(result.unresolvedRequirements, [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS]);
		assert.equal(Object.hasOwn(result, 'authorization'), false, 'existing normalized verifier return shape must remain compatible');
		for (const directory of workspaceDirectories) {
			const manifest = readJson(resolve(root, 'packages', directory, 'package.json'));
			assert.equal(manifest.private, true, `${directory} source workspace must remain private`);
			assert.equal(manifest.publishConfig, undefined, `${directory} must not gain publishConfig`);
		}
	});
});

test('publication-candidate state fails closed on source readiness, unresolved requirements and Registry eligibility drift', () => {
	withCandidateFixture(root => {
		const planPath = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(planPath);
		plan.publicationReady = false;
		writeJson(planPath, plan);
		assert.throws(() => verifyNpmPublicationPlan(root), /publicationReady:true/u);
	});
	withCandidateFixture(root => {
		const planPath = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(planPath);
		plan.unresolvedRequirements.push('trusted-publishing');
		writeJson(planPath, plan);
		assert.throws(() => verifyNpmPublicationPlan(root), /only post-write completion requirements/u);
	});
	withCandidateFixture(root => {
		setRepositoryVersion(root, '1.1.0-nightly.20260822.1');
		assert.throws(() => verifyNpmPublicationPlan(root), /Registry-eligible/u);
	});
});

function withCandidateFixture(callback) {
	const root = mkdtempSync(join(tmpdir(), 'virune-npm-candidate-'));
	try {
		copyJson('package.json', root);
		copyJson('.github/release/npm-publication-v1.json', root);
		copyJson('.github/release/npm-publication-recovery-v1.json', root);
		for (const directory of workspaceDirectories) copyJson(`packages/${directory}/package.json`, root);
		setRepositoryVersion(root, candidateVersion);
		const planPath = resolve(root, '.github/release/npm-publication-v1.json');
		const plan = readJson(planPath);
		plan.stage = 'publication-candidate';
		plan.publicationReady = true;
		plan.unresolvedRequirements = [...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS];
		writeJson(planPath, plan);
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

function setRepositoryVersion(root, version) {
	const rootPath = resolve(root, 'package.json');
	const rootManifest = readJson(rootPath);
	rootManifest.version = version;
	writeJson(rootPath, rootManifest);
	for (const directory of workspaceDirectories) {
		const path = resolve(root, 'packages', directory, 'package.json');
		const manifest = readJson(path);
		manifest.version = version;
		for (const section of dependencySections) {
			if (manifest[section] === undefined) continue;
			for (const name of Object.keys(manifest[section])) {
				if (name === 'virune' || name.startsWith('@virune/')) manifest[section][name] = version;
			}
		}
		writeJson(path, manifest);
	}
}

function copyJson(relativePath, targetRoot) {
	writeJson(resolve(targetRoot, relativePath), readJson(resolve(repositoryRoot, relativePath)));
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
