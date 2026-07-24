import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSource } from '../src/index.js';

test('formatter remains idempotent when adjacent comments produce overlapping edits', async () => {
	const { lex } = await import('@virune/compiler/experimental');
	const sources = [
		`fn commented() -> Unit {
	// leading
	let values = [
		1, // first
	,	// second
		2,
	]
	return Unit
}
`,
		`fn commented() -> Unit {
	// leading
	let values = [
		1, // first
		,// second
		25,
	]
	return Unit
}
`,
		`fn commented() -> Unit {
	// leading
	let values = [
		1, // first
	,	// second result
		2,
	]
	return Unit
}
`,
	];

	for (const [index, source] of sources.entries()) {
		const first = formatSource(source);
		const second = formatSource(first.text);
		assert.deepEqual(first.errors, [], `fixture ${index}`);
		assert.deepEqual(second.errors, [], `fixture ${index}`);
		assert.equal(second.text, first.text, `fixture ${index}`);
		assert.deepEqual(
			lex(first.text).comments.map(comment => comment.image),
			lex(source).comments.map(comment => comment.image),
			`fixture ${index}`,
		);
		assert.doesNotMatch(first.text, /\/\/ first\n\s*\n/u, `fixture ${index}`);
	}
});
