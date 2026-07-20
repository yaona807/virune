import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const containingFile = join(repositoryRoot, 'examples', 'sample', 'main.virune');

test('named imports from CommonJS packages are rejected conservatively', () => {
	const provider = new TypeScriptInteropProvider({ projectRoot: repositoryRoot });
	const result = compileSource({ id: 1, path: containingFile, text: `import js { uniqueId } from "lodash"\n` }, { emit: false, platform: 'node', jsInteropProvider: provider });
	assert.ok(result.diagnostics.some(item => item.code === 'L4211'));
});
