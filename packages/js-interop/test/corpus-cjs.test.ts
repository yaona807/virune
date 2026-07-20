import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const containingFile = join(repositoryRoot, 'examples', 'sample', 'main.virune');

test('corpus identifies CommonJS runtime declarations supplied by @types', () => {
	const provider = new TypeScriptInteropProvider({ projectRoot: repositoryRoot });
	const lodash = provider.resolveImport({ containingFile, moduleSpecifier: 'lodash', kind: 'default', platform: 'node' });
	assert.equal(lodash.witness.packageName, 'lodash');
	assert.equal(lodash.witness.packageVersion, '4.18.1');
	assert.equal(lodash.witness.declarationPackageName, '@types/lodash');
	assert.equal(lodash.witness.declarationPackageVersion, '4.17.24');
	assert.equal(lodash.witness.runtimeFormat, 'commonjs');
	assert.match(lodash.witness.declarationEntry ?? '', /node_modules[\\/]@types[\\/]lodash/u);
	assert.equal(lodash.type?.category, 'function');
});
