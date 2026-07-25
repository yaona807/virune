import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCycloneDxSbom } from './generate-release-sbom.mjs';

const manifest = {
	name: 'virune-monorepo',
	version: '1.0.0',
	dependencies: { virune: '1.0.0' },
	devDependencies: { typescript: '6.0.3' },
};
const lock = {
	lockfileVersion: 3,
	packages: {
		'': { name: 'virune-monorepo', version: '1.0.0', dependencies: { virune: '1.0.0' }, devDependencies: { typescript: '6.0.3' } },
		'packages/cli': { name: 'virune', version: '1.0.0', dependencies: { '@virune/runtime': '1.0.0' } },
		'packages/runtime': { name: '@virune/runtime', version: '1.0.0', license: 'MIT' },
		'node_modules/virune': { resolved: 'packages/cli', link: true },
		'node_modules/@virune/runtime': { resolved: 'packages/runtime', link: true },
		'node_modules/typescript': { version: '6.0.3', dev: true, license: 'Apache-2.0' },
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
	assert.equal(first.metadata.component.properties.find(item => item.name === 'virune:release:commit')?.value, 'abc123');
});

test('records workspace packages, development scope and dependency relationships', () => {
	const sbom = buildCycloneDxSbom({ lock, manifest });
	const cli = sbom.components.find(component => component.name === 'virune');
	const runtime = sbom.components.find(component => component.name === '@virune/runtime');
	const typescript = sbom.components.find(component => component.name === 'typescript');
	assert.equal(cli?.type, 'application');
	assert.equal(runtime?.licenses?.[0]?.license.id, 'MIT');
	assert.equal(typescript?.scope, 'optional');
	const rootDependency = sbom.dependencies.find(item => item.ref === sbom.metadata.component['bom-ref']);
	assert.ok(rootDependency?.dependsOn.includes(cli['bom-ref']));
	assert.ok(rootDependency?.dependsOn.includes(typescript['bom-ref']));
	const cliDependency = sbom.dependencies.find(item => item.ref === cli['bom-ref']);
	assert.deepEqual(cliDependency?.dependsOn, [runtime['bom-ref']]);
});

test('rejects unsupported lockfiles', () => {
	assert.throws(() => buildCycloneDxSbom({ lock: { lockfileVersion: 2, packages: {} }, manifest }), /lockfileVersion 3/u);
});
