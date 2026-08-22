import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
	validatePublicReleaseBinding,
	verifyCleanGlobalCliInstall,
	verifyPublicNpmRegistry,
} from './verify-public-npm-registry.mjs';

const reviewedCommit = 'a'.repeat(40);

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
	await verifyCleanGlobalCliInstall(version, {
		platform: 'linux',
		baseEnv: { PATH: process.env.PATH ?? '/usr/bin' },
		runCommand(command, args) {
			if (command === 'npm') {
				const prefixArgument = args.find(argument => argument.startsWith('--prefix='));
				assert(prefixArgument !== undefined);
				const prefix = prefixArgument.slice('--prefix='.length);
				mkdirSync(resolve(prefix, 'bin'), { recursive: true });
				writeFileSync(resolve(prefix, 'bin/virune'), '#!/bin/sh\n', { mode: 0o644 });
				return { status: 0, stdout: '', stderr: '' };
			}
			assert.deepEqual(args, ['--version']);
			assert.equal(statSync(command).mode & 0o111, 0, 'verifier must not chmod the installed CLI');
			return { status: 0, stdout: `virune ${version}\n`, stderr: '' };
		},
	});
});
