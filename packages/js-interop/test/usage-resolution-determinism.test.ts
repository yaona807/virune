import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, type JsInteropProvider } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function evidence(root: string) {
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		const containingFile = join(root, 'src/main.virune');
		const request = {
			containingFile,
			moduleSpecifier: './library.js',
			kind: 'named' as const,
			importedName: 'greet',
			platform: 'node' as const,
		};
		const imported = provider.resolveImport(request);
		const namespace = provider.resolveImport({
			containingFile,
			moduleSpecifier: './library.js',
			kind: 'namespace',
			platform: 'node',
		});
		assert.ok(imported.type);
		assert.ok(namespace.type);
		assert.equal(imported.type.navigation?.declarationPath, join(root, 'src/library.d.ts'));
		assert.equal(namespace.type.navigation?.declarationPath, join(root, 'src/library.d.ts'));
		assert.equal(Object.prototype.propertyIsEnumerable.call(imported.type, 'navigation'), false);
		assert.equal(Object.prototype.propertyIsEnumerable.call(namespace.type, 'navigation'), false);
		const serializedImported = JSON.stringify(imported.type);
		assert.equal(serializedImported.includes(root), false);
		assert.equal(serializedImported.includes('navigation'), false);

		const result = compileSource({
			id: 1,
			path: containingFile,
			text: 'import js { greet } from "./library.js"\n\nfn main() -> String uses JavaScript {\n\treturn greet("Virune")\n}\n',
		}, { platform: 'node', jsInteropProvider: provider });
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		assert.ok(result.semantic);
		const serializedUsageIR = JSON.stringify(result.semantic.interop.usageIR);
		assert.equal(serializedUsageIR.includes(root), false);
		assert.equal(serializedUsageIR.includes('navigation'), false);
		return {
			origin: imported.type.origin,
			witness: imported.witness,
			namespace: {
				display: namespace.type.display,
				origin: namespace.type.origin,
				witness: namespace.witness,
			},
			usageIR: result.semantic.interop.usageIR,
			moduleWitnesses: result.semantic.interop.moduleWitnesses,
		};
	} finally {
		provider.dispose();
	}
}

test('provider evidence remains canonical across different checkout roots', async () => {
	const firstRoot = await fixtureRoot();
	const secondRoot = await fixtureRoot();
	assert.notEqual(firstRoot, secondRoot);

	const first = await evidence(firstRoot);
	const second = await evidence(secondRoot);
	assert.deepEqual(second, first, 'stable provider/compiler evidence must not depend on the temporary checkout root');
	assert.equal(first.origin?.declarationPath, 'src/library.d.ts');
	assert.equal(first.witness.declarationEntry, 'src/library.d.ts');
	assert.equal(first.witness.runtimeEntry, 'src/library.js');
	assert.equal(first.namespace.origin?.declarationPath, 'src/library.d.ts');
	assert.equal(first.namespace.witness.declarationEntry, 'src/library.d.ts');
	assert.equal(first.namespace.witness.runtimeEntry, 'src/library.js');

	const serialized = JSON.stringify(first);
	assert.equal(serialized.includes(firstRoot), false);
	assert.equal(serialized.includes(secondRoot), false);
});

test('compiler stable usage IR strips enumerable provider navigation metadata', () => {
	const navigationLeak = '/provider-private/absolute/declaration.d.ts';
	const provider: JsInteropProvider = {
		id: 'enumerable-navigation-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			const importedName = request.importedName ?? 'value';
			return {
				type: {
					ref: { providerId: this.id, generation: this.generation, id: importedName },
					display: 'string',
					category: 'primitive',
					primitive: 'string',
					origin: { moduleSpecifier: request.moduleSpecifier, exportName: importedName, declarationPath: 'types.d.ts' },
					navigation: { declarationPath: navigationLeak },
				},
				runtime: { kind: 'named', importedName },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					declarationEntry: 'types.d.ts',
					runtimeEntry: 'runtime.js',
					runtimeFormat: 'esm',
					conditions: ['types', 'import', 'node'],
					platform: request.platform,
					providerVersion: this.version,
				},
			};
		},
		getProperty() { return undefined; },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'string'; },
	};

	const result = compileSource({
		id: 1,
		path: '/project/main.virune',
		text: 'import js { value } from "./external.js"\n\nfn main() -> Unit {\n\treturn Unit\n}\n',
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.semantic);
	const foreignType = result.semantic.interop.usageIR[0]?.foreignType;
	assert.ok(foreignType);
	assert.equal(Object.prototype.hasOwnProperty.call(foreignType, 'navigation'), false);
	const serialized = JSON.stringify(result.semantic.interop.usageIR);
	assert.equal(serialized.includes('navigation'), false);
	assert.equal(serialized.includes(navigationLeak), false);
});
