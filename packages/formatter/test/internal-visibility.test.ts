import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSource } from '../src/index.js';

test('formatter preserves internal visibility across all supported top-level declaration forms', () => {
	const source = [
		'internal fn run()->Int=>1',
		'internal record Item{value:Int}',
		'internal enum Choice{One\nTwo(Int)\n}',
		'internal newtype Id=Int',
		'internal type Alias=Int',
		'internal const Answer:Int=42',
		'internal let Current:Int=1',
		'fn privateValue()->Int=>0',
		'pub fn publicValue()->Int=>2',
		'',
	].join('\n');
	const first = formatSource(source);
	const second = formatSource(first.text);
	assert.deepEqual(first.errors, []);
	assert.deepEqual(second.errors, []);
	assert.equal(second.text, first.text);
	assert.equal(first.text.match(/^internal /gmu)?.length, 7);
	assert.match(first.text, /^fn privateValue\(\) -> Int => 0$/mu);
	assert.match(first.text, /^pub fn publicValue\(\) -> Int => 2$/mu);
});
