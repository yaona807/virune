import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
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
		const result = compileSource({
			id: 1,
			path: containingFile,
			text: 'import js { greet } from "./library.js"\n\nfn main() -> String uses JavaScript {\n\treturn greet("Virune")\n}\n',
		}, { platform: 'node', jsInteropProvider: provider });
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		assert.ok(result.semantic);
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
