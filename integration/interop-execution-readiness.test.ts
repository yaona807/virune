import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { makeCliProject, runCli } from './cli-test-helpers.js';

async function configureProject(root: string, platform: 'node' | 'browser'): Promise<void> {
	await runCli(['init', root]);
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform,
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: true,
		sourcesContent: true,
	}, null, 2) + '\n');
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function load(): string;\n');
	await writeFile(join(root, 'src/library.js'), 'throw new Error("interop-runtime-should-not-execute");\nexport function load() { return "ok"; }\n');
}

function interopMain(): string {
	return [
		'import js { load } from "./library.js"',
		'',
		'pub fn main() -> Unit uses JavaScript {',
		'\tdiscard load()',
		'\treturn Unit',
		'}',
		'',
	].join('\n');
}

function rejectedForRuntimeResolution(error: unknown): boolean {
	if (typeof error !== 'object' || error === null || !('stderr' in error)) return false;
	const stderr = String((error as { stderr: string }).stderr);
	return stderr.includes('error[INTEROP_RUNTIME_RESOLUTION]')
		&& stderr.includes('refusing direct execution')
		&& !stderr.includes('interop-runtime-should-not-execute');
}

test('CLI check and build preserve pending bundler obligations while run refuses direct execution', async () => {
	const root = await makeCliProject();
	await configureProject(root, 'browser');
	await writeFile(join(root, 'src/main.virune'), interopMain());

	assert.match((await runCli(['check', root])).stdout, /Checked/u);
	assert.match((await runCli(['build', root])).stdout, /Built/u);
	await assert.rejects(runCli(['run', root]), rejectedForRuntimeResolution);
});

test('CLI test refuses to spawn tests with pending runtime resolution', async () => {
	const root = await makeCliProject();
	await configureProject(root, 'browser');
	await writeFile(join(root, 'src/main.virune'), 'pub fn main() -> Unit {\n\treturn Unit\n}\n');
	await writeFile(join(root, 'src/runtime.test.virune'), [
		'import js { load } from "./library.js"',
		'',
		'test "runtime resolution" { expect(true) }',
		'',
	].join('\n'));

	await assert.rejects(runCli(['test', root]), rejectedForRuntimeResolution);
});

test('CLI run preserves direct execution when Node runtime resolution is discharged', async () => {
	const root = await makeCliProject();
	await configureProject(root, 'node');
	await writeFile(join(root, 'src/library.js'), 'export function load() { return "ok"; }\n');
	await writeFile(join(root, 'src/main.virune'), interopMain());

	await runCli(['run', root]);
});
