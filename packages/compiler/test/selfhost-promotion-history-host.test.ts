import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const hostTests = [
	'scripts/selfhost-promotion-artifact.test.mjs',
	'scripts/selfhost-promotion-github.test.mjs',
	'scripts/selfhost-promotion-observation-collector.test.mjs',
	'scripts/selfhost-promotion-observation-resume.test.mjs',
	'scripts/selfhost-promotion-parent-collector.test.mjs',
	'scripts/run-selfhost-promotion-history-aggregation.test.mjs',
	'scripts/selfhost-promotion-history-workflow.test.mjs',
];

test('promotion history Host contracts pass from the repository-owned compiled unit suite', () => {
	const result = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...hostTests], {
		cwd: repositoryRoot,
		env: process.env,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(
		result.status,
		0,
		`promotion history Host tests failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
	);
});
