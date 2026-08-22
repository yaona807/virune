import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGeneratedProjectPackageManifest, generatedProjectDependencyVersions } from '../src/init-manifest.js';

test('v1.0.x generated projects preserve immutable GitHub Release dependencies', () => {
	assert.deepEqual(generatedProjectDependencyVersions('1.0.0'), {
		source: 'github-release',
		cli: 'https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz',
		runtime: 'https://github.com/yaona807/virune/releases/download/v1.0.0/virune-runtime-1.0.0.tgz',
		stdlib: 'https://github.com/yaona807/virune/releases/download/v1.0.0/virune-stdlib-1.0.0.tgz',
	});
	assert.equal(generatedProjectDependencyVersions('1.0.9').source, 'github-release');
});

test('Registry-enabled stable and prerelease lines generate exact npm versions without a selector', () => {
	for (const version of ['1.1.0-alpha.1', '1.1.0-beta.2', '1.1.0-rc.1', '1.1.0', '1.2.0', '2.0.0']) {
		assert.deepEqual(generatedProjectDependencyVersions(version), {
			source: 'npm',
			cli: version,
			runtime: version,
			stdlib: version,
		});
		const manifest = buildGeneratedProjectPackageManifest('example', version);
		assert.deepEqual(manifest.dependencies, {
			'@virune/runtime': version,
			'@virune/stdlib': version,
		});
		assert.deepEqual(manifest.devDependencies, { virune: version });
	}
});

test('nightly releases remain on immutable GitHub Release dependencies', () => {
	const version = '1.1.0-nightly.20260822.1';
	assert.deepEqual(generatedProjectDependencyVersions(version), {
		source: 'github-release',
		cli: `https://github.com/yaona807/virune/releases/download/v${version}/virune-${version}.tgz`,
		runtime: `https://github.com/yaona807/virune/releases/download/v${version}/virune-runtime-${version}.tgz`,
		stdlib: `https://github.com/yaona807/virune/releases/download/v${version}/virune-stdlib-${version}.tgz`,
	});
});

test('generated project manifest keeps the canonical scripts and private package boundary', () => {
	assert.deepEqual(buildGeneratedProjectPackageManifest('example', '1.1.0'), {
		name: 'example',
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
			'@virune/runtime': '1.1.0',
			'@virune/stdlib': '1.1.0',
		},
		devDependencies: { virune: '1.1.0' },
	});
});

test('malformed release versions fail closed', () => {
	for (const version of ['', '1', '1.1', '01.1.0', '1.01.0', '1.1.0-', 'latest']) {
		assert.throws(() => generatedProjectDependencyVersions(version), /Invalid Virune release version/u);
	}
});
