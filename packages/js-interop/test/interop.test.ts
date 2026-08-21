import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import {
	compileSource,
	externalOperationSequence,
	isResolvedDirectInteropDecision,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('TypeScript provider resolves a conservative primitive facade', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: './library.js',
		kind: 'named',
		importedName: 'greet',
		platform: 'node',
	});
	assert.equal(imported.type?.category, 'function');
	assert.ok(imported.type);
	const result = provider.resolveCall(imported.type.ref, [{ kind: 'native-primitive', primitive: 'String' }]);
	assert.equal(result?.result.primitive, 'string');
});

test('compiler emits direct JavaScript import, checked primitive bridge, and provider-independent operations', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const source = {
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { greet } from "./library.js"\n\nfn main() -> String uses JavaScript {\n\treturn greet("Virune")\n}\n`,
	};
	const result = compileSource(source, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.match(result.output?.code ?? '', /import \{ greet \} from "\.\/library\.js"/u);
	assert.match(result.output?.code ?? '', /checkForeignString\(greet\("Virune"\)\)/u);
	const usage = result.semantic?.interop.usageIR.find(item => item.kind === 'call');
	assert.ok(usage);
	assert.equal('ref' in usage.foreignType, false);
	assert.doesNotThrow(() => JSON.stringify(result.semantic?.interop.usageIR));

	assert.ok(result.ast);
	assert.ok(result.semantic);
	const operations = externalOperationSequence({
		module: result.ast,
		semantic: result.semantic,
	});
	assert.deepEqual(operations.map(operation => operation.kind), [
		'module-load',
		'call',
		'bridge-foreign-primitive',
	]);
	assert.equal(operations[0]?.kind, 'module-load');
	if (operations[0]?.kind === 'module-load') {
		assert.equal(operations[0].moduleSpecifier, './library.js');
		assert.equal(isResolvedDirectInteropDecision(operations[0].decision), true);
		assert.equal(operations[0].runtimeWitness?.runtimeFormat, 'esm');
	}
	assert.equal(operations[1]?.kind, 'call');
	assert.equal(operations[2]?.kind, 'bridge-foreign-primitive');
	const serialized = JSON.stringify(operations);
	assert.equal(serialized.includes(root.replaceAll('\\', '/')), false);
	assert.equal(serialized.includes('providerVersion'), false);
	assert.equal(serialized.includes('declarationEntry'), false);
	assert.equal(serialized.includes('declarationGraphHash'), false);
});

test('public operation derivation cannot omit errors from the semantic model', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		const result = compileSource({
			id: 1,
			path: join(root, 'src/main.virune'),
			text: `import js { greet } from "./library.js"\n\nfn main() -> String {\n\treturn greet("Virune")\n}\n`,
		}, { platform: 'node', jsInteropProvider: provider });
		assert.ok(result.ast);
		assert.ok(result.semantic);
		assert.ok(result.semantic.diagnostics.items.some(item => item.severity === 'error'));
		assert.deepEqual(externalOperationSequence({ module: result.ast, semantic: result.semantic }), []);
	} finally {
		provider.dispose();
	}
});

test('real TypeScript provider maps property, receiver-preserving call, and foreign await semantics into External Operations', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface Item { value: string }',
		'export declare const item: Item;',
		'export interface Api { method(this: Api, value: "foo"): "member" }',
		'export declare const api: Api;',
		'export declare function makeItemAsync(): Promise<Item>;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export const item = { value: "value" };',
		'export const api = { method() { return "member"; } };',
		'export async function makeItemAsync() { return item; }',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		const result = compileSource({
			id: 1,
			path: join(root, 'src/main.virune'),
			text: [
				'import js { item, api, makeItemAsync } from "./library.js"',
				'',
				'fn property() -> String uses JavaScript {',
				'\treturn item.value',
				'}',
				'',
				'fn member() -> String uses JavaScript {',
				'\treturn api.method("foo")',
				'}',
				'',
				'async fn awaited() -> String uses JavaScript {',
				'\tlet resolved = await makeItemAsync()',
				'\treturn resolved.value',
				'}',
				'',
			].join('\n'),
		}, { platform: 'node', jsInteropProvider: provider });
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		assert.ok(result.ast);
		assert.ok(result.semantic);

		const operations = externalOperationSequence({
			module: result.ast,
			semantic: result.semantic,
		});
		assert.deepEqual(operations.map(operation => operation.kind), [
			'module-load',
			'read-property',
			'bridge-foreign-primitive',
			'read-property',
			'call',
			'bridge-foreign-primitive',
			'call',
			'await',
			'read-property',
			'bridge-foreign-primitive',
		]);
		const calls = operations.filter(operation => operation.kind === 'call');
		assert.equal(calls.length, 2);
		assert.equal(calls[0]?.receiverMode, 'preserve-this');
		assert.equal(calls[0]?.mayReject, false);
		assert.deepEqual(calls[0]?.decision.claims, ['receiver-preserved']);
		assert.equal(calls[1]?.receiverMode, 'none');
		assert.equal(calls[1]?.mayReject, true);
		const awaited = operations.find(operation => operation.kind === 'await');
		assert.equal(awaited?.mayReject, true);
		assert.equal(operations.filter(operation => operation.kind === 'read-property').length, 3);
	} finally {
		provider.dispose();
	}
});
