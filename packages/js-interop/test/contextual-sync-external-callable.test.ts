import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileCase(source: string) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), `
export interface ExternalRun {
  readonly changes: number;
}
export interface WrongRun {
  readonly wrong: true;
}
export interface ExternalTx {
  run(value: string): ExternalRun;
  wrong(): WrongRun;
}
export declare function transaction<T>(callback: (tx: ExternalTx) => T): T;
export declare function strictTransaction(callback: (tx: ExternalTx) => ExternalRun): ExternalRun;
export declare function anyTransaction(callback: (tx: any) => ExternalRun): ExternalRun;
export declare function unknownTransaction(callback: (tx: unknown) => ExternalRun): ExternalRun;
export declare function callbackFirst<T>(callback: (tx: ExternalTx) => T, marker: string): T;
`, 'utf8');
	await writeFile(join(root, 'src/library.js'), `
const tx = {
  run() { return { changes: 1 }; },
  wrong() { return { wrong: true }; },
};
export function transaction(callback) { return callback(tx); }
export function strictTransaction(callback) { return callback(tx); }
export function anyTransaction(callback) { return callback(tx); }
export function unknownTransaction(callback) { return callback(tx); }
export function callbackFirst(callback, _marker) { return callback(tx); }
`, 'utf8');
	return compileSource(
		{ id: 1, path: join(root, 'src/main.virune'), text: source },
		{ platform: 'node', jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) },
	);
}

function errorCodes(result: Awaited<ReturnType<typeof compileCase>>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('contextual sync callback uses provisional parameter evidence and final generic call proof', async () => {
	const result = await compileCase(`import js { transaction } from "./library.js"

fn main() -> Unit uses JavaScript {
	let result = transaction(fn(tx) uses JavaScript => tx.run("ok"))
	discard result.changes
	return Unit
}
`);
	assert.deepEqual(errorCodes(result), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.equal(projection.descriptor.version, 'virune-callable-shim/v2');
	assert.deepEqual(projection.descriptor.parameters, ['External']);
	assert.equal(projection.descriptor.result, 'External');
	assert.equal(projection.descriptor.async, false);
	const code = result.output?.code ?? '';
	assert.match(code, /\$viruneProjectCallable\(/u);
	assert.match(code, /\$fn\(\$raw0, rootTaskContext\(\)\)/u);
	assert.doesNotMatch(code, /async \(\$raw0\)/u);
	assert.doesNotMatch(code, /await \$fn\(\$raw0/u);
});

test('sync contextual callback result is rejected when final TypeScript usage is incompatible', async () => {
	const result = await compileCase(`import js { strictTransaction } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard strictTransaction(fn(tx) uses JavaScript => tx.wrong())
	return Unit
}
`);
	assert.ok(errorCodes(result).includes('L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('sync contextual any and unknown parameters remain fail closed', async () => {
	for (const name of ['anyTransaction', 'unknownTransaction'] as const) {
		const result = await compileCase(`import js { ${name} } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard ${name}(fn(tx) => panic("no unsafe contextual projection"))
	return Unit
}
`);
		assert.ok(errorCodes(result).includes('L4204'), `${name} must fail closed`);
		assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
	}
});

test('non-last unannotated sync callback remains fail closed', async () => {
	const result = await compileCase(`import js { callbackFirst } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard callbackFirst(fn(tx) uses JavaScript => tx.run("ok"), "ordered")
	return Unit
}
`);
	assert.notEqual(errorCodes(result).length, 0);
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});
