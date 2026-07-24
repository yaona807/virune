import assert from 'node:assert/strict';
import test from 'node:test';
import type { JsImportResolution, JsInteropProvider } from '@virune/compiler/experimental';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';
import type { TypeScriptInteropProvider } from '../src/index.js';

const resolution: JsImportResolution = {
	type: {
		ref: { providerId: 'typescript', generation: 1, id: '1' },
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

test('repeated identical imports retain one cached resolution', () => {
	let resolutions = 0;
	const fake: JsInteropProvider = {
		id: 'typescript',
		version: 'typescript-test',
		generation: 1,
		resolveImport: () => {
			resolutions++;
			return resolution;
		},
		getProperty: () => undefined,
		resolveCall: () => undefined,
		resolveConstruct: () => undefined,
		getAwaitedType: () => undefined,
		display: () => 'cached',
	};
	const provider = new CachedTypeScriptInteropProvider({
		projectRoot: '/workspace',
		generation: 1,
		createProvider: () => fake as TypeScriptInteropProvider,
	});
	const request = {
		containingFile: '/workspace/src/main.virune',
		moduleSpecifier: 'node:path',
		kind: 'named' as const,
		importedName: 'join',
		platform: 'node' as const,
	};

	for (let iteration = 0; iteration < 10_000; iteration++) provider.resolveImport(request);
	assert.equal(resolutions, 1);
	assert.equal(provider.cachedImportCount, 1);
	provider.dispose();
	assert.equal(provider.cachedImportCount, 0);
});
