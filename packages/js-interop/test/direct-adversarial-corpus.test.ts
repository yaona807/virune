import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileFixture(declarations: string, sourceText: string) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: sourceText }, { platform: 'node', jsInteropProvider: provider });
}

function errorCodes(result: Awaited<ReturnType<typeof compileFixture>>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('focused Direct corpus preserves member receivers and rejects an extracted this-dependent method', async () => {
	const declarations = [
		'export interface Counter {',
		'  add(this: Counter, delta: number): number;',
		'}',
		'export declare const counter: Counter;',
		'',
	].join('\n');
	const direct = await compileFixture(declarations, [
		'import js { counter } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard counter.add(1.0)',
		'\treturn Unit',
		'}',
		'',
	].join('\n'));
	assert.deepEqual(errorCodes(direct), []);
	assert.ok(direct.semantic);
	const call = externalOperationSequence(direct.semantic).find(operation => operation.kind === 'call');
	assert.equal(call?.kind, 'call');
	if (call?.kind === 'call') {
		assert.equal(call.receiverMode, 'preserve-this');
		assert.ok(call.decision.claims.includes('receiver-preserved'));
	}

	const extracted = await compileFixture(declarations, [
		'import js { counter } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tlet add = counter.add',
		'\tdiscard add(1.0)',
		'\treturn Unit',
		'}',
		'',
	].join('\n'));
	assert.ok(errorCodes(extracted).includes('L4204'));
});

test('focused Direct corpus accepts a concretely instantiated generic callback and rejects an unresolved generic callable target', async () => {
	const concrete = await compileFixture(
		'export declare function mapOne<T>(value: T, callback: (value: T) => T): T;\n',
		[
			'import js { mapOne } from "./library.js"',
			'',
			'fn echo(value: String) -> String {',
			'\treturn value',
			'}',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard mapOne("value", echo)',
			'\treturn Unit',
			'}',
			'',
		].join('\n'),
	);
	assert.deepEqual(errorCodes(concrete), []);
	assert.ok(concrete.semantic);
	const projectedCall = externalOperationSequence(concrete.semantic).find(operation => operation.kind === 'call');
	assert.equal(projectedCall?.kind, 'call');
	if (projectedCall?.kind === 'call') {
		assert.equal(projectedCall.decision.mechanism, 'callable-shim');
		assert.deepEqual(projectedCall.callableProjections?.[0]?.descriptor.parameters, ['String']);
		assert.equal(projectedCall.callableProjections?.[0]?.descriptor.result, 'String');
	}

	const unresolved = await compileFixture(
		'export declare function consume(callback: <T>(value: T) => T): void;\n',
		[
			'import js { consume } from "./library.js"',
			'',
			'fn echo(value: String) -> String {',
			'\treturn value',
			'}',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard consume(echo)',
			'\treturn Unit',
			'}',
			'',
		].join('\n'),
	);
	assert.ok(errorCodes(unresolved).includes('L4204'));
});

test('focused Direct corpus keeps returned cleanup functions External and callable', async () => {
	const result = await compileFixture(
		'export declare function subscribe(callback: () => void): () => void;\n',
		[
			'import js { subscribe } from "./library.js"',
			'',
			'fn onEvent() -> Unit {',
			'\treturn Unit',
			'}',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tlet cleanup = subscribe(onEvent)',
			'\tdiscard cleanup()',
			'\treturn Unit',
			'}',
			'',
		].join('\n'),
	);
	assert.deepEqual(errorCodes(result), []);
	assert.ok(result.semantic);
	const calls = externalOperationSequence(result.semantic).filter(operation => operation.kind === 'call');
	assert.equal(calls.length, 2);
	assert.equal(calls[0]?.decision.mechanism, 'callable-shim');
	assert.equal(calls[1]?.decision.mechanism, 'direct');
	assert.equal(calls[1]?.receiverMode, 'none');
});

test('focused Direct corpus rejects raw native aggregates at broad any and object boundaries', async () => {
	for (const declaration of [
		'export declare function accept(value: any): void;\n',
		'export declare function accept(value: object): void;\n',
	]) {
		const result = await compileFixture(declaration, [
			'import js { accept } from "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {',
			'\tdiscard accept([1, 2])',
			'\treturn Unit',
			'}',
			'',
		].join('\n'));
		assert.ok(errorCodes(result).includes('L4204'));
	}
});

test('focused Direct corpus keeps ModuleLoad and Call distinct and does not select mechanism by renamed module fixture', async () => {
	const outcomes = [];
	for (const moduleName of ['alpha', 'renamed-beta']) {
		const root = await fixtureRoot();
		await writeFile(join(root, `src/${moduleName}.js`), 'export function greet(name) { return name; }\n', 'utf8');
		await writeFile(join(root, `src/${moduleName}.d.ts`), 'export declare function greet(name: string): string;\n', 'utf8');
		const provider = new TypeScriptInteropProvider({ projectRoot: root });
		const result = compileSource({
			id: 1,
			path: join(root, 'src/main.virune'),
			text: [
				`import js { greet } from "./${moduleName}.js"`,
				'',
				'fn main() -> Unit uses JavaScript {',
				'\tdiscard greet("hello")',
				'\treturn Unit',
				'}',
				'',
			].join('\n'),
		}, { platform: 'node', jsInteropProvider: provider });
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		assert.ok(result.semantic);
		const operations = externalOperationSequence(result.semantic);
		assert.deepEqual(operations.map(operation => operation.kind), ['module-load', 'call']);
		const call = operations[1];
		assert.equal(call?.kind, 'call');
		if (call?.kind === 'call') outcomes.push({
			mechanism: call.decision.mechanism,
			authoring: call.decision.authoring,
			claims: call.decision.claims,
			receiverMode: call.receiverMode,
			resultCategory: call.result.category,
		});
	}
	assert.equal(outcomes.length, 2);
	assert.deepEqual(outcomes[0], outcomes[1]);
});
