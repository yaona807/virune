import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function writePackage(root: string, name: string, packageJson: unknown, files: Readonly<Record<string, string>>): Promise<void> {
	const packageRoot = join(root, 'node_modules', ...name.split('/'));
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
	for (const [path, content] of Object.entries(files)) {
		const filePath = join(packageRoot, path);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, content, 'utf8');
	}
}

function request(root: string, moduleSpecifier: string) {
	return {
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier,
		kind: 'default' as const,
		platform: 'node' as const,
	};
}

const declarations = 'declare const value: (input: string) => string;\nexport = value;\n';
const commonJs = 'module.exports = value => value;\n';

test('Node runtime witness resolves the index-shaped extensionless legacy main', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'legacy-main-index', {
		name: 'legacy-main-index',
		version: '1.2.3',
		main: './index',
	}, {
		'index.d.ts': declarations,
		'index.js': commonJs,
	});

	const imported = new TypeScriptInteropProvider({ projectRoot: root }).resolveImport(request(root, 'legacy-main-index'));
	assert.ok(imported.type);
	assert.equal(imported.witness.packageName, 'legacy-main-index');
	assert.equal(imported.witness.packageVersion, '1.2.3');
	assert.equal(imported.witness.runtimeEntry, 'index.js');
	assert.equal(imported.witness.runtimeFormat, 'commonjs');
});

test('Node runtime witness resolves an extensionless legacy package main before package index fallback', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'legacy-main-runtime', {
		name: 'legacy-main-runtime',
		version: '1.2.3',
		main: './entry',
	}, {
		'entry.d.ts': declarations,
		'entry.js': commonJs,
		'index.js': 'module.exports = () => "wrong";\n',
	});

	const imported = new TypeScriptInteropProvider({ projectRoot: root }).resolveImport(request(root, 'legacy-main-runtime'));
	assert.ok(imported.type);
	assert.equal(imported.witness.packageName, 'legacy-main-runtime');
	assert.equal(imported.witness.packageVersion, '1.2.3');
	assert.equal(imported.witness.runtimeEntry, 'entry.js');
	assert.equal(imported.witness.runtimeFormat, 'commonjs');
});

test('Node runtime witness applies the legacy main directory-index fallback', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'legacy-main-directory', {
		name: 'legacy-main-directory',
		main: './lib',
	}, {
		'lib/index.d.ts': declarations,
		'lib/index.js': commonJs,
		'index.js': 'module.exports = () => "wrong";\n',
	});

	const imported = new TypeScriptInteropProvider({ projectRoot: root }).resolveImport(request(root, 'legacy-main-directory'));
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'lib/index.js');
	assert.equal(imported.witness.runtimeFormat, 'commonjs');
});

test('Node runtime witness falls back to package index only after legacy main candidates are absent', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'legacy-main-package-index', {
		name: 'legacy-main-package-index',
		main: './missing',
	}, {
		'index.d.ts': declarations,
		'index.js': commonJs,
	});

	const imported = new TypeScriptInteropProvider({ projectRoot: root }).resolveImport(request(root, 'legacy-main-package-index'));
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'index.js');
	assert.equal(imported.witness.runtimeFormat, 'commonjs');
});
