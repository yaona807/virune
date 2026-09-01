import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { ForeignTypeSnapshot, JsInteropProvider } from '@virune/compiler/experimental';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function resolveNamed(
	provider: JsInteropProvider,
	root: string,
	moduleSpecifier: string,
	importedName: string,
	platform: 'node' | 'browser' | 'neutral',
): ForeignTypeSnapshot {
	const resolution = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier,
		kind: 'named',
		importedName,
		platform,
	});
	assert.ok(resolution.type);
	return resolution.type;
}

function callResult(provider: JsInteropProvider, callee: ForeignTypeSnapshot): ForeignTypeSnapshot {
	assert.ok(provider.resolveCallUsage);
	const resolution = provider.resolveCallUsage(callee.ref, { target: { kind: 'value' }, arguments: [] });
	assert.ok(resolution);
	return resolution.result;
}

async function writeModule(root: string, name: string, declaration: string, runtime = 'export async function load() { return "ok"; }\n'): Promise<void> {
	await writeFile(join(root, 'src', `${name}.d.ts`), declaration, 'utf8');
	await writeFile(join(root, 'src', `${name}.js`), runtime, 'utf8');
}

async function writePackage(root: string, packageName: string): Promise<void> {
	const directory = join(root, 'node_modules', packageName);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, 'package.json'), JSON.stringify({
		name: packageName,
		version: '1.0.0',
		type: 'module',
		exports: { '.': { types: './index.d.ts', import: './index.js' } },
	}), 'utf8');
	await writeFile(join(directory, 'index.d.ts'), 'export declare function load(): Promise<string>;\n', 'utf8');
	await writeFile(join(directory, 'index.js'), 'export async function load() { return "ok"; }\n', 'utf8');
}

// @virune-rule {"id":"interop.ecmascript-canonical-identity","runner":"unit","file":"packages/js-interop/test/canonical-promise-identity.test.ts","case":"global ECMAScript Promise keeps one canonical identity across declaration origins","kind":"positive","platform":"common"}
test('global ECMAScript Promise keeps one canonical identity across declaration origins', async () => {
	const root = await fixtureRoot();
	try {
		await writeModule(root, 'standard', 'export declare function load(): Promise<string>;\n');
		await writeModule(root, 'web', 'export declare function load(): Promise<Response>;\n');
		await writeModule(root, 'node', 'export declare function load(): Promise<import("node:buffer").Buffer>;\n');
		await writeModule(root, 'structural', [
			'export interface Thenable<T> { then<TResult>(onfulfilled: (value: T) => TResult): Thenable<TResult> }',
			'export declare function load(): Thenable<string>;',
			'',
		].join('\n'));
		await writePackage(root, 'promise-fixture-a');
		await writePackage(root, 'promise-fixture-renamed');

		const provider = new TypeScriptInteropProvider({ projectRoot: root });
		for (const [moduleSpecifier, platform] of [
			['./standard.js', 'neutral'],
			['./web.js', 'browser'],
			['./node.js', 'node'],
			['promise-fixture-a', 'node'],
			['promise-fixture-renamed', 'node'],
		] as const) {
			const result = callResult(provider, resolveNamed(provider, root, moduleSpecifier, 'load', platform));
			assert.equal(result.category, 'promise');
			assert.equal(result.canonicalIdentity, 'ecmascript:Promise');
		}

		const structural = callResult(provider, resolveNamed(provider, root, './structural.js', 'load', 'neutral'));
		assert.equal(structural.canonicalIdentity, undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// @virune-rule {"id":"interop.ecmascript-canonical-identity","runner":"unit","file":"packages/js-interop/test/canonical-promise-identity.test.ts","case":"Promise canonical identity is deterministic across provider cache and equivalent roots","kind":"determinism","platform":"common"}
test('Promise canonical identity is deterministic across provider cache and equivalent roots', async () => {
	const roots = [await fixtureRoot(), await fixtureRoot()];
	try {
		for (const root of roots) await writeModule(root, 'standard', 'export declare function load(): Promise<string>;\n');
		const direct = new TypeScriptInteropProvider({ projectRoot: roots[0]! });
		const cached = new CachedTypeScriptInteropProvider({ projectRoot: roots[0]! });
		const equivalent = new TypeScriptInteropProvider({ projectRoot: roots[1]! });
		const request = (root: string) => ({
			containingFile: join(root, 'src/main.virune'),
			moduleSpecifier: './standard.js',
			kind: 'named' as const,
			importedName: 'load',
			platform: 'neutral' as const,
		});

		const directImport = direct.resolveImport(request(roots[0]!));
		const cachedFirst = cached.resolveImport(request(roots[0]!));
		const cachedSecond = cached.resolveImport(request(roots[0]!));
		const equivalentImport = equivalent.resolveImport(request(roots[1]!));
		assert.ok(directImport.type && cachedFirst.type && cachedSecond.type && equivalentImport.type);
		const identities = [
			callResult(direct, directImport.type).canonicalIdentity,
			callResult(cached, cachedFirst.type).canonicalIdentity,
			callResult(cached, cachedSecond.type).canonicalIdentity,
			callResult(equivalent, equivalentImport.type).canonicalIdentity,
		];
		assert.deepEqual(identities, Array(identities.length).fill('ecmascript:Promise'));
		assert.equal(cached.cachedImportCount, 1);
	} finally {
		await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
	}
});

// @virune-rule {"id":"interop.ecmascript-canonical-identity","runner":"unit","file":"packages/js-interop/test/canonical-promise-identity.test.ts","case":"stale provider generation cannot resolve canonical Promise identity","kind":"negative","platform":"common"}
test('stale provider generation cannot resolve canonical Promise identity', async () => {
	const root = await fixtureRoot();
	try {
		await writeModule(root, 'standard', 'export declare function load(): Promise<string>;\n');
		const first = new TypeScriptInteropProvider({ projectRoot: root, providerId: 'typescript', generation: 1 });
		const stale = resolveNamed(first, root, './standard.js', 'load', 'neutral').ref;
		const second = new TypeScriptInteropProvider({ projectRoot: root, providerId: 'typescript', generation: 2 });
		assert.throws(() => second.resolveCall(stale, []), /Stale or foreign JavaScript type handle/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
