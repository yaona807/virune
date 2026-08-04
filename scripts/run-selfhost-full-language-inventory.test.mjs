import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import {
	helpText,
	parseArguments,
	resolveRepositoryOutput,
} from './run-selfhost-full-language-inventory.mjs';

test('inventory CLI parses the bounded option surface', () => {
	assert.deepEqual(parseArguments([]), {
		json: false,
		help: false,
		output: '.cache/selfhost/full-language-inventory.json',
	});
	assert.deepEqual(parseArguments(['--json', '--output=.cache/custom.json']), {
		json: true,
		help: false,
		output: '.cache/custom.json',
	});
	assert.deepEqual(parseArguments(['--help']), {
		json: false,
		help: true,
		output: '.cache/selfhost/full-language-inventory.json',
	});
});

test('inventory CLI rejects ambiguous and unsupported options', () => {
	assert.throws(() => parseArguments(['--json', '--json']), /Duplicate option/);
	assert.throws(() => parseArguments(['--output=a.json', '--output=b.json']), /Duplicate option/);
	assert.throws(() => parseArguments(['--help', '--json']), /cannot be combined/);
	assert.throws(() => parseArguments(['--stage=stage1']), /Unknown argument/);
});

test('inventory output must remain a repository-relative JSON file', () => {
	const root = resolve('/tmp/virune');
	assert.deepEqual(resolveRepositoryOutput(root, '.cache/result.json'), {
		outputPath: resolve(root, '.cache/result.json'),
		repositoryRelative: '.cache/result.json',
	});
	assert.throws(() => resolveRepositoryOutput(root, '../result.json'), /inside the repository/);
	assert.throws(() => resolveRepositoryOutput(root, '/tmp/result.json'), /repository-relative/);
	assert.throws(() => resolveRepositoryOutput(root, 'package.json'), /inside \.cache/);
	assert.throws(() => resolveRepositoryOutput(root, '.cache/result.txt'), /end in \.json/);
});

test('help describes incomplete status as a successful diagnostic result', () => {
	assert.match(helpText(), /Incomplete language lowering is reported with exit code 0/);
});
