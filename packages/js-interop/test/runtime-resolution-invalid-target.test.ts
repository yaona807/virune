import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
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

async function resolvePackage(root: string) {
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'invalid-target-runtime',
		kind: 'default',
		platform: 'node',
	});
}

test('an invalid active Node export target cannot fall through to a later condition', async () => {
	const root = await fixtureRoot();
	await writeInvalidTargetPackage(root, '../outside.mjs');
	const imported = await resolvePackage(root);
	assert.ok(imported.type, 'the declaration branch remains independently resolvable');
	assert.equal(imported.witness.runtimeEntry, undefined);
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});

test('an invalid target inside an export target array may fall through to a valid fallback', async () => {
	const root = await fixtureRoot();
	await writeInvalidTargetPackage(root, ['../outside.mjs', './fallback.mjs']);
	const imported = await resolvePackage(root);
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'fallback.mjs');
	assert.equal(imported.witness.runtimeFormat, 'esm');
});

test('an active export target array with no matching branch cannot fall through to a later condition', async () => {
	const root = await fixtureRoot();
	await writeInvalidTargetPackage(root, [{ browser: './fallback.mjs' }]);
	const imported = await resolvePackage(root);
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, undefined);
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});

test('a malformed nearest runtime package scope cannot be classified as CommonJS', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'malformed-scope-runtime');
	await mkdir(join(packageRoot, 'sub'), { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'malformed-scope-runtime',
		version: '1.0.0',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './sub/runtime.js',
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'declare const value: string;\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'sub/package.json'), '{"type":"module"', 'utf8');
	await writeFile(join(packageRoot, 'sub/runtime.js'), 'module.exports = "runtime";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'malformed-scope-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.packageName, 'malformed-scope-runtime');
	assert.equal(imported.witness.runtimeEntry, 'sub/runtime.js');
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});

test('a typeless ambiguous runtime with ESM-only syntax is not classified as CommonJS', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'typeless-esm-runtime');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'typeless-esm-runtime',
		version: '1.0.0',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './runtime.js',
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'declare const value: string;\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'runtime.js'), 'export default "runtime";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'typeless-esm-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.packageName, 'typeless-esm-runtime');
	assert.equal(imported.witness.runtimeEntry, 'runtime.js');
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});

test('a typeless ambiguous runtime that parses as CommonJS remains classified as CommonJS', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'typeless-cjs-runtime');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'typeless-cjs-runtime',
		version: '1.0.0',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './runtime.js',
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'declare const value: string;\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'runtime.js'), 'module.exports = "runtime";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'typeless-cjs-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.packageName, 'typeless-cjs-runtime');
	assert.equal(imported.witness.runtimeEntry, 'runtime.js');
	assert.equal(imported.witness.runtimeFormat, 'commonjs');
});

test('TypeScript customConditions are not trusted as active Node runtime conditions', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'custom-condition-runtime');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'custom-condition-runtime',
		version: '1.0.0',
		type: 'module',
		exports: {
			'.': {
				development: { types: './development.d.ts', default: './development.mjs' },
				node: { types: './node.d.ts', default: './node.mjs' },
				default: { types: './default.d.ts', default: './default.mjs' },
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'development.d.ts'), 'declare const value: "development";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'node.d.ts'), 'declare const value: "node";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'default.d.ts'), 'declare const value: "default";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'development.mjs'), 'export default "development";\n', 'utf8');
	await writeFile(join(packageRoot, 'node.mjs'), 'export default "node";\n', 'utf8');
	await writeFile(join(packageRoot, 'default.mjs'), 'export default "default";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { customConditions: ['development'] } });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'custom-condition-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.declarationEntry, 'node.d.ts');
	assert.equal(imported.witness.runtimeEntry, 'node.mjs');
	assert.deepEqual(imported.witness.conditions, ['types', 'node-addons', 'node', 'import', 'module-sync']);
});

test('Node platform pins the TypeScript resolver to Node semantics', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'node-platform-resolution');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'node-platform-resolution',
		version: '1.0.0',
		type: 'module',
		exports: {
			'.': {
				node: { types: './node.d.ts', default: './node.mjs' },
				default: { types: './default.d.ts', default: './default.mjs' },
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'node.d.ts'), 'declare const value: "node";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'default.d.ts'), 'declare const value: "default";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'node.mjs'), 'export default "node";\n', 'utf8');
	await writeFile(join(packageRoot, 'default.mjs'), 'export default "default";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
		},
	});
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'node-platform-resolution',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.declarationEntry, 'node.d.ts');
	assert.equal(imported.witness.runtimeEntry, 'node.mjs');
});

test('an unsupported runtime extension is not promoted by package type', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'unsupported-extension-runtime');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'unsupported-extension-runtime',
		version: '1.0.0',
		type: 'module',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './runtime.jsx',
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'declare const value: string;\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'runtime.jsx'), 'export default "runtime";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'unsupported-extension-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'runtime.jsx');
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});

test('TypeScript runtime sources inside node_modules are not claimed loadable by Node', async () => {
	const root = await fixtureRoot();
	const packageRoot = join(root, 'node_modules', 'typescript-runtime-package');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'typescript-runtime-package',
		version: '1.0.0',
		type: 'module',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './runtime.mts',
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), 'declare const value: string;\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'runtime.mts'), 'export default "runtime";\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'typescript-runtime-package',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'runtime.mts');
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});
