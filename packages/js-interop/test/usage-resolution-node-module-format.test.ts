import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { JsInteropProvider } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('Node usage probes stay on import conditions inside a CommonJS project scope', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'package.json'), '{"type":"commonjs"}\n', 'utf8');
	const packageRoot = join(root, 'node_modules', 'conditional-format-runtime');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify({
		name: 'conditional-format-runtime',
		version: '1.0.0',
		type: 'module',
		exports: {
			'.': {
				import: { types: './import.d.ts', default: './import.mjs' },
				require: { types: './require.d.ts', default: './require.cjs' },
			},
		},
	}, null, 2)}\n`, 'utf8');
	await writeFile(join(packageRoot, 'import.d.ts'), 'declare function value(input: "import"): "import";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'require.d.ts'), 'declare function value(input: "require"): "require";\nexport default value;\n', 'utf8');
	await writeFile(join(packageRoot, 'import.mjs'), 'export default input => input;\n', 'utf8');
	await writeFile(join(packageRoot, 'require.cjs'), 'module.exports = input => input;\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: 'conditional-format-runtime',
		kind: 'default',
		platform: 'node',
	});
	assert.ok(imported.type);
	assert.equal(imported.witness.declarationEntry, 'import.d.ts');
	assert.equal(imported.witness.runtimeEntry, 'import.mjs');

	const interopProvider: JsInteropProvider = provider;
	assert.ok(interopProvider.resolveCallUsage);
	const accepted = interopProvider.resolveCallUsage(imported.type.ref, {
		target: { kind: 'value' },
		arguments: [{ kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'import' } }],
	});
	assert.ok(accepted);
	assert.equal(accepted.result.display, '"import"');
	assert.equal(interopProvider.resolveCallUsage(imported.type.ref, {
		target: { kind: 'value' },
		arguments: [{ kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'require' } }],
	}), undefined);
});
