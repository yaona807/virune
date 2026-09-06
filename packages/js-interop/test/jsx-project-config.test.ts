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
\tinterface Element { readonly __jsxElementBrand: unique symbol; }
\tinterface IntrinsicElements {
\t\tpanel: { label: string };
\t}
}
`;

function usage(containingFile: string, platform: 'node' | 'browser' | 'neutral' = 'browser') {
\treturn {
\t\tcontainingFile,
\t\tplatform,
\t\tsourceText: `/// <reference path="./jsx.d.ts" />\nconst view = <panel label="ok" />;\nview;`,
\t} as const;
}

async function jsxProject(): Promise<{ readonly root: string; readonly sourceFile: string }> {
\tconst root = await fixtureRoot();
\tawait writeFile(join(root, 'src/jsx.d.ts'), jsxDeclarations, 'utf8');
\treturn { root, sourceFile: join(root, 'src/main.virune') };
}

function resolver(provider: JsInteropProvider) {
\tconst resolveJsxUsage = provider.resolveJsxUsage;
\tassert.ok(resolveJsxUsage !== undefined);
\treturn resolveJsxUsage;
}

test('discovers root tsconfig JSX mode for the normal projectRoot-only provider path', async () => {
\tconst { root, sourceFile } = await jsxProject();
\tawait writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' }, include: ['src/**/*'] }), 'utf8');
\tconst provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });
\n\tassert.deepEqual(resolver(provider)(usage(sourceFile)), { accepted: true });
});

test('honors JSX settings inherited through TypeScript extends semantics', async () => {
\tconst { root, sourceFile } = await jsxProject();
\tawait writeFile(join(root, 'base-tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' } }), 'utf8');
\tawait writeFile(join(root, 'tsconfig.json'), JSON.stringify({ extends: './base-tsconfig.json', include: ['src/**/*'] }), 'utf8');
\tconst provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });
\n\tassert.deepEqual(resolver(provider)(usage(sourceFile)), { accepted: true });
});

test('keeps explicit programmatic JSX compiler options authoritative over project discovery', async () => {
\tconst { root, sourceFile } = await jsxProject();
\tawait writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' }, include: ['src/**/*'] }), 'utf8');
\tconst provider: JsInteropProvider = new TypeScriptInteropProvider({
\t\tprojectRoot: root,
\t\tcompilerOptions: { jsx: ts.JsxEmit.Preserve },
\t});
\n\tassert.deepEqual(resolver(provider)(usage(sourceFile)), { accepted: true });
});

test('keeps JSX disabled when neither project config nor explicit options enable it', async () => {
\tconst { root, sourceFile } = await jsxProject();
\tconst provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });
\n\tassert.equal(resolver(provider)(usage(sourceFile)), undefined);
});

test('fails JSX closed for malformed, invalid, unreadable, or unresolved project config', async t => {
\tfor (const [name, setup] of [
\t\t['malformed JSON', async (root: string) => writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":', 'utf8')],
\t\t['invalid JSX option', async (root: string) => writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'not-a-mode' }, include: ['src/**/*'] }), 'utf8')],
\t\t['unresolved extends', async (root: string) => writeFile(join(root, 'tsconfig.json'), JSON.stringify({ extends: './missing-tsconfig.json', compilerOptions: { jsx: 'preserve' }, include: ['src/**/*'] }), 'utf8')],
\t\t['unreadable config path', async (root: string) => mkdir(join(root, 'tsconfig.json'))],
\t] as const) {
\t\tawait t.test(name, async () => {
\t\t\tconst { root, sourceFile } = await jsxProject();
\t\t\tawait setup(root);
\t\t\tconst provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });
\t\t\tassert.equal(resolver(provider)(usage(sourceFile)), undefined);
\t\t});
\t}
});

test('project config cannot weaken Interop safety or replace target-platform module resolution', async () => {
\tconst { root, sourceFile } = await jsxProject();
\tawait writeFile(join(root, 'tsconfig.json'), JSON.stringify({
\t\tcompilerOptions: {
\t\t\tjsx: 'preserve',
\t\t\tstrict: false,
\t\t\tstrictNullChecks: false,
\t\t\tmodule: 'commonjs',
\t\t\tmoduleResolution: 'node',
\t\t},
\t\tinclude: ['src/**/*'],
\t}), 'utf8');
\tlet settings: ts.CompilerOptions | undefined;
\tconst provider: JsInteropProvider = new TypeScriptInteropProvider({
\t\tprojectRoot: root,
\t\tcreateLanguageService: host => {
\t\t\tsettings = host.getCompilationSettings();
\t\t\treturn ts.createLanguageService(host);
\t\t},
\t});
\n\tassert.deepEqual(resolver(provider)(usage(sourceFile, 'node')), { accepted: true });
\tassert.equal(settings?.jsx, ts.JsxEmit.Preserve);
\tassert.equal(settings?.strict, true);
\tassert.equal(settings?.strictNullChecks, true);
\tassert.equal(settings?.module, ts.ModuleKind.NodeNext);
\tassert.equal(settings?.moduleResolution, ts.ModuleResolutionKind.NodeNext);
});

test('cached provider discovers project JSX configuration without a separate LSP path', async () => {
\tconst { root, sourceFile } = await jsxProject();
\tawait writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' }, include: ['src/**/*'] }), 'utf8');
\tconst provider: JsInteropProvider = new CachedTypeScriptInteropProvider({ projectRoot: root, generation: 4 });
\n\tassert.deepEqual(resolver(provider)(usage(sourceFile)), { accepted: true });
});
