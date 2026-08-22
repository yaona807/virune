import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { validatePublicReleaseBinding } from './verify-public-npm-registry.mjs';

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
