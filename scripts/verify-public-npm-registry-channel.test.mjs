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
