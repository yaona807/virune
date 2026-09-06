import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { JsInteropProvider } from '@virune/compiler/experimental';
import ts from 'typescript';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

const jsxA = `declare namespace JSX {
	interface Element { readonly __jsxElementBrand: unique symbol; }
	interface ElementChildrenAttribute { children: {}; }
	interface IntrinsicElements {
		panel: { className?: string; children?: string | Element };
	}
}
declare function Card(props: { title: string; children?: string }): JSX.Element;
`;

const jsxB = `declare namespace JSX {
	interface Element { readonly __jsxElementBrand: unique symbol; }
	interface ElementChildrenAttribute { slot: {}; }
	interface IntrinsicElements {
		panel: { class?: string; slot?: string | Element };
	}
}
declare function Tile(props: { tone: 'warm' | 'cool'; slot?: string }): JSX.Element;
`;

function jsxUsage(containingFile: string, sourceText: string, platform: 'node' | 'browser' | 'neutral' = 'browser') {
	return { containingFile, platform, sourceText } as const;
}

test('validates JSX from declaration-driven vocabulary without React property assumptions', async () => {
	const root = await fixtureRoot();
	const sourceFile = join(root, 'src/main.virune');
	await writeFile(join(root, 'src/jsx-a.d.ts'), jsxA, 'utf8');
	const provider: JsInteropProvider = new TypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: { jsx: ts.JsxEmit.Preserve },
	});
	const resolveJsxUsage = provider.resolveJsxUsage;
	assert.ok(resolveJsxUsage !== undefined);

	assert.deepEqual(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-a.d.ts" />\nconst view = <panel className="page"><Card title="ok">hello</Card></panel>;\nview;`)), { accepted: true });
	assert.equal(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-a.d.ts" />\nconst view = <panel class="page" />;\nview;`)), undefined);
	assert.equal(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-a.d.ts" />\nconst view = <Card>hello</Card>;\nview;`)), undefined);
	assert.equal(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-a.d.ts" />\nconst view = <Card title="ok"><panel /></Card>;\nview;`)), undefined);
});

test('uses a conflicting JSX children/property vocabulary from declarations', async () => {
	const root = await fixtureRoot();
	const sourceFile = join(root, 'src/main.virune');
	await writeFile(join(root, 'src/jsx-b.d.ts'), jsxB, 'utf8');
	const provider: JsInteropProvider = new TypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: { jsx: ts.JsxEmit.Preserve },
	});
	const resolveJsxUsage = provider.resolveJsxUsage;
	assert.ok(resolveJsxUsage !== undefined);

	assert.deepEqual(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-b.d.ts" />\nconst view = <panel class="page"><Tile tone="warm">hello</Tile></panel>;\nview;`)), { accepted: true });
	assert.equal(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-b.d.ts" />\nconst view = <panel className="page" />;\nview;`)), undefined);
	assert.equal(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-b.d.ts" />\nconst view = <Tile tone="other">hello</Tile>;\nview;`)), undefined);
	assert.equal(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-b.d.ts" />\nconst view = <unknown />;\nview;`)), undefined);
});

test('fails closed when JSX is not enabled in the provider compiler options', async () => {
	const root = await fixtureRoot();
	const sourceFile = join(root, 'src/main.virune');
	await writeFile(join(root, 'src/jsx-a.d.ts'), jsxA, 'utf8');
	const provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const resolveJsxUsage = provider.resolveJsxUsage;
	assert.ok(resolveJsxUsage !== undefined);

	assert.equal(resolveJsxUsage(jsxUsage(sourceFile, `/// <reference path="./jsx-a.d.ts" />\nconst view = <panel className="page" />;\nview;`)), undefined);
});

test('reuses deterministic virtual TSX probes and separates target-platform workspaces', async () => {
	const root = await fixtureRoot();
	const sourceFile = join(root, 'src/main.virune');
	await writeFile(join(root, 'src/jsx-a.d.ts'), jsxA, 'utf8');
	const hosts: ts.LanguageServiceHost[] = [];
	const provider: JsInteropProvider = new TypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: { jsx: ts.JsxEmit.Preserve },
		createLanguageService: host => {
			hosts.push(host);
			return ts.createLanguageService(host);
		},
	});
	const resolveJsxUsage = provider.resolveJsxUsage;
	assert.ok(resolveJsxUsage !== undefined);
	const sourceText = `/// <reference path="./jsx-a.d.ts" />\nconst view = <panel className="page" />;\nview;`;

	assert.deepEqual(resolveJsxUsage(jsxUsage(sourceFile, sourceText, 'browser')), { accepted: true });
	assert.deepEqual(resolveJsxUsage(jsxUsage(sourceFile, sourceText, 'browser')), { accepted: true });
	assert.equal(hosts.length, 1);
	const firstFiles = hosts[0]!.getScriptFileNames().filter(name => name.includes('.virune-interop-jsx-'));
	assert.equal(firstFiles.length, 1);

	assert.deepEqual(resolveJsxUsage(jsxUsage(sourceFile, sourceText.replace('page', 'other'), 'browser')), { accepted: true });
	const secondFiles = hosts[0]!.getScriptFileNames().filter(name => name.includes('.virune-interop-jsx-'));
	assert.equal(secondFiles.length, 2);
	assert.notEqual(secondFiles[0], secondFiles[1]);

	assert.deepEqual(resolveJsxUsage(jsxUsage(sourceFile, sourceText, 'neutral')), { accepted: true });
	assert.equal(hosts.length, 2);
	assert.equal(hosts[1]!.getScriptFileNames().filter(name => name.includes('.virune-interop-jsx-neutral-')).length, 1);
});

test('cached provider forwards JSX whole-usage resolution through one provider generation', async () => {
	const root = await fixtureRoot();
	const sourceFile = join(root, 'src/main.virune');
	await writeFile(join(root, 'src/jsx-a.d.ts'), jsxA, 'utf8');
	let providerCount = 0;
	const provider: JsInteropProvider = new CachedTypeScriptInteropProvider({
		projectRoot: root,
		compilerOptions: { jsx: ts.JsxEmit.Preserve },
		createProvider: options => {
			providerCount++;
			return new TypeScriptInteropProvider(options);
		},
	});
	const resolveJsxUsage = provider.resolveJsxUsage;
	assert.ok(resolveJsxUsage !== undefined);
	const usage = jsxUsage(sourceFile, `/// <reference path="./jsx-a.d.ts" />\nconst view = <panel className="page" />;\nview;`);

	assert.deepEqual(resolveJsxUsage(usage), { accepted: true });
	assert.deepEqual(resolveJsxUsage(usage), { accepted: true });
	assert.equal(providerCount, 1);
});
