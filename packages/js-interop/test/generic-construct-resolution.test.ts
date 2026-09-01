import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function errorCodes(result: ReturnType<typeof compileSource>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

async function compileQueue(root: string, declaration: string) {
	await writeFile(join(root, 'src/library.d.ts'), declaration, 'utf8');
	await writeFile(join(root, 'src/library.js'), [
		'export class WorkQueue {',
		'  constructor(options = {}) { this.concurrency = options.concurrency ?? Infinity; }',
		'}',
		'',
	].join('\n'), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { WorkQueue } from "./library.js"\n\nfn main() -> Float uses JavaScript {\n\tlet queue = WorkQueue({ concurrency: 1 })\n\treturn queue.concurrency\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
}

function assertQueueConstructed(result: ReturnType<typeof compileSource>): void {
	assert.deepEqual(errorCodes(result), []);
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'construct'), true);
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'object'), true);
}

test('accepts a concretely defaulted generic constructor when the default type contains a nested any property', async () => {
	const root = await fixtureRoot();
	const result = await compileQueue(root, [
		'export interface QueueLike { readonly signal?: { readonly reason: any } }',
		'export declare class WorkQueue<Q extends QueueLike = QueueLike> {',
		'  constructor(options?: { readonly concurrency?: number });',
		'  readonly concurrency: number;',
		'}',
		'',
	].join('\n'));
	assertQueueConstructed(result);
});

test('accepts a concretely defaulted generic constructor when the default type contains an any index value', async () => {
	const root = await fixtureRoot();
	const result = await compileQueue(root, [
		'export interface QueueLike { readonly [key: string]: any }',
		'export declare class WorkQueue<Q extends QueueLike = QueueLike> {',
		'  constructor(options?: { readonly concurrency?: number });',
		'  readonly concurrency: number;',
		'}',
		'',
	].join('\n'));
	assertQueueConstructed(result);
});

test('still rejects a constructor whose result generic is unresolved', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare class Unresolved<T> {',
		'  constructor();',
		'  readonly value: T;',
		'}',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export class Unresolved {}\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 2,
		path: join(root, 'src/main.virune'),
		text: `import js { Unresolved } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard Unresolved()\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });

	assert.deepEqual(errorCodes(result), ['L4204']);
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'construct'), false);
});
