import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';
import { TypeScriptInteropProvider } from '../src/index.js';

function request(importedName: string) {
	return {
		containingFile: join(process.cwd(), 'src', 'main.virune'),
		moduleSpecifier: 'node:path',
		kind: 'named' as const,
		importedName,
		platform: 'node' as const,
	};
}

test('TypeScriptInteropProvider reuses one language service per project platform', () => {
	let services = 0;
	let disposals = 0;
	const provider = new TypeScriptInteropProvider({
		projectRoot: process.cwd(),
		createLanguageService: host => {
			services++;
			const service = ts.createLanguageService(host);
			return new Proxy(service, {
				get(target, property, receiver) {
					if (property === 'dispose') return () => {
						disposals++;
						target.dispose();
					};
					return Reflect.get(target, property, receiver) as unknown;
				},
			});
		},
	});

	const joinResolution = provider.resolveImport(request('join'));
	const resolveResolution = provider.resolveImport(request('resolve'));
	assert.ok(joinResolution.type);
	assert.ok(resolveResolution.type);
	assert.equal(services, 1);

	provider.dispose();
	assert.equal(disposals, 1);
	assert.throws(() => provider.display(joinResolution.type!.ref), /Unknown JavaScript type handle/u);
});

test('CachedTypeScriptInteropProvider disposes its underlying language service generation', () => {
	let disposals = 0;
	const provider = new CachedTypeScriptInteropProvider({
		projectRoot: process.cwd(),
		createLanguageService: host => {
			const service = ts.createLanguageService(host);
			return new Proxy(service, {
				get(target, property, receiver) {
					if (property === 'dispose') return () => {
						disposals++;
						target.dispose();
					};
					return Reflect.get(target, property, receiver) as unknown;
				},
			});
		},
	});
	provider.resolveImport(request('join'));
	provider.dispose();
	assert.equal(disposals, 1);
	assert.equal(provider.cachedImportCount, 0);
});
