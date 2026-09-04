import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileFixture(moduleName: string, declarations: string, source: string) {
	const root = await fixtureRoot();
	await writeFile(join(root, `src/${moduleName}.d.ts`), declarations, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: provider });
}

test('equivalent renamed JavaScript modules do not alter callable shim semantics', async () => {
	const declarations = 'export declare function consume(callback: (value: number) => number): void;\n';
	const first = await compileFixture(
		'first-library',
		declarations,
		`import js { consume } from "./first-library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	const second = await compileFixture(
		'renamed-library',
		declarations,
		`import js { consume } from "./renamed-library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);
	const firstProjection = first.semantic?.interop.callableProjections?.[0];
	const secondProjection = second.semantic?.interop.callableProjections?.[0];
	assert.ok(firstProjection);
	assert.ok(secondProjection);
	assert.deepEqual(firstProjection.descriptor, secondProjection.descriptor);
	assert.ok(first.semantic);
	assert.ok(second.semantic);
	const firstCall = externalOperationSequence(first.semantic).find(operation => operation.kind === 'call');
	const secondCall = externalOperationSequence(second.semantic).find(operation => operation.kind === 'call');
	assert.ok(firstCall?.kind === 'call');
	assert.ok(secondCall?.kind === 'call');
	assert.equal(firstCall.decision.mechanism, 'callable-shim');
	assert.equal(secondCall.decision.mechanism, 'callable-shim');
	assert.deepEqual(firstCall.callableProjections?.[0]?.descriptor, secondCall.callableProjections?.[0]?.descriptor);
	assert.match(first.output?.code ?? '', /\$viruneProjectCallable\(callback,/u);
	assert.match(second.output?.code ?? '', /\$viruneProjectCallable\(callback,/u);
});

test('native generic callable remains fail closed without a concrete monomorphic value boundary', async () => {
	const result = await compileFixture(
		'library',
		'export declare function consume(callback: (value: number) => number): void;\n',
		`import js { consume } from "./library.js"\n\nfn identity<T>(value: T) -> T {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(identity)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204' || item.code === 'L4206'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('nested cleanup callable result remains fail closed until nested callable descriptors are supported', async () => {
	const result = await compileFixture(
		'library',
		'export declare function register(callback: (value: string) => () => void): void;\n',
		`import js { register } from "./library.js"\n\nfn cleanup() -> Unit {\n\treturn Unit\n}\n\nfn factory(value: String) -> fn() -> Unit {\n\treturn cleanup\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard register(factory)\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204' || item.code === 'L4206'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('projects a zero-argument inline closure that captures an External handle through the primitive shim', async () => {
	const result = await compileFixture(
		'library',
		'export interface Handle { run(): void; }\nexport declare function makeHandle(): Handle;\nexport declare function enqueue(task: () => void): void;\n',
		`import js { enqueue, makeHandle } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tlet handle = makeHandle()\n\tdiscard enqueue(fn() -> Unit uses JavaScript {\n\t\tdiscard handle.run()\n\t\treturn Unit\n\t})\n\treturn Unit\n}\n`,
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
	assert.doesNotMatch(JSON.stringify(projection.descriptor), /Handle|External|provider|typescript|library|package/iu);
	const code = result.output?.code ?? '';
	assert.match(code, /\$viruneProjectCallable\(\(\(\$lambdaCtx\d+ = rootTaskContext\(\)\) => \{/u);
	assert.match(code, /\$fn\(rootTaskContext\(\)\)/u);
	assert.match(code, /\.run\(\)/u);
});

test('zero-argument inline primitive callbacks remain fail closed for open effects and composite results', async () => {
	const open = await compileFixture(
		'library',
		'export declare function consume(callback: () => void): void;\n',
		`import js { consume } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(fn() -> Unit uses * {\n\t\treturn Unit\n\t})\n\treturn Unit\n}\n`,
	);
	assert.ok(open.diagnostics.some(item => item.code === 'L4206' || item.code === 'L4204'));
	assert.equal(open.semantic?.interop.callableProjections?.length ?? 0, 0);

	const composite = await compileFixture(
		'library',
		'export declare function consume(callback: () => object): void;\n',
		`import js { consume } from "./library.js"\n\nrecord Payload { value: String }\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(fn() -> Payload {\n\t\treturn Payload { value: "blocked" }\n\t})\n\treturn Unit\n}\n`,
	);
	assert.ok(composite.diagnostics.some(item => item.code === 'L4206' || item.code === 'L4204'));
	assert.equal(composite.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('zero-argument inline primitive callbacks remain fail closed for foreign property writes', async () => {
	const result = await compileFixture(
		'library',
		'export interface Box { callback: () => void; }\nexport declare function makeBox(): Box;\n',
		`import js { makeBox } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tlet box = makeBox()\n\tbox.callback = fn() -> Unit {\n\t\treturn Unit\n\t}\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4206' || item.code === 'L2119'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('zero-argument inline primitive callbacks remain fail closed for construct fallback', async () => {
	const result = await compileFixture(
		'library',
		'export declare class Consumer { constructor(callback: () => void); }\n',
		`import js { Consumer } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard Consumer(fn() -> Unit {\n\t\treturn Unit\n\t})\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('zero-argument async inline primitive callbacks remain fail closed', async () => {
	const result = await compileFixture(
		'library',
		'export declare function consume(callback: () => Promise<void>): void;\n',
		`import js { consume } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(async fn() -> Unit {\n\t\treturn Unit\n\t})\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204' || item.code === 'L4206'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
	assert.doesNotMatch(result.output?.code ?? '', /\$viruneProjectCallable/u);
});
