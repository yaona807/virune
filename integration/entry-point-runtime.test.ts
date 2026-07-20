import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { makeCliProject, runCli } from './cli-test-helpers.js';

test('CLI run accepts args and Result<Unit, E>, and converts panic to exit code 1 without an internal stack', async () => {
	const root = await makeCliProject();
	await runCli(['init', root]);
	await writeFile(join(root, 'src/main.virune'), 'pub fn main(args: List<String>) -> Result<Unit, String> uses Console {\n\tConsole.print(Option.unwrapOr(List.first(args), "none"))\n\treturn Ok(Unit)\n}\n');
	assert.match((await runCli(['run', root, 'argument'])).stdout, /argument/u);
	await writeFile(join(root, 'src/main.virune'), 'pub fn main() -> Result<Unit, String> {\n\treturn Err("entry error")\n}\n');
	await assert.rejects(
		runCli(['run', root]),
		(error: unknown) => typeof error === 'object' && error !== null && 'stderr' in error && String((error as { stderr: string }).stderr).includes('entry error'),
	);
	await writeFile(join(root, 'src/main.virune'), 'pub fn main() -> Unit {\n\tpanic("entry panic")\n}\n');
	await assert.rejects(
		runCli(['run', root]),
		(error: unknown) => {
			if (typeof error !== 'object' || error === null || !('stderr' in error)) return false;
			const stderr = String((error as { stderr: string }).stderr);
			return stderr.includes('entry panic') && !stderr.includes('run-entry.mjs:');
		},
	);
});
