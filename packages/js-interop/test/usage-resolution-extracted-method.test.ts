import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	compileSource,
	type ForeignTypeSnapshot,
	type InteropCallUsage,
	type JsInteropProvider,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function resolveNamed(provider: TypeScriptInteropProvider, root: string, importedName: string): ForeignTypeSnapshot {
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: './library.js',
		kind: 'named',
		importedName,
		platform: 'node',
	});
	assert.ok(imported.type);
	return imported.type;
}

function resolveUsage(provider: JsInteropProvider, callee: ForeignTypeSnapshot, usage: InteropCallUsage) {
	assert.ok(provider.resolveCallUsage, 'provider must expose the experimental whole-usage resolver at runtime');
	return provider.resolveCallUsage(callee.ref, usage);
}

function errorCodes(result: ReturnType<typeof compileSource>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('extracted dynamic-this methods fail closed without rejecting function-valued properties', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export interface Api {',
		'  method(value: "foo"): "method";',
		'  functionProperty: (value: "foo") => "function-property";',
		'}',
		'export declare const api: Api;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export const api = {',
		'  method(value) {',
		'    if (this !== api) throw new Error("receiver required");',
		'    return "method";',
		'  },',
		'  functionProperty: (value) => "function-property",',
		'};',
		'',
	].join('\n'), 'utf8');

	const literal = {
		kind: 'native-primitive' as const,
		primitive: 'String' as const,
		literal: { kind: 'String' as const, value: 'foo' },
	};

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const interopProvider: JsInteropProvider = provider;
	const api = resolveNamed(provider, root, 'api');
	const method = provider.getProperty(api.ref, 'method');
	const functionProperty = provider.getProperty(api.ref, 'functionProperty');
	assert.ok(method);
	assert.ok(functionProperty);

	assert.equal(
		resolveUsage(interopProvider, method, { target: { kind: 'value' }, arguments: [literal] }),
		undefined,
		'a normal method extracted from its receiver must not be treated as a safe direct value call',
	);
	assert.equal(
		resolveUsage(interopProvider, method, { target: { kind: 'member', receiver: api.ref, property: 'method' }, arguments: [literal] })?.result.display,
		'"method"',
		'a direct member call must preserve the receiver and remain resolvable',
	);
	assert.equal(
		resolveUsage(interopProvider, functionProperty, { target: { kind: 'value' }, arguments: [literal] })?.result.display,
		'"function-property"',
		'a function-valued property has value-call semantics and must not be rejected as a method',
	);

	const direct = compileSource({
		id: 1,
		path: join(root, 'src/direct.virune'),
		text: 'import js { api } from "./library.js"\n\nfn use() -> String uses JavaScript {\n\treturn api.method("foo")\n}\n',
	}, { platform: 'node', jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) });
	assert.deepEqual(errorCodes(direct), []);

	const extractedMethod = compileSource({
		id: 2,
		path: join(root, 'src/extracted-method.virune'),
		text: 'import js { api } from "./library.js"\n\nfn use() -> String uses JavaScript {\n\tlet method = api.method\n\treturn method("foo")\n}\n',
	}, { platform: 'node', jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) });
	assert.deepEqual(errorCodes(extractedMethod), ['L4204']);

	const extractedFunctionProperty = compileSource({
		id: 3,
		path: join(root, 'src/extracted-function-property.virune'),
		text: 'import js { api } from "./library.js"\n\nfn use() -> String uses JavaScript {\n\tlet callable = api.functionProperty\n\treturn callable("foo")\n}\n',
	}, { platform: 'node', jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) });
	assert.deepEqual(errorCodes(extractedFunctionProperty), []);
});
