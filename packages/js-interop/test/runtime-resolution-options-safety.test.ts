import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function writePackage(root: string, name: string): Promise<void> {
	const packageRoot = join(root, 'node_modules', name);
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name,
		version: '1.0.0',
		type: 'module',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './index.mjs',
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'declare const value: "runtime";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'index.mjs'), 'export default "runtime";\n', 'utf8');
}

function resolveDefault(provider: TypeScriptInteropProvider, root: string, moduleSpecifier: string) {
	return provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier,
		kind: 'default',
		platform: 'node',
	});
}

test('TypeScript paths aliases cannot redirect a Node runtime package to unrelated declarations', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'paths-runtime');
	await writeFile(join(root, 'src/paths-fake.d.ts'), 'declare const value: "fake";\nexport default value;\n', 'utf8');

	const provider = new TypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: { paths: { 'paths-runtime': ['./src/paths-fake.d.ts'] } },
	});
	const imported = resolveDefault(provider, root, 'paths-runtime');
	assert.ok(imported.type);
	assert.equal(imported.type.display, '"runtime"');
	assert.equal(imported.witness.declarationEntry, 'index.d.ts');
	assert.equal(imported.witness.runtimeEntry, 'index.mjs');
});

test('TypeScript baseUrl cannot shadow a Node runtime package', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'base-url-runtime');
	await writeFile(join(root, 'base-url-runtime.d.ts'), 'declare const value: "fake";\nexport default value;\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { baseUrl: root } });
	const imported = resolveDefault(provider, root, 'base-url-runtime');
	assert.ok(imported.type);
	assert.equal(imported.type.display, '"runtime"');
	assert.equal(imported.witness.declarationEntry, 'index.d.ts');
	assert.equal(imported.witness.runtimeEntry, 'index.mjs');
});

test('TypeScript moduleSuffixes cannot substitute declarations that the Node runtime will not load', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'declare const value: "runtime";\nexport default value;\n', 'utf8');
	await writeFile(join(root, 'src/library.native.d.ts'), 'declare const value: "native";\nexport default value;\n', 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export default "runtime";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { moduleSuffixes: ['.native', ''] } });
	const imported = resolveDefault(provider, root, './library.js');
	assert.ok(imported.type);
	assert.equal(imported.type.display, '"runtime"');
});

test('TypeScript rootDirs cannot make a missing Node runtime module appear resolvable', async () => {
	const root = await fixtureRoot();
	await mkdir(join(root, 'generated'), { recursive: true });
	await writeFile(join(root, 'generated/helper.d.ts'), 'declare const value: "generated";\nexport default value;\n', 'utf8');

	const provider = new TypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: { rootDirs: [join(root, 'src'), join(root, 'generated')] },
	});
	assert.throws(() => resolveDefault(provider, root, './helper.js'));
});

test('package exports encapsulation cannot be disabled for a Node interop workspace', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'exports-runtime');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'exports-runtime',
		version: '1.0.0',
		type: 'module',
		exports: { '.': './index.mjs' },
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.mjs'), 'export default "public";\n', 'utf8');
	await writeFile(join(packageRoot, 'private.d.ts'), 'declare const value: "private";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'private.js'), 'export default "private";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { resolvePackageJsonExports: false } });
	assert.throws(() => resolveDefault(provider, root, 'exports-runtime/private.js'));
});
