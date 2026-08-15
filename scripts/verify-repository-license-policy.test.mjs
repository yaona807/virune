import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { verifyRepositoryLicensePolicy } from './verify-repository-license-policy.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
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

test('current repository license policy is canonical and synchronized', () => {
	const result = verifyRepositoryLicensePolicy(repositoryRoot);
	assert.equal(result.license, 'Apache-2.0');
	assert.deepEqual(result.workspaces, [...workspaceDirectories].sort());
});

test('modified root Apache license text fails closed', () => {
	withFixture(root => {
		writeFileSync(resolve(root, 'LICENSE'), `${readFileSync(resolve(root, 'LICENSE'), 'utf8')}modified\n`);
		assert.throws(
			() => verifyRepositoryLicensePolicy(root),
			/Root LICENSE must be the canonical unmodified Apache-2\.0 text/u,
		);
	});
});

test('modified root notice attribution fails closed', () => {
	withFixture(root => {
		writeFileSync(resolve(root, 'NOTICE'), 'Virune\nCopyright 2026 Someone Else\n');
		assert.throws(
			() => verifyRepositoryLicensePolicy(root),
			/Root NOTICE must contain the reviewed Virune attribution exactly/u,
		);
	});
});

test('workspace legal-file drift fails closed', () => {
	withFixture(root => {
		writeFileSync(resolve(root, 'packages/runtime/NOTICE'), 'stale notice\n');
		assert.throws(
			() => verifyRepositoryLicensePolicy(root),
			/packages\/runtime\/NOTICE must match the reviewed repository root file byte-for-byte/u,
		);
	});
});

test('workspace license metadata drift fails closed', () => {
	withFixture(root => {
		const path = resolve(root, 'packages/vscode/package.json');
		const manifest = JSON.parse(readFileSync(path, 'utf8'));
		manifest.license = 'MIT';
		writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
		assert.throws(
			() => verifyRepositoryLicensePolicy(root),
			/packages\/vscode\/package\.json license must be Apache-2\.0/u,
		);
	});
});

function withFixture(run) {
	const root = mkdtempSync(join(tmpdir(), 'virune-repository-license-'));
	try {
		writeFileSync(resolve(root, 'package.json'), readFileSync(resolve(repositoryRoot, 'package.json')));
		writeFileSync(resolve(root, 'LICENSE'), readFileSync(resolve(repositoryRoot, 'LICENSE')));
		writeFileSync(resolve(root, 'NOTICE'), readFileSync(resolve(repositoryRoot, 'NOTICE')));
		for (const directory of workspaceDirectories) {
			mkdirSync(resolve(root, 'packages', directory), { recursive: true });
			for (const file of ['package.json', 'LICENSE', 'NOTICE']) {
				writeFileSync(
					resolve(root, 'packages', directory, file),
					readFileSync(resolve(repositoryRoot, 'packages', directory, file)),
				);
			}
		}
		run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
