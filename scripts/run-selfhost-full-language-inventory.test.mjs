import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import {
	helpText,
	parseArguments,
	parseCompileRuns,
	resolveRepositoryOutput,
} from './run-selfhost-full-language-inventory.mjs';

test('inventory CLI parses the bounded option surface', () => {
	assert.deepEqual(parseArguments([]), {
		json: false,
		help: false,
		output: '.cache/selfhost/full-language-inventory.json',
		timingOutput: '.cache/selfhost/full-language-inventory-timings.json',
		compileRuns: 2,
	});
	assert.deepEqual(parseArguments([
		'--json',
		'--compile-runs=1',
		'--output=.cache/custom.json',
		'--timing-output=.cache/custom-timings.json',
	]), {
		json: true,
		help: false,
		output: '.cache/custom.json',
		timingOutput: '.cache/custom-timings.json',
		compileRuns: 1,
	});
	assert.deepEqual(parseArguments(['--help']), {
		json: false,
		help: true,
		output: '.cache/selfhost/full-language-inventory.json',
		timingOutput: '.cache/selfhost/full-language-inventory-timings.json',
		compileRuns: 2,
	});
});

test('compile-run parsing is fail-closed', () => {
	assert.equal(parseCompileRuns('1'), 1);
	assert.equal(parseCompileRuns('2'), 2);
	assert.throws(() => parseCompileRuns('0'), /exactly 1 or 2/);
	assert.throws(() => parseCompileRuns('3'), /exactly 1 or 2/);
	assert.throws(() => parseCompileRuns(''), /exactly 1 or 2/);
});

test('inventory CLI rejects ambiguous and unsupported options', () => {
	assert.throws(() => parseArguments(['--json', '--json']), /Duplicate option/);
	assert.throws(() => parseArguments(['--output=a.json', '--output=b.json']), /Duplicate option/);
	assert.throws(
		() => parseArguments(['--timing-output=a.json', '--timing-output=b.json']),
		/Duplicate option/,
	);
	assert.throws(() => parseArguments(['--compile-runs=1', '--compile-runs=2']), /Duplicate option/);
	assert.throws(() => parseArguments(['--help', '--json']), /cannot be combined/);
	assert.throws(() => parseArguments(['--help', '--compile-runs=1']), /cannot be combined/);
	assert.throws(() => parseArguments(['--help', '--timing-output=.cache/a.json']), /cannot be combined/);
	assert.throws(() => parseArguments(['--stage=stage1']), /Unknown argument/);
});

test('inventory and timing outputs must remain repository-relative JSON files', () => {
	const root = resolve('/tmp/virune');
	assert.deepEqual(resolveRepositoryOutput(root, '.cache/result.json'), {
		outputPath: resolve(root, '.cache/result.json'),
		repositoryRelative: '.cache/result.json',
	});
	assert.deepEqual(resolveRepositoryOutput(root, '.cache/timing.json', '--timing-output'), {
		outputPath: resolve(root, '.cache/timing.json'),
		repositoryRelative: '.cache/timing.json',
	});
	assert.throws(() => resolveRepositoryOutput(root, '../result.json'), /inside the repository/);
	assert.throws(() => resolveRepositoryOutput(root, '/tmp/result.json'), /repository-relative/);
	assert.throws(() => resolveRepositoryOutput(root, 'package.json'), /inside \.cache/);
	assert.throws(() => resolveRepositoryOutput(root, '.cache/result.txt'), /end in \.json/);
	assert.throws(
		() => resolveRepositoryOutput(root, 'timing.json', '--timing-output'),
		/--timing-output must be inside \.cache/,
	);
});

test('help documents timing, progress, and compile-run behavior', () => {
	assert.match(helpText(), /Incomplete language lowering is reported with exit code 0/);
	assert.match(helpText(), /phase timing evidence on success and failure/);
	assert.match(helpText(), /60-second heartbeats/);
	assert.match(helpText(), /One compile validates readiness/);
	assert.match(helpText(), /default is two compiles/);
});
