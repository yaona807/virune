import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCommand } from './run-ci-command.mjs';
import { renderCiSummary } from './write-ci-summary.mjs';

test('renders reproducible commands with safe quoting', () => {
	assert.equal(renderCommand(['npm', 'run', 'test:core']), 'npm run test:core');
	assert.equal(renderCommand(['node', '-e', 'console.log("hello world")']), 'node -e "console.log(\\\"hello world\\\")"');
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
