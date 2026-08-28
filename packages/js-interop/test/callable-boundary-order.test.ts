import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileOrderedCallbackFixture() {
	const root = await fixtureRoot();
	await writeFile(
		join(root, 'src/library.d.ts'),
		'export declare function suffix(): string;\nexport declare function consume(callback: (value: number) => number, suffix: string): void;\n',
		'utf8',
	);
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { suffix, consume } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback, suffix())\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
}

test('stable callable evidence locates projection before later effectful argument operations', async () => {
	const first = await compileOrderedCallbackFixture();
	const second = await compileOrderedCallbackFixture();
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(first.semantic);
	assert.ok(second.semantic);

	const projection = first.semantic.interop.callableProjections?.[0];
	assert.ok(projection);
	const operations = externalOperationSequence(first.semantic);
	const outerCallIndex = operations.findIndex(operation => operation.kind === 'call' && operation.nodeId === projection.callNodeId);
	const laterArgumentCallIndex = operations.findIndex(operation => operation.kind === 'call' && operation.nodeId !== projection.callNodeId);
	assert.ok(laterArgumentCallIndex >= 0);
	assert.ok(outerCallIndex > laterArgumentCallIndex);
	const outerCall = operations[outerCallIndex];
	assert.ok(outerCall?.kind === 'call');
	const stableProjection = outerCall.callableProjections?.[0];
	assert.ok(stableProjection);
	assert.equal(stableProjection.argumentIndex, 0);
	assert.equal(stableProjection.beforeOperationIndex, laterArgumentCallIndex);
	assert.ok(stableProjection.beforeOperationIndex < outerCallIndex);
	assert.match(first.output?.code ?? '', /consume\(\$viruneProjectCallable\(callback,[\s\S]*?\), suffix\(\)\)/u);

	assert.deepEqual(externalOperationSequence(second.semantic), operations);
});
