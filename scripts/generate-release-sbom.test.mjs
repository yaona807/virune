import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildCycloneDxSbom, normalizeWorkspaceLockVersions } from './generate-release-sbom.mjs';

const manifest = {
	name: 'virune-monorepo',
	version: '1.0.0',
	license: 'Apache-2.0',
	dependencies: { virune: '1.0.0' },
	devDependencies: { typescript: '6.0.3' },
};
const lock = {
	lockfileVersion: 3,
	packages: {
		'': { name: 'virune-monorepo', version: '1.0.0', dependencies: { virune: '1.0.0' }, devDependencies: { typescript: '6.0.3' } },
		'packages/cli': { name: 'virune', version: '1.0.0', dependencies: { '@virune/runtime': '1.0.0' } },
		'packages/runtime': { name: '@virune/runtime', version: '1.0.0', license: 'Apache-2.0' },
		'node_modules/virune': { resolved: 'packages/cli', link: true },
		'node_modules/@virune/runtime': { resolved: 'packages/runtime', link: true },
		'node_modules/typescript': { version: '6.0.3', dev: true, license: 'Apache-2.0' },
		'node_modules/example': { version: '2.0.0', license: 'MIT' },
		'node_modules/nested/node_modules/example': { version: '2.0.0', dev: true, license: 'MIT' },
	},
};

test('builds a deterministic CycloneDX 1.6 SBOM from package-lock v3', () => {
	const first = buildCycloneDxSbom({ lock, manifest, commit: 'abc123' });
	const second = buildCycloneDxSbom({ lock, manifest, commit: 'abc123' });
	assert.deepEqual(first, second);
	assert.equal(first.bomFormat, 'CycloneDX');
	assert.equal(first.specVersion, '1.6');
	assert.match(first.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/u);
	assert.equal(first.metadata.component.version, '1.0.0');
	assert.equal(first.metadata.component.licenses?.[0]?.license.id, 'Apache-2.0');
	assert.equal(first.metadata.component.properties.find(item => item.name === 'virune:release:commit')?.value, 'abc123');
	assert.notEqual(first.serialNumber, buildCycloneDxSbom({ lock, manifest, commit: 'different' }).serialNumber);
});

test('records workspace packages, development scope and dependency relationships', () => {
	const sbom = buildCycloneDxSbom({ lock, manifest });
	const cli = sbom.components.find(component => component.name === 'virune');
	const runtime = sbom.components.find(component => component.name === '@virune/runtime');
	const typescript = sbom.components.find(component => component.name === 'typescript');
	assert.equal(cli?.type, 'application');
	assert.equal(runtime?.licenses?.[0]?.license.id, 'Apache-2.0');
	assert.equal(typescript?.scope, 'optional');
	const rootDependency = sbom.dependencies.find(item => item.ref === sbom.metadata.component['bom-ref']);
	assert.ok(rootDependency?.dependsOn.includes(cli['bom-ref']));
	assert.ok(rootDependency?.dependsOn.includes(typescript['bom-ref']));
	const cliDependency = sbom.dependencies.find(item => item.ref === cli['bom-ref']);
	assert.deepEqual(cliDependency?.dependsOn, [runtime['bom-ref']]);
});

test('deduplicates identical package identities while preserving lockfile paths', () => {
	const sbom = buildCycloneDxSbom({ lock, manifest });
	const examples = sbom.components.filter(component => component.name === 'example');
	assert.equal(examples.length, 1);
	assert.equal(examples[0].scope, 'required');
	assert.equal(examples[0].licenses?.[0]?.license.id, 'MIT');
	assert.deepEqual(
		examples[0].properties.filter(property => property.name === 'virune:package-lock:path').map(property => property.value),
		['node_modules/example', 'node_modules/nested/node_modules/example'],
	);
	assert.equal(new Set(sbom.components.map(component => component['bom-ref'])).size, sbom.components.length);
	assert.equal(new Set(sbom.dependencies.map(dependency => dependency.ref)).size, sbom.dependencies.length);
});

test('rejects conflicting license metadata for duplicate package identities', () => {
	const conflicting = structuredClone(lock);
	conflicting.packages['node_modules/nested/node_modules/example'].license = 'Apache-2.0';
	assert.throws(
		() => buildCycloneDxSbom({ lock: conflicting, manifest }),
		/Conflicting license metadata for example@2\.0\.0: MIT vs Apache-2\.0/u,
	);
});

test('normalizes stale lockfile workspace versions from release manifests', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-sbom-workspaces-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'packages/cli'), { recursive: true });
	await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'virune-monorepo', version: '1.0.0-rc.1' }));
	await writeFile(join(root, 'packages/cli/package.json'), JSON.stringify({ name: 'virune', version: '1.0.0-rc.1' }));
	const normalized = normalizeWorkspaceLockVersions({
		version: '1.0.0',
		lockfileVersion: 3,
		packages: {
			'': { name: 'virune-monorepo', version: '1.0.0' },
			'packages/cli': { name: 'virune', version: '1.0.0' },
			'node_modules/example': { version: '2.0.0' },
		},
	}, root);
	assert.equal(normalized.version, '1.0.0-rc.1');
	assert.equal(normalized.packages[''].version, '1.0.0-rc.1');
	assert.equal(normalized.packages['packages/cli'].version, '1.0.0-rc.1');
	assert.equal(normalized.packages['node_modules/example'].version, '2.0.0');
});

test('rejects unsupported lockfiles', () => {
	assert.throws(() => buildCycloneDxSbom({ lock: { lockfileVersion: 2, packages: {} }, manifest }), /lockfileVersion 3/u);
});

test('rejects a root package manifest without license metadata', () => {
	assert.throws(
		() => buildCycloneDxSbom({ lock, manifest: { ...manifest, license: '' } }),
		/name, version, and license/u,
	);
});
