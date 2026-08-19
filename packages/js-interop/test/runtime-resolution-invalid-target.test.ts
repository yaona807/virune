import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function writeInvalidTargetPackage(root: string, target: unknown): Promise<void> {
	const packageRoot = join(root, 'node_modules', 'invalid-target-runtime');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'invalid-target-runtime',
		type: 'module',
		exports: {
			'.': {
				types: './index.d.ts',
				node: target,
				default: './fallback.mjs',
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'declare const value: string;\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'fallback.mjs'), 'export default "fallback";\n', 'utf8');
}

test('an invalid active Node export target cannot fall through to a later condition', async () => {
	const root = await fixtureRoot();
	await writeInvalidTargetPackage(root, '../outside.mjs');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'invalid-target-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type, 'the declaration branch remains independently resolvable');
	assert.equal(imported.witness.runtimeEntry, undefined);
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});

test('an invalid target inside an export target array may fall through to a valid fallback', async () => {
	const root = await fixtureRoot();
	await writeInvalidTargetPackage(root, ['../outside.mjs', './fallback.mjs']);

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'invalid-target-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'fallback.mjs');
	assert.equal(imported.witness.runtimeFormat, 'esm');
});
