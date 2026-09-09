import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, type JsInteropProvider } from '@virune/compiler/experimental';
import ts from 'typescript';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('Array and ReadonlyArray provide stable repetition element evidence', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare const mutableValues: string[];',
		'export declare const readonlyValues: ReadonlyArray<string>;',
		'',
	].join('\n'), 'utf8');
	const provider: JsInteropProvider = new TypeScriptInteropProvider({ projectRoot: root });
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
		const element = provider.resolveArrayElement?.(imported.type.ref);
		assert.equal(element?.category, 'primitive', importedName);
		assert.equal(element?.primitive, 'string', importedName);
	}
});

test('ReadonlyArray repetition emits stable source-index traversal without map semantics', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare const readonlyValues: ReadonlyArray<string>;',
		'declare global {',
		'\tnamespace JSX {',
		'\t\tinterface Element { readonly __jsxElementBrand: unique symbol; }',
		'\t\tinterface IntrinsicElements {',
		'\t\t\tspan: { value: string; index: number };',
		'\t\t}',
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
	assert.match(code, /if \(!Object\.prototype\.hasOwnProperty\.call\(\$viewSource\d+, \$viewIndex\d+\)\) continue;/u);
	assert.match(code, /const value = \$viewSource\d+\[\$viewIndex\d+\];/u);
	assert.match(code, /const index = \$viewIndex\d+;/u);
	assert.ok(code.includes('.push(<span value={value} index={index} />);'));
	assert.ok(!code.includes('.map('));
});

test('External Array call result can be repeated directly in View', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare function getValues(): ReadonlyArray<string>;',
		'declare global {',
		'\tnamespace JSX {',
		'\t\tinterface Element { readonly __jsxElementBrand: unique symbol; }',
		'\t\tinterface IntrinsicElements {',
		'\t\t\tspan: { value: string };',
		'\t\t}',
		'\t}',
		'}',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { jsx: ts.JsxEmit.Preserve } });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { getValues } from "./library.js"\n\ncomponent Values() uses JavaScript {\n\treturn view {\n\t\tfor value in getValues() {\n\t\t\tspan(value: value)\n\t\t}\n\t}\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	assert.match(result.output.code, /const \$viewSource\d+ = getValues\(\);/u);
});

test('empty native List repetition remains valid without collection helpers', () => {
	const provider: JsInteropProvider = {
		id: 'view-repetition-test',
		version: '1',
		generation: 1,
		resolveImport: () => { throw new Error('unexpected import'); },
		getProperty: () => undefined,
		resolveCall: () => undefined,
		resolveConstruct: () => undefined,
		getAwaitedType: () => undefined,
		display: () => '<unused>',
		resolveJsxUsage: () => ({ accepted: true }),
	};
	const result = compileSource({
		id: 1,
		path: 'empty-view-repetition.virune',
		text: `component EmptyView() uses JavaScript {\n\tlet items: List<Int> = []\n\treturn view {\n\t\tfor item in items {\n\t\t\tspan(value: item)\n\t\t}\n\t}\n}\n`,
	}, { jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	assert.match(result.output.code, /const \$viewSource\d+ = items;/u);
	assert.ok(!result.output.code.includes('.map('));
});
