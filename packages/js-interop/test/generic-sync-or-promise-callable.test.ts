import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileFixture(declarations: string, source: string) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: provider });
}

test('generic sync-or-promise callback result keeps the accepted synchronous Unit branch', async () => {
	const result = await compileFixture(
		`export interface TaskOptions { readonly token: string; }
export type Task<T> = ((options: TaskOptions) => PromiseLike<T>) | ((options: TaskOptions) => T);
export declare function enqueue<T>(task: Task<T>): Promise<T>;
`,
		`import js { enqueue } from "./library.js"

async fn main() -> Unit uses JavaScript {
	let result = await enqueue(fn() -> Unit uses JavaScript {
		return Unit
	})
	discard result
	return Unit
}
`,
	);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.deepEqual(projection.descriptor, {
		version: 'virune-callable-shim/v1',
		parameters: [],
		result: 'Unit',
		async: false,
		effects: ['JavaScript'],
		contextMode: 'root-argument',
	});
});

test('promise-only generic callback still rejects a synchronous Unit boundary', async () => {
	const result = await compileFixture(
		`export interface TaskOptions { readonly token: string; }
export declare function promiseOnly<T>(task: (options: TaskOptions) => PromiseLike<T>): Promise<T>;
`,
		`import js { promiseOnly } from "./library.js"

fn main() -> Unit uses JavaScript {
	let result = promiseOnly(fn() -> Unit uses JavaScript {
		return Unit
	})
	discard result
	return Unit
}
`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});
