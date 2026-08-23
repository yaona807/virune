import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const hostTests = [
	'scripts/compare-selfhost-clean-bootstrap-evidence.test.mjs',
	'scripts/create-selfhost-promotion-subject.test.mjs',
	'scripts/create-selfhost-promotion-subject-dynamic-loading.test.mjs',
	'scripts/selfhost-promotion-host-contract.test.mjs',
	'scripts/selfhost-promotion-host-provenance.test.mjs',
	'scripts/run-selfhost-promotion-quality.test.mjs',
	'scripts/run-selfhost-promotion-performance.test.mjs',
	'scripts/assemble-selfhost-promotion-observation.test.mjs',
	'scripts/selfhost-promotion-observation-workflow.test.mjs',
];

test('promotion observation Host contracts pass from the repository-owned compiled unit suite', () => {
	const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
	const result = spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...hostTests], {
		cwd: repositoryRoot,
		env,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, `promotion observation Host tests failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});

test('promotion observation preserves the current static Legacy load boundary', () => {
	for (const file of ['mvp-adapter.js', 'compiler-facade.js']) {
		const source = readFileSync(new URL(`../src/selfhost/${file}`, import.meta.url), 'utf8');
		assert.match(source, /from ['"]\.\/legacy-adapter\.js['"]/u, `${file} must retain the current static Legacy import`);
		assert.doesNotMatch(source, /import\(['"]\.\/legacy-adapter\.js['"]\)/u, `${file} must not gain a promotion-only lazy Legacy boundary`);
	}
});
