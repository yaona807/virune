import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { JsInteropProvider } from '@virune/compiler/experimental';
import ts from 'typescript';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

const jsxDeclarations = `declare namespace JSX {
	interface Element { readonly __jsxElementBrand: unique symbol; }
	interface IntrinsicElements {
		panel: { label: string };
	}
}
`;

function usage(containingFile: string, platform: 'node' | 'browser' | 'neutral' = 'browser') {
	return {
		containingFile,
		platform,
		sourceText: `/// <reference path="./jsx.d.ts" />\nconst view = <panel label="ok" />;\nview;`,
	} as const;
}

async function jsxProject(): Promise<{ readonly root: string; readonly sourceFile: string }> {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/jsx.d.ts'), jsxDeclarations, 'utf8');
	return { root, sourceFile: join(root, 'src/main.virune') };
}

function resolver(provider: JsInteropProvider) {
	const resolveJsxUsage = provider.resolveJsxUsage;
	assert.ok(resolveJsxUsage !== undefined);
	return resolveJsxUsage;
}

test('discovers root tsconfig JSX mode for the normal projectRoot-only provider path', async () => {
	const { root, sourceFile } = await jsxProject();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' }, include: ['src/**/*'] }), 'utf8');
	const provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });

	assert.deepEqual(resolver(provider)(usage(sourceFile)), { accepted: true });
});

test('honors JSX settings inherited through TypeScript extends semantics', async () => {
	const { root, sourceFile } = await jsxProject();
	await writeFile(join(root, 'base-tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' } }), 'utf8');
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ extends: './base-tsconfig.json', include: ['src/**/*'] }), 'utf8');
	const provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });

	assert.deepEqual(resolver(provider)(usage(sourceFile)), { accepted: true });
});

test('keeps explicit programmatic JSX compiler options authoritative over project discovery', async () => {
	const { root, sourceFile } = await jsxProject();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' }, include: ['src/**/*'] }), 'utf8');
	const provider: JsInteropProvider = new TypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: { jsx: ts.JsxEmit.Preserve },
	});

	assert.deepEqual(resolver(provider)(usage(sourceFile)), { accepted: true });
});

test('keeps JSX disabled when neither project config nor explicit options enable it', async () => {
	const { root, sourceFile } = await jsxProject();
	const provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });

	assert.equal(resolver(provider)(usage(sourceFile)), undefined);
});

test('fails JSX closed for malformed, invalid, unreadable, or unresolved project config', async t => {
	for (const [name, setup] of [
		['malformed JSON', async (root: string) => writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":', 'utf8')],
		['invalid JSX option', async (root: string) => writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'not-a-mode' }, include: ['src/**/*'] }), 'utf8')],
		['unresolved extends', async (root: string) => writeFile(join(root, 'tsconfig.json'), JSON.stringify({ extends: './missing-tsconfig.json', compilerOptions: { jsx: 'preserve' }, include: ['src/**/*'] }), 'utf8')],
		['unreadable config path', async (root: string) => mkdir(join(root, 'tsconfig.json'))],
	] as const) {
		await t.test(name, async () => {
			const { root, sourceFile } = await jsxProject();
			await setup(root);
			const provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });
			assert.equal(resolver(provider)(usage(sourceFile)), undefined);
		});
	}
});

test('project config cannot weaken Interop safety or replace target-platform module resolution', async () => {
	const { root, sourceFile } = await jsxProject();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
		compilerOptions: {
			jsx: 'preserve',
			strict: false,
			strictNullChecks: false,
			module: 'commonjs',
			moduleResolution: 'node',
		},
		include: ['src/**/*'],
	}), 'utf8');
	let settings: ts.CompilerOptions | undefined;
	const provider: JsInteropProvider = new TypeScriptInteropProvider({
		projectRoot: root,
		createLanguageService: host => {
			settings = host.getCompilationSettings();
			return ts.createLanguageService(host);
		},
	});

	assert.deepEqual(resolver(provider)(usage(sourceFile, 'node')), { accepted: true });
	assert.equal(settings?.jsx, ts.JsxEmit.Preserve);
	assert.equal(settings?.strict, true);
	assert.equal(settings?.strictNullChecks, true);
	assert.equal(settings?.module, ts.ModuleKind.NodeNext);
	assert.equal(settings?.moduleResolution, ts.ModuleResolutionKind.NodeNext);
});

test('cached provider discovers project JSX configuration without a separate LSP path', async () => {
	const { root, sourceFile } = await jsxProject();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' }, include: ['src/**/*'] }), 'utf8');
	const provider: JsInteropProvider = new CachedTypeScriptInteropProvider({ projectRoot: root, generation: 4 });

	assert.deepEqual(resolver(provider)(usage(sourceFile)), { accepted: true });
});
