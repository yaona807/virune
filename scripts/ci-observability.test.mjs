import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { renderCommand, runCiCommand } from './run-ci-command.mjs';
import { renderCiSummary } from './write-ci-summary.mjs';

test('renders reproducible commands with safe quoting', () => {
	assert.equal(renderCommand(['npm', 'run', 'test:core']), 'npm run test:core');
	assert.equal(renderCommand(['node', '-e', 'console.log("hello world")']), 'node -e "console.log(\\"hello world\\")"');
});

test('orders CI timings from slowest to fastest and includes reproduction commands', () => {
	const markdown = renderCiSummary([
		{ id: 'fast', durationMs: 500, status: 0, reproduce: 'npm run fast' },
		{ id: 'slow', durationMs: 2500, status: 1, reproduce: 'npm run slow' },
	]);
	assert.ok(markdown.indexOf('`slow`') < markdown.indexOf('`fast`'));
	assert.match(markdown, /fail \(1\)/u);
	assert.match(markdown, /npm run slow/u);
	assert.match(markdown, /3\.00 s/u);
});

test('retains streamed stdout and stderr with failure reproduction evidence', async () => {
	const root = await mkdtemp(resolve(tmpdir(), 'virune-ci-observability-'));
	try {
		const record = await runCiCommand({
			id: 'expected-failure',
			job: 'test-job',
			root,
			command: [process.execPath, '-e', "console.log('stdout-marker'); console.error('stderr-marker'); process.exit(7)"],
		});
		assert.equal(record.status, 7);
		const log = await readFile(resolve(root, '.cache/ci-failures/test-job-expected-failure.log'), 'utf8');
		const summary = await readFile(resolve(root, '.cache/ci-failures/test-job-expected-failure.md'), 'utf8');
		assert.match(log, /stdout-marker/u);
		assert.match(log, /stderr-marker/u);
		assert.match(summary, /Exit status: 7/u);
		assert.match(summary, /Reproduce:/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
