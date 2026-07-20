import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { makeCliProject, runCli } from './cli-test-helpers.js';

test('CLI run reports invalid main signatures as user diagnostics', async () => {
	const cases = [
		{ source: 'pub fn helper() -> Unit {\n\treturn Unit\n}\n', code: 'L5011' },
		{ source: 'fn main() -> Unit {\n\treturn Unit\n}\n', code: 'L5012' },
		{ source: 'pub fn main<T>() -> Unit {\n\treturn Unit\n}\n', code: 'L5013' },
		{ source: 'pub fn main(value: String) -> Unit {\n\treturn Unit\n}\n', code: 'L5015' },
		{ source: 'pub fn main() -> String {\n\treturn "invalid"\n}\n', code: 'L5016' },
	];
	for (const item of cases) {
		const root = await makeCliProject();
		await runCli(['init', root]);
		await writeFile(join(root, 'src/main.virune'), item.source);
		await assert.rejects(
			runCli(['run', root]),
			(error: unknown) => typeof error === 'object' && error !== null && 'stderr' in error && String((error as { stderr: string }).stderr).includes(item.code),
		);
	}
});
