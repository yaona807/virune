import assert from 'node:assert/strict';
import test from 'node:test';
import { checkModule as checkModuleBase } from '../src/checker/checker.js';
import { checkModule } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import { parseSource } from '../src/project/project.js';

test('newer checker symbols cannot revive stale registered operation evidence', () => {
	const parsed = parseSource({
		id: 1,
		path: '/virtual/session-symbol-injection.virune',
		text: 'fn main() -> Unit {}\n',
	});
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);

	const first = checkModule(parsed.ast);
	assert.deepEqual(first.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.deepEqual(externalOperationSequence({ module: parsed.ast, semantic: first }), []);

	const second = checkModuleBase(parsed.ast);
	assert.deepEqual(second.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, semantic: first }),
		/not from the current checked AST semantic session/u,
	);

	const mutableFirstSymbols = first.symbols as unknown as Map<number, unknown>;
	for (const [id, symbol] of second.symbols) mutableFirstSymbols.set(id, symbol);
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, semantic: first }),
		/not from the current checked AST semantic session/u,
		'publicly reachable symbols from a newer check must not expose the private session witness',
	);
});
