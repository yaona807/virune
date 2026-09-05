import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileWithDeclarations(declarations: string, sourceText: string) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: sourceText }, { platform: 'node', jsInteropProvider: provider });
}

const floatCallbackSource = `import js { consume } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`;

test('accepts a proved erased explicit this receiver without adding it to the callable boundary', async () => {
	const result = await compileWithDeclarations(
		'interface Context { readonly scale: number }\nexport declare function consume(callback: (this: Context, value: number) => number): void;\n',
		floatCallbackSource,
	);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.deepEqual(projection.descriptor, {
		version: 'virune-callable-shim/v1',
		parameters: ['Float'],
		result: 'Float',
		async: false,
		effects: [],
		contextMode: 'root-argument',
	});
});

test('discharges an any callback result only as synchronous Unit to undefined after whole-usage proof', async () => {
	const declarations = 'interface Context { readonly id: string }\nexport declare function consume(callback: (this: Context) => any): void;\n';
	const accepted = await compileWithDeclarations(
		declarations,
		`import js { consume } from "./library.js"\n\nfn callback() -> Unit {\n\treturn Unit\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(accepted.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(accepted.semantic?.interop.callableProjections?.[0]?.descriptor, {
		version: 'virune-callable-shim/v1',
		parameters: [],
		result: 'Unit',
		async: false,
		effects: [],
		contextMode: 'root-argument',
	});

	const nonUnit = await compileWithDeclarations(
		declarations,
		`import js { consume } from "./library.js"\n\nfn callback() -> String {\n\treturn "value"\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.ok(nonUnit.diagnostics.some(item => item.code === 'L4204'));

	const asyncUnit = await compileWithDeclarations(
		declarations,
		`import js { consume } from "./library.js"\n\nasync fn callback() -> Unit {\n\treturn Unit\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.ok(asyncUnit.diagnostics.some(item => item.code === 'L4204'));
});
