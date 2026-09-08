import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import ts from 'typescript';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

const indexUsage = { index: { kind: 'native-primitive', primitive: 'Int' } } as const;

test('Array and ReadonlyArray provide stable indexed repetition evidence', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare const mutableValues: string[];',
		'export declare const readonlyValues: ReadonlyArray<string>;',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	for (const importedName of ['mutableValues', 'readonlyValues']) {
		const imported = provider.resolveImport({
			containingFile: join(root, 'src/main.virune'),
			moduleSpecifier: './library.js',
			kind: 'named',
			importedName,
			platform: 'node',
		});
		assert.equal(imported.type?.category, 'array', importedName);
		assert.ok(imported.type);
		const indexed = provider.resolveIndexUsage?.(imported.type.ref, indexUsage);
		assert.equal(indexed?.result.category, 'primitive', importedName);
		assert.equal(indexed?.result.primitive, 'string', importedName);
	}
});

test('ReadonlyArray repetition emits stable source-index traversal without map semantics', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare const readonlyValues: ReadonlyArray<string>;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/jsx.d.ts'), [
		'declare namespace JSX {',
		'\tinterface Element { readonly __jsxElementBrand: unique symbol; }',
		'\tinterface IntrinsicElements {',
		'\t\tspan: { value: string; index: number };',
		'\t}',
		'}',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { jsx: ts.JsxEmit.Preserve } });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { readonlyValues } from "./library.js"\n\ncomponent Values() uses JavaScript {\n\treturn view {\n\t\tfor value, index in readonlyValues {\n\t\t\tspan(value: value, index: index)\n\t\t}\n\t}\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	const code = result.output.code;
	assert.match(code, /const \$viewSource\d+ = readonlyValues;/u);
	assert.match(code, /const \$viewLength\d+ = \$viewSource\d+\.length;/u);
	assert.match(code, /if \(!\(\$viewIndex\d+ in \$viewSource\d+\)\) continue;/u);
	assert.match(code, /const value = \$viewSource\d+\[\$viewIndex\d+\];/u);
	assert.match(code, /const index = \$viewIndex\d+;/u);
	assert.ok(code.includes('.push(<span value={value} index={index} />);'));
	assert.ok(!code.includes('.map('));
});
