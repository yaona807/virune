import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import {
	adaptKernelOutputForProbe,
	generateSemanticDifferentialFixtures,
	parseSemanticDifferentialArguments,
	prepareSemanticDifferentialEvidenceDirectory,
} from './run-selfhost-semantic-differential-fuzz.mjs';
import { generateSemanticCase, renderSemanticCase, shrinkParameters } from './semantic-fuzz.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

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

test('self-host semantic differential fuzz fixtures are deterministic and seed-qualified', () => {
	const first = generateSemanticDifferentialFixtures({ seed: 0x53_44_46_31, iterations: 32 });
	const second = generateSemanticDifferentialFixtures({ seed: 0x53_44_46_31, iterations: 32 });
	const differentSeed = generateSemanticDifferentialFixtures({ seed: 0x53_44_46_32, iterations: 32 });
	assert.deepEqual(first, second);
	assert.notDeepEqual(first, differentSeed);
	assert.equal(first.length, 32);
	assert.equal(new Set(first.map(fixture => fixture.id)).size, first.length);
	assert.ok(first.every(fixture => fixture.id.startsWith('semantic-fuzz-53444631-')));
	assert.ok(differentSeed.every(fixture => fixture.id.startsWith('semantic-fuzz-53444632-')));
	assert.deepEqual(
		new Set(first.map(fixture => fixture.id.replace(/^semantic-fuzz-[0-9a-f]{8}-\d{4}-/u, ''))),
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
	const rejected = { ...output, accepted: false };
	assert.equal(adaptKernelOutputForProbe(input, rejected), rejected);
	const missingEntry = { ...output, emittedModules: output.emittedModules.slice(0, 1) };
	assert.equal(adaptKernelOutputForProbe(input, missingEntry), missingEntry);
});

test('semantic differential evidence directory is bounded and rejects stale evidence without cleanup', async () => {
	const relativeOutput = `.cache/selfhost-semantic-differential-test-${process.pid}`;
	const outputDirectory = await prepareSemanticDifferentialEvidenceDirectory(relativeOutput);
	const staleReport = resolve(outputDirectory, 'report.json');
	const fileOutputRelative = `.cache/selfhost-semantic-differential-file-${process.pid}`;
	const fileOutput = resolve(repositoryRoot, fileOutputRelative);
	try {
		await writeFile(staleReport, '{"stale":true}\n', 'utf8');
		await assert.rejects(
			prepareSemanticDifferentialEvidenceDirectory(relativeOutput),
			/output already contains semantic differential evidence: report\.json/u,
		);
		assert.equal(await access(staleReport).then(() => true), true);
		await assert.rejects(
			prepareSemanticDifferentialEvidenceDirectory('.cache'),
			/output must be one direct child directory of repository \.cache/u,
		);
		await assert.rejects(
			prepareSemanticDifferentialEvidenceDirectory('.cache/nested/output'),
			/output must be one direct child directory of repository \.cache/u,
		);
		await assert.rejects(
			prepareSemanticDifferentialEvidenceDirectory('../outside'),
			/output must be one direct child directory of repository \.cache/u,
		);
		await assert.rejects(
			prepareSemanticDifferentialEvidenceDirectory(repositoryRoot),
			/output must be one direct child directory of repository \.cache/u,
		);
		await writeFile(fileOutput, 'not a directory\n', 'utf8');
		await assert.rejects(
			prepareSemanticDifferentialEvidenceDirectory(fileOutputRelative),
			/output must be a non-symlink directory/u,
		);
	} finally {
		await rm(outputDirectory, { recursive: true, force: true });
		await rm(fileOutput, { force: true });
	}
});

test('semantic differential evidence rejects dangling artifact symlinks', { skip: process.platform === 'win32' }, async () => {
	const relativeOutput = `.cache/selfhost-semantic-differential-symlink-${process.pid}`;
	const outputDirectory = await prepareSemanticDifferentialEvidenceDirectory(relativeOutput);
	try {
		await symlink('missing-report-target.json', resolve(outputDirectory, 'report.json'));
		await assert.rejects(
			prepareSemanticDifferentialEvidenceDirectory(relativeOutput),
			/output already contains semantic differential evidence: report\.json/u,
		);
	} finally {
		await rm(outputDirectory, { recursive: true, force: true });
	}
});

test('semantic differential runner argument parsing rejects ambiguous and unsupported arguments', () => {
	assert.deepEqual(
		parseSemanticDifferentialArguments(['--seed=7', '--iterations=8', '--output=.cache/selfhost-custom']),
		{ seed: '7', iterations: '8', output: '.cache/selfhost-custom' },
	);
	assert.throws(() => parseSemanticDifferentialArguments(['--output=']), /--output must be a non-empty string/u);
	assert.throws(() => parseSemanticDifferentialArguments(['--unknown=value']), /Unknown argument/u);
	assert.throws(() => parseSemanticDifferentialArguments(['--seed=1', '--seed=2']), /Duplicate argument: --seed/u);
});

test('Nightly preserves semantic differential fuzz failures as isolated non-promotable replayable evidence', () => {
	const workflow = readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8');
	const runner = workflow.indexOf('- name: Run the Self-host semantic differential fuzz suite');
	const recorder = workflow.indexOf('- name: Record Self-host semantic differential fuzz execution status');
	const upload = workflow.indexOf('- name: Upload non-promotable self-host evidence');
	assert.ok(runner >= 0 && recorder > runner && upload > recorder);
	const runnerBlock = workflow.slice(runner, recorder);
	const recorderBlock = workflow.slice(recorder, upload);
	const uploadBlock = workflow.slice(upload);
	assert.match(runnerBlock, /id: selfhost-semantic-differential-fuzz/u);
	assert.match(runnerBlock, /continue-on-error: true/u);
	assert.match(runnerBlock, /run-selfhost-semantic-differential-fuzz\.mjs/u);
	assert.match(runnerBlock, /--seed=\$\{\{ github\.run_number \}\}/u);
	assert.match(runnerBlock, /\.cache\/selfhost-semantic-differential-fuzz-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(recorderBlock, /steps\.selfhost-semantic-differential-fuzz\.outcome/u);
	assert.match(recorderBlock, /\.cache\/selfhost-semantic-differential-fuzz-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
	assert.match(recorderBlock, /process\.env\.VIRUNE_SELFHOST_SEMANTIC_DIFFERENTIAL_OUTPUT/u);
	assert.match(recorderBlock, /lstatSync\(output\)/u);
	assert.match(recorderBlock, /output directory was not created by the runner/u);
	assert.match(recorderBlock, /output must be a non-symlink directory/u);
	assert.doesNotMatch(recorderBlock, /mkdirSync\(output/u);
	assert.match(recorderBlock, /claim: 'selfhost-semantic-differential-fuzz-execution'/u);
	assert.match(recorderBlock, /generationPresent: existsSync\(join\(output, 'generation\.json'\)\)/u);
	assert.match(recorderBlock, /reportPresent: existsSync\(join\(output, 'report\.json'\)\)/u);
	assert.match(uploadBlock, /\.cache\/selfhost-nightly-shadow\//u);
	assert.match(uploadBlock, /\.cache\/selfhost-semantic-differential-fuzz-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\//u);
});
