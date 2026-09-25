import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function booleanFixtureRoot(): Promise<string> {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.js'), 'export const state = { flag: true };\n', 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), [
		'export declare const state: {',
		'\treadonly flag: boolean;',
		'\treadonly raw: any;',
		'\treadonly uncertain: unknown;',
		'\treadonly count: number;',
		'\treadonly text: string;',
		'\treadonly mixed: boolean | string;',
		'};',
		'',
	].join('\n'), 'utf8');
	return root;
}

function compileCondition(root: string, text: string, provider?: TypeScriptInteropProvider) {
	return compileSource(
		{ id: 1, path: join(root, 'src/main.virune'), text },
		{ platform: 'node', ...(provider === undefined ? {} : { jsInteropProvider: provider }) },
	);
}

const errors = (result: ReturnType<typeof compileCondition>) => result.diagnostics.filter(item => item.severity === 'error');
const sourceFor = (...lines: string[]) => lines.join('\n');

test('JavaScript boolean properties bridge to Bool in every boolean condition context', async () => {
	const root = await booleanFixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const source = sourceFor(
		'import js { state } from "./library.js"',
		'',
		'fn ordinaryIf() -> Unit uses JavaScript {',
		'\tif state.flag { discard 0 }',
		'}',
		'fn whileCondition() -> Unit uses JavaScript {',
		'\twhile state.flag { break }',
		'}',
		'component ViewCondition() uses JavaScript {',
		'\treturn view { main() { if state.flag { span() } else { span() } } }',
		'}',
		'fn shortCircuit() -> Unit uses JavaScript {',
		'\tif state.flag && state.flag { discard 0 }',
		'}',
		'fn negatedCondition() -> Unit uses JavaScript {',
		'\tif !state.flag { discard 0 }',
		'}',
		'fn conditionalExpression() -> Int uses JavaScript {',
		'\treturn if state.flag then 1 else 0',
		'}',
		'fn matchGuard() -> Int uses JavaScript {',
		'\treturn match 1 {',
		'\t\tvalue if state.flag => value',
		'\t\t_ => 0',
		'\t}',
		'}',
	);
	const result = compileCondition(root, source, provider);
	assert.deepEqual(errors(result), []);
	assert.equal((result.output?.code.match(/checkForeignBool\(/gu) ?? []).length, 8);
});

test('non-boolean and ambiguous JavaScript evidence cannot bridge to Bool', async () => {
	const root = await booleanFixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const source = sourceFor(
		'import js { state } from "./library.js"',
		'',
		'fn rejectAny() -> Unit uses JavaScript { if state.raw { discard 0 } }',
		'fn rejectUnknown() -> Unit uses JavaScript { if state.uncertain { discard 0 } }',
		'fn rejectNumber() -> Unit uses JavaScript { if state.count { discard 0 } }',
		'fn rejectString() -> Unit uses JavaScript { if state.text { discard 0 } }',
		'fn rejectUnion() -> Unit uses JavaScript { if state.mixed { discard 0 } }',
	);
	const result = compileCondition(root, source, provider);
	assert.ok(errors(result).filter(item => item.code === 'L2043').length >= 5);
	assert.doesNotMatch(result.output?.code ?? '', /checkForeignBool\(/u);
});

test('stale property snapshots cannot bridge and missing evidence fails closed', async () => {
	const root = await booleanFixtureRoot();
	class StalePropertyProvider extends TypeScriptInteropProvider {
		override getProperty(reference: Parameters<TypeScriptInteropProvider['getProperty']>[0], name: string) {
			const snapshot = super.getProperty(reference, name);
			return snapshot === undefined ? undefined : {
				...snapshot,
				ref: { ...snapshot.ref, generation: snapshot.ref.generation + 1 },
			};
		}
	}
	const staleProvider = new StalePropertyProvider({ projectRoot: root });
	const condition = sourceFor(
		'import js { state } from "./library.js"',
		'fn staleCondition() -> Unit uses JavaScript { if state.flag { discard 0 } }',
	);
	const staleResult = compileCondition(root, condition, staleProvider);
	assert.ok(errors(staleResult).some(item => item.code === 'L2043'));
	assert.doesNotMatch(staleResult.output?.code ?? '', /checkForeignBool\(/u);

	const unresolved = compileCondition(root, sourceFor(
		'import js { missing } from "./missing.js"',
		'fn unresolvedCondition() -> Unit uses JavaScript { if missing { discard 0 } }',
	), new TypeScriptInteropProvider({ projectRoot: root }));
	assert.ok(errors(unresolved).length > 0);

	const withoutProvider = compileCondition(root, condition);
	assert.ok(errors(withoutProvider).length > 0);
	assert.doesNotMatch(withoutProvider.output?.code ?? '', /checkForeignBool\(/u);
});
