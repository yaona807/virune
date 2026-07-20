import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const containingFile = join(repositoryRoot, 'examples', 'sample', 'main.virune');

test('return-only generic functions remain eligible for the direct facade', () => {
	const provider = new TypeScriptInteropProvider({ projectRoot: repositoryRoot });
	const nanoid = provider.resolveImport({ containingFile, moduleSpecifier: 'nanoid', kind: 'named', importedName: 'nanoid', platform: 'node' });
	assert.ok(nanoid.type);
	const result = provider.resolveCall(nanoid.type.ref, []);
	assert.equal(result?.result.primitive, 'string');
	assert.equal(result?.result.display, 'string');
});
