import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('runtime package evidence hashes the nearest package scope that determines format', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'nested-evidence-runtime');
	const runtimeRoot = join(packageRoot, 'sub');
	await mkdir(runtimeRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'nested-evidence-runtime',
		version: '1.0.0',
		exports: {
			'.': {
				types: './index.d.ts',
				default: './sub/runtime.js',
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'declare const value: string;\nexport default value;\n', 'utf8');
	await writeFile(join(runtimeRoot, 'runtime.js'), 'module.exports = "value";\n', 'utf8');
	const nestedPackageJson = join(runtimeRoot, 'package.json');
	await writeFile(nestedPackageJson, '{"type":"module"}\n', 'utf8');

	const request = {
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'nested-evidence-runtime',
		kind: 'default' as const,
		platform: 'node' as const,
	};
	const moduleWitness = new TypeScriptInteropProvider({ projectRoot: root }).resolveImport(request).witness;
	assert.equal(moduleWitness.packageName, 'nested-evidence-runtime');
	assert.equal(moduleWitness.packageVersion, '1.0.0');
	assert.equal(moduleWitness.runtimeEntry, 'sub/runtime.js');
	assert.equal(moduleWitness.runtimeFormat, 'esm');
	assert.ok(moduleWitness.packageJsonHash);

	await writeFile(nestedPackageJson, '{"type":"commonjs"}\n', 'utf8');
	const commonJsWitness = new TypeScriptInteropProvider({ projectRoot: root }).resolveImport(request).witness;
	assert.equal(commonJsWitness.packageName, 'nested-evidence-runtime');
	assert.equal(commonJsWitness.packageVersion, '1.0.0');
	assert.equal(commonJsWitness.runtimeEntry, 'sub/runtime.js');
	assert.equal(commonJsWitness.runtimeFormat, 'commonjs');
	assert.ok(commonJsWitness.packageJsonHash);
	assert.notEqual(commonJsWitness.packageJsonHash, moduleWitness.packageJsonHash);
});
