import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('selected TypeScript generic usage can monomorphize a supported native callback boundary', async () => {
	const root = await fixtureRoot();
	await writeFile(
		join(root, 'src/library.d.ts'),
		'export declare function apply<T>(callback: (value: T) => T, value: T): T;\n',
		'utf8',
	);
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { apply } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard apply(callback, 1.5)\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.deepEqual(projection.descriptor.parameters, ['Float']);
	assert.equal(projection.descriptor.result, 'Float');
	assert.ok(result.semantic);
	const call = externalOperationSequence(result.semantic).find(operation => operation.kind === 'call' && operation.callableProjections !== undefined);
	assert.ok(call?.kind === 'call');
	assert.equal(call.decision.mechanism, 'callable-shim');
	assert.equal(call.decision.authoring, 'generated');
});
