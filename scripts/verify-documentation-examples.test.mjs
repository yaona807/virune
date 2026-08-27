import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
	buildDocumentExamples,
	collectViruneFences,
	parseInlineDirective,
	verifyCounterpartDrift,
	verifyDocumentationExamples,
} from './verify-documentation-examples.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('parses run directives and escaped output expectations', () => {
	assert.deepEqual(parseInlineDirective('run id="hello" stdout="Hello\\n" stderr="" exit=0'), {
		mode: 'run',
		id: 'hello',
		file: 'src/main.virune',
		stdout: 'Hello\n',
		stderr: '',
		exit: 0,
		match: undefined,
		reason: undefined,
		sync: 'exact',
		include: [],
	});
});

test('collects Virune fences with stable indexes and source lines', () => {
	const fences = collectViruneFences('# Example\n\n```virune compile id="one"\nfn one() -> Int => 1\n```\n\n```text\nignored\n```\n\n```virune ignore id="two" reason="context"\nfn two() -> Int => 2\n```\n');
	assert.equal(fences.length, 2);
	assert.deepEqual(fences.map(fence => [fence.index, fence.line]), [[0, 3], [1, 11]]);
});

test('groups multiple source files into one example project', () => {
	const document = buildDocumentExamples('docs/example.md', [
		'```virune compile id="multi" file="src/math.virune"',
		'pub fn double(value: Int) -> Int => value * 2',
		'```',
		'',
		'```virune compile id="multi" file="src/main.virune"',
		'import { double } from "./math.virune"',
		'```',
		'',
	].join('\n'));
	const example = document.examples.get('multi');
	assert.equal(example.blocks.length, 2);
	assert.deepEqual(example.blocks.map(block => block.file), ['src/math.virune', 'src/main.virune']);
});

test('requires a reason for ignored examples', () => {
	assert.throws(
		() => buildDocumentExamples('docs/example.md', '```virune ignore id="missing-reason"\nfn value() -> Int => 1\n```\n'),
		/ignore requires a non-empty reason/u,
	);
});

test('detects exact counterpart drift and permits localized structural strings', () => {
	const english = buildDocumentExamples('docs/example.md', '```virune run id="hello" stdout="Hello\\n" sync="structure"\npub fn main(args: List<String>) -> Unit uses Console {\n\tConsole.print("Hello")\n}\n```\n');
	const japanese = buildDocumentExamples('docs/example_ja.md', '```virune run id="hello" stdout="こんにちは\\n" sync="structure"\npub fn main(args: List<String>) -> Unit uses Console {\n\tConsole.print("こんにちは")\n}\n```\n');
	assert.doesNotThrow(() => verifyCounterpartDrift(new Map([
		['docs/example.md', english],
		['docs/example_ja.md', japanese],
	])));

	const drifted = buildDocumentExamples('docs/example_ja.md', '```virune run id="hello" stdout="こんにちは\\n" sync="structure"\npub fn main(args: List<String>) -> Unit uses Console {\n\tConsole.print("こんにちは")\n\tConsole.print("extra")\n}\n```\n');
	assert.throws(() => verifyCounterpartDrift(new Map([
		['docs/example.md', english],
		['docs/example_ja.md', drifted],
	])), /have drifted/u);
});

test('repository manifest keeps root README Virune fences under validation', async () => {
	const result = await verifyDocumentationExamples(repositoryRoot, { execute: false });
	const english = result.documents.get('README.md');
	const japanese = result.documents.get('README_ja.md');
	assert.ok(english, 'README.md must remain in the documentation-example manifest');
	assert.ok(japanese, 'README_ja.md must remain in the documentation-example manifest');
	assert.ok(english.fences.length > 0, 'README.md must retain covered Virune fences');
	assert.equal(japanese.fences.length, english.fences.length, 'README counterparts must cover the same number of Virune fences');
});
