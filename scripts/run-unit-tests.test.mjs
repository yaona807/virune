import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('./run-unit-tests.mjs', import.meta.url));
const inventoryPath = 'packages/compiler/dist/test/selfhost-full-language-inventory.test.js';
const fastPath = 'packages/compiler/dist/test/fast.test.js';
const secondPath = 'packages/compiler/dist/test/second.test.js';

async function withFixture(action) {
	const root = await mkdtemp(join(tmpdir(), 'virune-unit-selection-'));
	try {
		await writeTest(root, fastPath, 'FAST_MARKER');
		await writeTest(root, secondPath, 'SECOND_MARKER');
		await writeTest(root, inventoryPath, 'INVENTORY_MARKER');
		await action(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeTest(root, relativePath, marker) {
	await writeTestSource(
		root,
		relativePath,
		`import test from 'node:test';\ntest('${marker}', () => console.log('${marker}'));\n`,
	);
}

async function writeTestSource(root, relativePath, source) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, source, 'utf8');
}

function run(root, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [runnerPath, ...args], {
			cwd: root,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', chunk => { stdout += chunk; });
		child.stderr.on('data', chunk => { stderr += chunk; });
		child.once('error', reject);
		child.once('exit', code => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

test('exclude-file removes the canonical inventory from the generic unit lane', async () => {
	await withFixture(async root => {
		const result = await run(root, [`--exclude-file=${inventoryPath}`]);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /FAST_MARKER/u);
		assert.match(result.stdout, /SECOND_MARKER/u);
		assert.doesNotMatch(result.stdout, /INVENTORY_MARKER/u);
	});
});

test('the canonical inventory remains directly runnable by exact file', async () => {
	await withFixture(async root => {
		const result = await run(root, [`--file=${inventoryPath}`]);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /INVENTORY_MARKER/u);
		assert.doesNotMatch(result.stdout, /FAST_MARKER/u);
		assert.doesNotMatch(result.stdout, /SECOND_MARKER/u);
	});
});

test('exact file and exclude-file cannot be combined ambiguously', async () => {
	await withFixture(async root => {
		const result = await run(root, [`--file=${inventoryPath}`, `--exclude-file=${inventoryPath}`]);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /Do not combine --file with --exclude-file\./u);
	});
});

test('writes stable per-file timing evidence for a successful selection', async () => {
	await withFixture(async root => {
		const timingPath = join(root, '.cache', 'custom-unit-timings.json');
		const result = await run(root, [`--timing-output=${timingPath}`]);
		assert.equal(result.code, 0, result.stderr);
		const evidence = JSON.parse(await readFile(timingPath, 'utf8'));
		assert.equal(evidence.schemaVersion, 1);
		assert.equal(evidence.claim, 'unit-test-file-timings');
		assert.equal(evidence.status, 'passed');
		assert.equal(evidence.selectedFileCount, 3);
		assert.equal(evidence.completedFileCount, 3);
		assert.equal(evidence.remainingFileCount, 0);
		assert.deepEqual(
			evidence.files.map(entry => entry.path),
			[fastPath, secondPath, inventoryPath],
		);
		assert.ok(evidence.files.every(entry => entry.status === 'passed' && entry.exitCode === 0));
		assert.ok(evidence.files.every(entry => Number.isFinite(entry.durationMs) && entry.durationMs >= 0));
		assert.ok(Number.isFinite(evidence.totalDurationMs) && evidence.totalDurationMs >= 0);
	});
});

test('writes timing evidence to the default CI artifact path', async () => {
	await withFixture(async root => {
		const result = await run(root, [`--exclude-file=${inventoryPath}`]);
		assert.equal(result.code, 0, result.stderr);
		const evidence = JSON.parse(await readFile(
			join(root, '.cache', 'ci-timings', 'unit-test-files.json'),
			'utf8',
		));
		assert.equal(evidence.status, 'passed');
		assert.equal(evidence.selectedFileCount, 2);
		assert.equal(evidence.completedFileCount, 2);
		assert.equal(evidence.remainingFileCount, 0);
		assert.deepEqual(evidence.files.map(entry => entry.path), [fastPath, secondPath]);
	});
});

test('writes partial timing evidence before stopping on the first failure', async () => {
	await withFixture(async root => {
		await writeTestSource(
			root,
			fastPath,
			"import test from 'node:test';\ntest('FAIL_MARKER', () => { throw new Error('expected failure'); });\n",
		);
		const timingPath = join(root, '.cache', 'failed-unit-timings.json');
		const result = await run(root, ['--failure-output-only', `--timing-output=${timingPath}`]);
		assert.equal(result.code, 1);
		const evidence = JSON.parse(await readFile(timingPath, 'utf8'));
		assert.equal(evidence.status, 'failed');
		assert.equal(evidence.selectedFileCount, 3);
		assert.equal(evidence.completedFileCount, 1);
		assert.equal(evidence.remainingFileCount, 2);
		assert.deepEqual(evidence.files.map(entry => entry.path), [fastPath]);
		assert.equal(evidence.files[0].status, 'failed');
		assert.equal(evidence.files[0].exitCode, 1);
		assert.match(`${result.stdout}\n${result.stderr}`, /expected failure/u);
	});
});

test('rejects an empty timing output path', async () => {
	await withFixture(async root => {
		const result = await run(root, ['--timing-output=']);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /--timing-output requires a non-empty path\./u);
	});
});
