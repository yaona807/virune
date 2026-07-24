import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateSemanticCase, renderSemanticCase, shrinkParameters } from './semantic-fuzz.mjs';

test('semantic fuzz case generation is deterministic', () => {
	const values = [0.02, 0.7, 0.1, 0.9, 0.3, 0.4, 0.5];
	let index = 0;
	const next = () => values[index++ % values.length];
	const first = generateSemanticCase(next, 4);
	index = 0;
	const second = generateSemanticCase(next, 4);
	assert.deepEqual(first, second);
	assert.match(renderSemanticCase(first), /@jsExport/u);
});

test('semantic metamorphic variants preserve the exported probe shape', () => {
	const fuzzCase = { schemaVersion: 1, iteration: 1, template: 'arithmetic-branch', parameters: { start: 2, multiply: 3, add: 4, threshold: 5, thenDelta: 6, elseDelta: 7 } };
	for (const variant of ['original', 'commented', 'renamed', 'parenthesized']) {
		const source = renderSemanticCase(fuzzCase, variant);
		assert.match(source, /pub fn probe\(\)/u);
	}
	assert.match(renderSemanticCase(fuzzCase, 'renamed'), /candidateValue/u);
});

test('semantic failure parameters can be reduced toward zero', () => {
	const candidates = shrinkParameters({ left: 12, right: -5, stable: 0 });
	assert.ok(candidates.some(candidate => candidate.left === 0));
	assert.ok(candidates.some(candidate => candidate.right === -1));
	assert.ok(candidates.every(candidate => candidate.stable === 0));
});
