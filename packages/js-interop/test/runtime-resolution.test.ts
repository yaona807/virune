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
