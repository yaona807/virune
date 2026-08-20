import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { makeCliProject, runCli } from './cli-test-helpers.js';

test('CLI interop check validates project adapters and fails closed on invalid ABI', async () => {
	const root = await makeCliProject();
	await runCli(['init', root]);
	const interopDirectory = join(root, 'src/interop');
	await mkdir(interopDirectory, { recursive: true });
	const adapter = join(interopDirectory, 'example.interop.ts');
	await writeFile(adapter, 'export function normalize(value: string): string {\n\treturn value.trim()\n}\n', 'utf8');

	assert.match((await runCli(['interop', 'check', root])).stdout, /Checked 1 TypeScript interop adapter\(s\)\./u);

	await writeFile(adapter, 'export function generic<T>(value: T): T {\n\treturn value\n}\n', 'utf8');
	await assert.rejects(
		runCli(['interop', 'check', root]),
		error => {
			const failure = error as Error & { stderr?: string };
			assert.match(failure.stderr ?? '', /error\[INTEROP_ADAPTER\].*must not be generic/u);
			return true;
		},
	);
});
