import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	adaptKernelOutputForProbe,
	generateSemanticDifferentialFixtures,
	parseSemanticDifferentialArguments,
} from './run-selfhost-semantic-differential-fuzz.mjs';
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

test('self-host semantic differential fuzz fixtures are deterministic and fail closed on unsupported inputs', () => {
	const first = generateSemanticDifferentialFixtures({ seed: 0x53_44_46_31, iterations: 32 });
	const second = generateSemanticDifferentialFixtures({ seed: 0x53_44_46_31, iterations: 32 });
	assert.deepEqual(first, second);
	assert.equal(first.length, 32);
	assert.equal(new Set(first.map(fixture => fixture.id)).size, first.length);
	assert.deepEqual(
		new Set(first.map(fixture => fixture.id.replace(/^semantic-fuzz-\d{4}-/u, ''))),
		new Set(['arithmetic-branch', 'list-fold', 'literal-match', 'tuple-roundtrip', 'record-field', 'result-branch', 'async-await']),
	);
	for (const fixture of first) {
		assert.deepEqual(fixture.tags, ['semantic-fuzz', 'project', 'runtime']);
		assert.deepEqual(fixture.expectedDivergences, []);
		assert.equal(fixture.input.platform, 'node');
		assert.deepEqual(fixture.input.interopManifest, { version: '1', modules: [] });
		assert.deepEqual(fixture.input.emit, { target: 'es2022', sourceMap: false, sourcesContent: true });
		assert.match(fixture.input.sources[0].text, /@jsExport/u);
		assert.match(fixture.input.sources[0].text, /pub (?:async )?fn probe\(\)/u);
	}
	assert.throws(() => generateSemanticDifferentialFixtures({ seed: '1x', iterations: 1 }), /seed must be a non-negative integer/u);
	assert.throws(() => generateSemanticDifferentialFixtures({ seed: 0x1_0000_0000, iterations: 1 }), /seed must be a uint32/u);
	assert.throws(() => generateSemanticDifferentialFixtures({ seed: 1, iterations: 0 }), /iterations must be greater than zero/u);
});

test('probe runtime adapter changes only the entry module and does not mutate compiler evidence', () => {
	const input = { entryPath: 'src/main.virune' };
	const output = {
		accepted: true,
		emittedModules: [
			{ sourcePath: 'src/helper.virune', code: 'export const helper = 1;\n' },
			{ sourcePath: 'src/main.virune', code: 'export function probe() { return 42; }\n' },
		],
	};
	const adapted = adaptKernelOutputForProbe(input, output);
	assert.notEqual(adapted, output);
	assert.equal(adapted.emittedModules[0].code, output.emittedModules[0].code);
	assert.equal(output.emittedModules[1].code, 'export function probe() { return 42; }\n');
	assert.match(adapted.emittedModules[1].code, /export async function main\(\)/u);
	assert.match(adapted.emittedModules[1].code, /return await probe\(\)/u);
	assert.equal(adaptKernelOutputForProbe(input, { ...output, accepted: false }), output.accepted === false ? output : adaptKernelOutputForProbe(input, { ...output, accepted: false }));
});

test('semantic differential runner argument parsing rejects unknown and empty arguments', () => {
	assert.deepEqual(
		parseSemanticDifferentialArguments(['--seed=7', '--iterations=8', '--output=.cache/custom']),
		{ seed: '7', iterations: '8', output: '.cache/custom' },
	);
	assert.throws(() => parseSemanticDifferentialArguments(['--output=']), /--output must be a non-empty string/u);
	assert.throws(() => parseSemanticDifferentialArguments(['--unknown=value']), /Unknown argument/u);
});
