import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const projectCompilerPath = join(repositoryRoot, 'selfhost', 'mvp', 'src', 'project-compiler-contract.virune');
const emitterPath = join(repositoryRoot, 'selfhost', 'mvp', 'src', 'emitter.virune');

test('Self-host project runtime preamble imports propagate when the emitter uses propagate calls', async () => {
	const [projectCompiler, emitter] = await Promise.all([
		readFile(projectCompilerPath, 'utf8'),
		readFile(emitterPath, 'utf8'),
	]);

	assert.match(emitter, /return "propagate\(" \+ value \+ "\)"/u);

	const runtimeImportMatch = projectCompiler.match(
		/fn runtimeImportLine\(\) -> String \{\n\treturn "([^"]+)"\n\}/u,
	);
	const runtimeImportLine = runtimeImportMatch?.[1] ?? '';
	assert.notEqual(runtimeImportLine, '');
	assert.match(runtimeImportLine, /\bpropagate\b/u);
	assert.match(runtimeImportLine, /from '@virune\/runtime\/v2\/index\.js';$/u);
});
