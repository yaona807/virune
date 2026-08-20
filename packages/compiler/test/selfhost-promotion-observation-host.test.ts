import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const hostTests = [
	'scripts/create-selfhost-promotion-subject.test.mjs',
	'scripts/run-selfhost-promotion-quality.test.mjs',
	'scripts/run-selfhost-promotion-performance.test.mjs',
	'scripts/assemble-selfhost-promotion-observation.test.mjs',
	'scripts/selfhost-promotion-observation-workflow.test.mjs',
];

test('promotion observation Host contracts pass from the repository-owned compiled unit suite', () => {
	const result = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...hostTests], {
		cwd: repositoryRoot,
		env: process.env,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, `promotion observation Host tests failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});
