import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
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

test('Node runtime witness uses the import condition from the consumer context', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'conditional-runtime', {
		name: 'conditional-runtime',
		type: 'module',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './import.cjs',
				require: './require.mjs',
			},
		},
	}, {
		'index.d.ts': 'declare const value: (input: string) => string;\nexport default value;\n',
		'import.cjs': 'module.exports = value => value;\n',
		'require.mjs': 'export default value => value;\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'conditional-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'import.cjs');
	assert.equal(imported.witness.runtimeFormat, 'commonjs');
});

test('Node runtime witness honors node-addons before a later import fallback', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'node-addons-runtime', {
		name: 'node-addons-runtime',
		type: 'module',
		exports: {
			'.': {
				types: './index.d.ts',
				'node-addons': './addon.cjs',
				import: './import.mjs',
				default: './default.mjs',
			},
		},
	}, {
		'index.d.ts': 'declare const value: (input: string) => string;\nexport default value;\n',
		'addon.cjs': 'module.exports = value => value;\n',
		'import.mjs': 'export default value => value;\n',
		'default.mjs': 'export default value => value;\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'node-addons-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'addon.cjs');
	assert.equal(imported.witness.runtimeFormat, 'commonjs');
	assert.deepEqual(imported.witness.conditions, ['types', 'node-addons', 'node', 'import', 'module-sync']);
});

test('Node type oracle honors node-addons before a later node declaration branch', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'node-addons-types', {
		name: 'node-addons-types',
		type: 'module',
		exports: {
			'.': {
				'node-addons': { types: './addon.d.ts', default: './addon.cjs' },
				node: { types: './node.d.ts', default: './node.mjs' },
				default: { types: './default.d.ts', default: './default.mjs' },
			},
		},
	}, {
		'addon.d.ts': 'declare const value: "addon";\nexport default value;\n',
		'node.d.ts': 'declare const value: "node";\nexport default value;\n',
		'default.d.ts': 'declare const value: "default";\nexport default value;\n',
		'addon.cjs': 'module.exports = "addon";\n',
		'node.mjs': 'export default "node";\n',
		'default.mjs': 'export default "default";\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'node-addons-types',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.declarationEntry, 'addon.d.ts');
	assert.equal(imported.witness.runtimeEntry, 'addon.cjs');
});

test('Node runtime witness honors module-sync before a later import fallback', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'module-sync-runtime', {
		name: 'module-sync-runtime',
		type: 'module',
		exports: {
			'.': {
				types: './index.d.ts',
				'module-sync': './sync.mjs',
				import: './import.mjs',
				default: './default.mjs',
			},
		},
	}, {
		'index.d.ts': 'declare const value: (input: string) => string;\nexport default value;\n',
		'sync.mjs': 'export default value => value;\n',
		'import.mjs': 'export default value => value;\n',
		'default.mjs': 'export default value => value;\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'module-sync-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'sync.mjs');
	assert.equal(imported.witness.runtimeFormat, 'esm');
});

test('Node type oracle honors module-sync before a later import declaration branch', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'module-sync-types', {
		name: 'module-sync-types',
		type: 'module',
		exports: {
			'.': {
				'module-sync': { types: './sync.d.ts', default: './sync.mjs' },
				import: { types: './import.d.ts', default: './import.mjs' },
				default: { types: './default.d.ts', default: './default.mjs' },
			},
		},
	}, {
		'sync.d.ts': 'declare const value: "sync";\nexport default value;\n',
		'import.d.ts': 'declare const value: "import";\nexport default value;\n',
		'default.d.ts': 'declare const value: "default";\nexport default value;\n',
		'sync.mjs': 'export default "sync";\n',
		'import.mjs': 'export default "import";\n',
		'default.mjs': 'export default "default";\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'module-sync-types',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.declarationEntry, 'sync.d.ts');
	assert.equal(imported.witness.runtimeEntry, 'sync.mjs');
});

test('browser package conditions drive the TypeScript declaration oracle', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'platform-runtime', {
		name: 'platform-runtime',
		type: 'module',
		exports: {
			'.': {
				browser: { types: './browser.d.ts', default: './browser.mjs' },
				node: { types: './node.d.ts', default: './node.mjs' },
				default: { types: './default.d.ts', default: './default.mjs' },
			},
		},
	}, {
		'browser.d.ts': 'declare const value: (input: "browser") => "browser";\nexport default value;\n',
		'node.d.ts': 'declare const value: (input: "node") => "node";\nexport default value;\n',
		'default.d.ts': 'declare const value: (input: "default") => "default";\nexport default value;\n',
		'browser.mjs': 'export default value => value;\n',
		'node.mjs': 'export default value => value;\n',
		'default.mjs': 'export default value => value;\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'platform-runtime',
		kind: 'default',
		platform: 'browser',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.declarationEntry, 'browser.d.ts');
	assert.equal(imported.witness.runtimeFormat, 'bundler');
	assert.deepEqual(imported.witness.conditions, ['types', 'import', 'browser']);
});

test('neutral package resolution does not activate Node-specific conditions', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'neutral-runtime', {
		name: 'neutral-runtime',
		type: 'module',
		exports: {
			'.': {
				node: { types: './node.d.ts', default: './node.mjs' },
				default: { types: './default.d.ts', default: './default.mjs' },
			},
		},
	}, {
		'node.d.ts': 'declare const value: "node";\nexport default value;\n',
		'default.d.ts': 'declare const value: "default";\nexport default value;\n',
		'node.mjs': 'export default "node";\n',
		'default.mjs': 'export default "default";\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'neutral-runtime',
		kind: 'default',
		platform: 'neutral',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.declarationEntry, 'default.d.ts');
	assert.equal(imported.witness.runtimeFormat, 'unknown');
	assert.deepEqual(imported.witness.conditions, ['types', 'import']);
});

test('custom conditions stay aligned between TypeScript and the Node runtime witness', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'custom-runtime', {
		name: 'custom-runtime',
		type: 'module',
		exports: {
			'.': {
				development: { types: './development.d.ts', default: './development.mjs' },
				node: { types: './node.d.ts', default: './node.mjs' },
				default: { types: './default.d.ts', default: './default.mjs' },
			},
		},
	}, {
		'development.d.ts': 'declare const value: "development";\nexport default value;\n',
		'node.d.ts': 'declare const value: "node";\nexport default value;\n',
		'default.d.ts': 'declare const value: "default";\nexport default value;\n',
		'development.mjs': 'export default "development";\n',
		'node.mjs': 'export default "node";\n',
		'default.mjs': 'export default "default";\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { customConditions: ['development'] } });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'custom-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.declarationEntry, 'development.d.ts');
	assert.equal(imported.witness.runtimeEntry, 'development.mjs');
	assert.deepEqual(imported.witness.conditions, ['types', 'node-addons', 'node', 'import', 'module-sync', 'development']);
});

test('prefix-only Node builtins do not shadow a bare package with the same name', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'test', {
		name: 'test',
		version: '1.2.3',
		type: 'module',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './index.mjs',
			},
		},
	}, {
		'index.d.ts': 'declare const value: string;\nexport default value;\n',
		'index.mjs': 'export default "package";\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'test',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.packageName, 'test');
	assert.equal(imported.witness.packageVersion, '1.2.3');
	assert.equal(imported.witness.runtimeEntry, 'index.mjs');
	assert.equal(imported.witness.runtimeFormat, 'esm');
});

test('node-prefixed prefix-only builtins remain builtin resolutions', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'node:test',
		kind: 'namespace',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.runtimeEntry, 'node:test');
	assert.equal(imported.witness.runtimeFormat, 'builtin');
});

test('runtime witness keeps bare package identity across a nested module type scope', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'nested-scope-runtime', {
		name: 'nested-scope-runtime',
		version: '4.5.6',
		exports: {
			'.': {
				types: './index.d.ts',
				import: './sub/runtime.js',
			},
		},
	}, {
		'index.d.ts': 'declare const value: string;\nexport default value;\n',
		'sub/package.json': '{"type":"module"}\n',
		'sub/runtime.js': 'export default "runtime";\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'nested-scope-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.packageName, 'nested-scope-runtime');
	assert.equal(imported.witness.packageVersion, '4.5.6');
	assert.equal(imported.witness.runtimeEntry, 'sub/runtime.js');
	assert.equal(imported.witness.runtimeFormat, 'esm');
});

test('a more-specific exports pattern cannot fall through after its conditions do not resolve', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'pattern-runtime', {
		name: 'pattern-runtime',
		type: 'module',
		exports: {
			'./feature/*': {
				types: './types/feature/*.d.ts',
				browser: './browser/*.js',
			},
			'./*': {
				types: './types/fallback/*.d.ts',
				import: './fallback/*.mjs',
			},
		},
	}, {
		'types/feature/value.d.ts': 'declare const value: string;\nexport default value;\n',
		'types/fallback/feature/value.d.ts': 'declare const value: string;\nexport default value;\n',
		'browser/value.js': 'export default "browser";\n',
		'fallback/feature/value.mjs': 'export default "fallback";\n',
	});

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'pattern-runtime/feature/value',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type, 'TypeScript should resolve the first pattern through its types condition');
	assert.equal(imported.witness.runtimeEntry, undefined);
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});

test('legacy ESM package resolution does not apply CommonJS extension searching', async () => {
	const root = await fixtureRoot();
	await writePackage(root, 'legacy-runtime', {
		name: 'legacy-runtime',
		type: 'module',
	}, {
		'subpath.d.ts': 'declare const value: string;\nexport default value;\n',
		'subpath.js': 'export default "runtime";\n',
	});

	const provider = new TypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
		},
	});
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'legacy-runtime/subpath',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type, 'the type oracle is deliberately allowed to resolve the extensionless declaration in this regression');
	assert.equal(imported.witness.runtimeEntry, undefined);
	assert.equal(imported.witness.runtimeFormat, 'unknown');
});
