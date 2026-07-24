import assert from 'node:assert/strict';
import test from 'node:test';
import type {
	ForeignTypeRef,
	JsImportRequest,
	JsImportResolution,
	JsInteropProvider,
} from '@virune/compiler/experimental';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';
import type { TypeScriptInteropProvider } from '../src/index.js';

function request(overrides: Partial<JsImportRequest> = {}): JsImportRequest {
	return {
		containingFile: '/workspace/src/main.virune',
		moduleSpecifier: 'node:path',
		kind: 'named',
		importedName: 'join',
		platform: 'node',
		...overrides,
	};
}

function resolution(generation: number, id: string): JsImportResolution {
	return {
		type: {
			ref: { providerId: 'typescript', generation, id },
			display: '(left: string, right: string) => string',
			category: 'function',
		},
		runtime: { kind: 'named', importedName: 'join' },
		witness: {
			moduleSpecifier: 'node:path',
			conditions: ['types', 'import', 'node'],
			platform: 'node',
			providerVersion: 'typescript-test',
		},
	};
}

test('CachedTypeScriptInteropProvider caches the complete import request key', () => {
	let calls = 0;
	const fake: JsInteropProvider = {
		id: 'typescript',
		version: 'typescript-test',
		generation: 7,
		resolveImport: () => resolution(7, String(++calls)),
		getProperty: () => undefined,
		resolveCall: () => undefined,
		resolveConstruct: () => undefined,
		getAwaitedType: () => undefined,
		display: () => 'cached',
	};
	const provider = new CachedTypeScriptInteropProvider({
		projectRoot: '/workspace',
		generation: 7,
		createProvider: () => fake as TypeScriptInteropProvider,
	});

	const first = provider.resolveImport(request());
	const second = provider.resolveImport(request());
	assert.equal(second, first);
	assert.equal(calls, 1);
	assert.equal(provider.cachedImportCount, 1);

	provider.resolveImport(request({ importedName: 'resolve' }));
	provider.resolveImport(request({ containingFile: '/workspace/test/main.virune' }));
	provider.resolveImport(request({ platform: 'browser' }));
	assert.equal(calls, 4);
	assert.equal(provider.cachedImportCount, 4);
});

test('disposing a cached provider releases its generation and rejects old handles', () => {
	const reference: ForeignTypeRef = { providerId: 'typescript', generation: 3, id: '1' };
	const fake: JsInteropProvider = {
		id: 'typescript',
		version: 'typescript-test',
		generation: 3,
		resolveImport: () => resolution(3, '1'),
		getProperty: () => undefined,
		resolveCall: () => undefined,
		resolveConstruct: () => undefined,
		getAwaitedType: () => undefined,
		display: () => 'before dispose',
	};
	const provider = new CachedTypeScriptInteropProvider({
		projectRoot: '/workspace',
		generation: 3,
		createProvider: () => fake as TypeScriptInteropProvider,
	});
	provider.resolveImport(request());
	assert.equal(provider.display(reference), 'before dispose');

	provider.dispose();
	assert.equal(provider.cachedImportCount, 0);
	assert.throws(() => provider.display(reference), /Disposed JavaScript interop provider generation/u);
	assert.throws(() => provider.resolveImport(request()), /Disposed JavaScript interop provider generation/u);
});
