import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const containingFile = join(repositoryRoot, 'examples', 'sample', 'main.virune');
const provider = new TypeScriptInteropProvider({ projectRoot: repositoryRoot });
const resolvePackage = (moduleSpecifier: string, kind: 'named' | 'default' | 'namespace', importedName?: string) => provider.resolveImport({ containingFile, moduleSpecifier, kind, ...(importedName === undefined ? {} : { importedName }), platform: 'node' });

test('real npm corpus resolves pinned ESM and declaration packages', () => {
	const cases = [
		resolvePackage('nanoid', 'named', 'nanoid'),
		resolvePackage('date-fns', 'named', 'addDays'),
		resolvePackage('axios', 'default'),
		resolvePackage('zod', 'named', 'z'),
		resolvePackage('rxjs', 'named', 'of'),
	];
	for (const item of cases) {
		assert.ok(item.type);
		assert.ok(item.witness.packageVersion);
		assert.ok(item.witness.declarationEntry);
		assert.match(item.witness.providerVersion, /^typescript-/u);
	}
});
