import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const containingFile = join(repositoryRoot, 'examples', 'sample', 'main.virune');

test('Node standard module declarations are available to the direct facade', () => {
	const provider = new TypeScriptInteropProvider({ projectRoot: repositoryRoot });
	const readFile = provider.resolveImport({ containingFile, moduleSpecifier: 'node:fs/promises', kind: 'named', importedName: 'readFile', platform: 'node' });
	assert.equal(readFile.type?.category, 'function');
	assert.match(readFile.type?.display ?? '', /Promise/u);
});
