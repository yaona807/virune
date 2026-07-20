import assert from 'node:assert/strict';
import test from 'node:test';
import { nameRange, positionToOffset, sourceSpanToRange, spanContainsOffset } from '../src/analysis/position.js';

const source = { id: 1, path: '/tmp/sample.virune', text: 'fn main() {\n\tlet emoji = "😀"\n}\n' };

test('sourceSpanToRange converts Virune one-based positions to LSP zero-based positions', () => {
	assert.deepEqual(sourceSpanToRange({
		fileId: 1,
		start: { offset: 0, line: 2, column: 2 },
		end: { offset: 3, line: 2, column: 5 },
	}), {
		start: { line: 1, character: 1 },
		end: { line: 1, character: 4 },
	});
});

test('positionToOffset uses JavaScript UTF-16 offsets required by LSP', () => {
	const emojiStart = source.text.indexOf('😀');
	assert.equal(positionToOffset(source, { line: 1, character: 14 }), emojiStart);
	assert.equal(positionToOffset(source, { line: 1, character: 16 }), emojiStart + 2);
});

test('spanContainsOffset accepts offsets inside a multi-line span', () => {
	assert.equal(spanContainsOffset(source, {
		fileId: 1,
		start: { offset: 0, line: 1, column: 1 },
		end: { offset: source.text.length, line: 3, column: 2 },
	}, source.text.indexOf('emoji')), true);
});

test('nameRange finds non-identifier names such as extern module specifiers', () => {
	const externSource = { id: 1, path: '/tmp/extern.virune', text: 'extern "node:fs" {}\n' };
	const range = nameRange(externSource, {
		fileId: externSource.id,
		start: { offset: 0, line: 1, column: 1 },
		end: { offset: externSource.text.length - 1, line: 1, column: externSource.text.length },
	}, 'node:fs');
	assert.deepEqual(range, {
		start: { line: 0, character: 8 },
		end: { line: 0, character: 15 },
	});
});
