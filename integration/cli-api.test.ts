import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { makeCliProject, runCli } from './cli-test-helpers.js';

test('CLI api writes a deterministic public API snapshot and detects drift', async () => {
	const root = await makeCliProject();
	await runCli(['init', root]);
	await writeFile(join(root, 'src/main.virune'), 'pub record User {\n\tname: String\n}\n\npub fn greet(user: User) -> String {\n\treturn user.name\n}\n');
	assert.match((await runCli(['api', root])).stdout, /Wrote public API snapshot/u);
	const snapshot = JSON.parse(await readFile(join(root, 'virune.api.json'), 'utf8')) as { modules: readonly { declarations: readonly { name: string }[] }[] };
	assert.deepEqual(snapshot.modules[0]?.declarations.map(item => item.name), ['greet', 'User']);
	assert.match((await runCli(['api', root, '--check'])).stdout, /Checked public API snapshot/u);
	await writeFile(join(root, 'src/main.virune'), 'pub fn greet(name: String) -> String {\n\treturn name\n}\n');
	await assert.rejects(runCli(['api', root, '--check']));
});

test('CLI api accepts --out without mistaking its value for the project root', async () => {
	const root = await makeCliProject();
	await runCli(['init', root]);
	const output = join(root, 'snapshots/public-api.json');
	assert.match((await runCli(['api', '--out', output], root)).stdout, /Wrote public API snapshot/u);
	const snapshot = JSON.parse(await readFile(output, 'utf8')) as { languageVersion: string };
	assert.equal(snapshot.languageVersion, '1.0');
});

test('CLI run creates a task context for async main without user arguments', async () => {
	const root = await makeCliProject();
	await runCli(['init', root]);
	await writeFile(join(root, 'src/main.virune'), 'pub async fn main() -> Result<Unit, String> uses Console, Task {\n\tawait Task.sleep(Duration.milliseconds(1))\n\tConsole.print("async main")\n\treturn Ok(Unit)\n}\n');
	assert.match((await runCli(['run', root])).stdout, /async main/u);
});

test('CLI check validates unimported source modules and API snapshots include them', async () => {
	const root = await makeCliProject();
	await runCli(['init', root]);
	await writeFile(join(root, 'src/domain.virune'), 'pub record DomainValue {\n\tvalue: String\n}\n');
	assert.match((await runCli(['check', root])).stdout, /Checked 2 module/u);
	await runCli(['api', root]);
	const snapshot = JSON.parse(await readFile(join(root, 'virune.api.json'), 'utf8')) as { modules: readonly { path: string }[] };
	assert.deepEqual(snapshot.modules.map(module => module.path), ['domain.virune', 'main.virune']);
	await writeFile(join(root, 'src/broken.virune'), 'fn broken() -> String {\n\treturn 1\n}\n');
	await assert.rejects(runCli(['check', root]));
});
