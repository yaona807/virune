import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from '../src/syntax/parser.js';
import { lex } from '../src/syntax/tokens.js';

function assertParses(source: string): void {
	const lexed = lex(source);
	assert.deepEqual(lexed.errors, []);
	const parsed = parse(lexed.tokens);
	assert.deepEqual(parsed.errors, []);
}

test('block lambda call arguments preserve statement newlines while nested calls remain soft', () => {
	assertParses(`pub fn main() -> Unit {
	invoke(
		fn() -> Unit uses JavaScript, Console {
			discard nested(
				1,
				2,
			)
			return Unit
		},
	)
	return Unit
}
`);
});

test('block lambdas nested in lists preserve their own statement newlines', () => {
	assertParses(`pub fn main() -> Unit {
	let callbacks = [
		fn() -> Unit {
			discard cleanup()
			return Unit
		},
	]
	discard callbacks
	return Unit
}
`);
});

test('expression lambdas inside calls keep outer structural newlines soft', () => {
	assertParses(`pub fn main() -> Unit {
	invoke(
		fn() -> Unit => Unit,
	)
	return Unit
}
`);
});

test('ordinary aggregate and call continuation newlines remain soft', () => {
	assertParses(`pub fn main() -> Unit {
	consume(
		{
			left: nested(
				1,
				2,
			),
			right: 3,
		},
	)
	return Unit
}
`);
});
