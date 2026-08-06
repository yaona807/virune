import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('./run-unit-tests.mjs', import.meta.url));
const inventoryPath = 'packages/compiler/dist/test/selfhost-full-language-inventory.test.js';
const fastPath = 'packages/compiler/dist/test/fast.test.js';

async function withFixture(action) {
	const root = await mkdtemp(join(tmpdir(), 'virune-unit-selection-'));
	try {
		await writeTest(root, fastPath, 'FAST_MARKER');
		await writeTest(root, inventoryPath, 'INVENTORY_MARKER');
		await action(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function writeTest(root, relativePath, marker) {
	const path = join(root, relativePath);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `import test from 'node:test';\ntest('${marker}', () => console.log('${marker}'));\n`);
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
		assert.doesNotMatch(result.stdout, /INVENTORY_MARKER/u);
	});
});

test('the canonical inventory remains directly runnable by exact file', async () => {
	await withFixture(async root => {
		const result = await run(root, [`--file=${inventoryPath}`]);
		assert.equal(result.code, 0, result.stderr);
		assert.match(result.stdout, /INVENTORY_MARKER/u);
		assert.doesNotMatch(result.stdout, /FAST_MARKER/u);
	});
});

test('exact file and exclude-file cannot be combined ambiguously', async () => {
	await withFixture(async root => {
		const result = await run(root, [`--file=${inventoryPath}`, `--exclude-file=${inventoryPath}`]);
		assert.equal(result.code, 1);
		assert.match(result.stderr, /Do not combine --file with --exclude-file\./u);
	});
});
