import assert from 'node:assert/strict';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { makeCliProject, repositoryRoot, runCli, runCliExecutable } from './cli-test-helpers.js';

const CAPABILITY_FILE = 'npm-generated-project-capability.json';
const CAPABILITY_KIND = 'npm-generated-project-dependency-source-v1';
const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';

interface GeneratedManifest {
	readonly dependencies: Record<string, string>;
	readonly devDependencies: Record<string, string>;
}

test('explicit github-release dependency source reproduces the default immutable dependency model', async () => {
	const root = await makeCliProject();
	await runCli(['init', root, '--dependency-source=github-release']);
	const explicit = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as GeneratedManifest;

	const defaultRoot = await makeCliProject();
	await runCli(['init', defaultRoot]);
	const implicit = JSON.parse(await readFile(join(defaultRoot, 'package.json'), 'utf8')) as GeneratedManifest;
	assert.deepEqual(explicit.dependencies, implicit.dependencies);
	assert.deepEqual(explicit.devDependencies, implicit.devDependencies);
	for (const value of [...Object.values(explicit.dependencies), ...Object.values(explicit.devDependencies)]) {
		assert.match(value, /^https:\/\/github\.com\/yaona807\/virune\/releases\/download\/v/u);
	}
});

test('invalid init source state fails before creating the target directory', async () => {
	const parent = await makeCliProject();
	const cases = [
		['--dependency-source='],
		['--dependency-source=unknown'],
		['--dependency-source=npm', '--dependency-source=github-release'],
		['--unknown=value'],
		['one', 'two'],
	];
	for (const [index, invalid] of cases.entries()) {
		const root = join(parent, `invalid-${index}`);
		await assert.rejects(() => runCli(['init', root, ...invalid]));
		await assert.rejects(() => stat(root), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
	}
});

test('normal source CLI rejects npm dependency source before project writes when capability is absent', async () => {
	const parent = await makeCliProject();
	const root = join(parent, 'npm-not-authorized');
	await assert.rejects(
		() => runCli(['init', root, '--dependency-source=npm']),
		/not authorized to generate projects that depend on the public npm Registry/u,
	);
	await assert.rejects(() => stat(root), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
});

test('authorized staged CLI emits exact npm dependency versions and npm README without rewrites', async () => {
	const version = '1.1.0-rc.1';
	const stagedPackage = await stageCandidateCli(version, capability(version));
	const parent = await makeCliProject();
	const root = join(parent, 'npm-project');
	const executable = join(stagedPackage, 'dist/src/entry.js');
	await runCliExecutable(executable, ['init', root, '--dependency-source=npm'], stagedPackage);

	const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as GeneratedManifest;
	assert.deepEqual(manifest.dependencies, {
		'@virune/runtime': version,
		'@virune/stdlib': version,
	});
	assert.deepEqual(manifest.devDependencies, { virune: version });
	for (const value of [...Object.values(manifest.dependencies), ...Object.values(manifest.devDependencies)]) {
		assert.equal(value, version);
		assert.doesNotMatch(value, /github\.com|latest|next|[~^]/u);
	}
	const readme = await readFile(join(root, 'README.md'), 'utf8');
	assert.match(readme, /public npm Registry/u);
	assert.match(readme, /No mutable npm range or dist-tag is used/u);
	assert.doesNotMatch(readme, /GitHub Release assets rather than npm Registry packages/u);
});

test('existing package.json is preserved and a newly created README does not claim that source selection rewrote it', async () => {
	const version = '1.1.0-rc.1';
	const stagedPackage = await stageCandidateCli(version, capability(version));
	const root = await makeCliProject();
	const existingManifest = '{\n\t"name": "existing-project",\n\t"private": true\n}\n';
	await writeFile(join(root, 'package.json'), existingManifest, 'utf8');
	await runCliExecutable(
		join(stagedPackage, 'dist/src/entry.js'),
		['init', root, '--dependency-source=npm'],
		stagedPackage,
	);
	assert.equal(await readFile(join(root, 'package.json'), 'utf8'), existingManifest);
	const readme = await readFile(join(root, 'README.md'), 'utf8');
	assert.match(readme, /preserved the existing package\.json/u);
	assert.match(readme, /requested dependency source was npm/u);
	assert.match(readme, /dependency declarations were not rewritten/u);
	assert.doesNotMatch(readme, /No mutable npm range or dist-tag is used/u);
});

test('malformed or stale staged capability fails before project writes', async () => {
	const cases = [
		{ ...capability('1.1.0-rc.1'), version: '1.1.0-rc.2' },
		{ ...capability('1.1.0-rc.1'), registry: 'https://registry.example.invalid/' },
		{ ...capability('1.1.0-rc.1'), unexpected: true },
	];
	for (const [index, value] of cases.entries()) {
		const stagedPackage = await stageCandidateCli('1.1.0-rc.1', value);
		const parent = await makeCliProject();
		const root = join(parent, `rejected-${index}`);
		await assert.rejects(() => runCliExecutable(
			join(stagedPackage, 'dist/src/entry.js'),
			['init', root, '--dependency-source=npm'],
			stagedPackage,
		));
		await assert.rejects(() => stat(root), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
	}
});

async function stageCandidateCli(version: string, capabilityValue: Record<string, unknown>): Promise<string> {
	const stagingParent = await makeCliProject();
	const stagedPackage = join(stagingParent, 'package');
	await cp(join(repositoryRoot, 'packages/cli'), stagedPackage, { recursive: true });
	const manifestPath = join(stagedPackage, 'package.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
	manifest.version = version;
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`, 'utf8');
	for (const file of ['main.js', 'main-core.js']) {
		const path = join(stagedPackage, 'dist/src', file);
		const source = await readFile(path, 'utf8');
		const matches = [...source.matchAll(/const VERSION = ['"][^'"]+['"];/gu)];
		assert.equal(matches.length, 1, `${file} must contain one VERSION declaration`);
		await writeFile(path, source.replace(matches[0]![0], `const VERSION = ${JSON.stringify(version)};`), 'utf8');
	}
	await mkdir(join(stagedPackage, 'dist/src'), { recursive: true });
	await writeFile(join(stagedPackage, 'dist/src', CAPABILITY_FILE), `${JSON.stringify(capabilityValue, null, '\t')}\n`, 'utf8');
	return stagedPackage;
}

function capability(version: string): Record<string, unknown> {
	return {
		schemaVersion: 1,
		kind: CAPABILITY_KIND,
		version,
		registry: PUBLIC_REGISTRY,
		dependencySource: 'npm',
	};
}
