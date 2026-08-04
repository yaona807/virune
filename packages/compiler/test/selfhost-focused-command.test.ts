import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

test('focused self-host command executes exactly the selected compiled case', { timeout: 120_000 }, async () => {
	const result = await execFileAsync(
		process.execPath,
		['scripts/run-selfhost-focused.mjs', '--case=contract'],
		{ cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
	);
	assert.match(result.stdout, /Self-host focused case: contract/u);
	assert.match(result.stdout, /selfhost-contract\.test\.js/u);
	assert.doesNotMatch(result.stdout, /selfhost-(?!contract)[a-z0-9-]+\.test\.js/u);
});
