import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { JsInteropProvider } from '@virune/compiler/experimental';
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
	assert.equal(lodash.witness.declarationEntry, 'index.d.ts');
	assert.equal(JSON.stringify(lodash.witness).includes(repositoryRoot), false);
	assert.equal(lodash.type?.category, 'function');
});

test('whole-usage resolution preserves the existing CommonJS default-import semantics', () => {
	const provider = new TypeScriptInteropProvider({ projectRoot: repositoryRoot });
	const lodash = provider.resolveImport({ containingFile, moduleSpecifier: 'lodash', kind: 'default', platform: 'node' });
	assert.ok(lodash.type);
	const interopProvider: JsInteropProvider = provider;
	assert.ok(interopProvider.resolveCallUsage);
	const resolution = interopProvider.resolveCallUsage(lodash.type.ref, {
		target: { kind: 'value' },
		arguments: [{ kind: 'native-primitive', primitive: 'String', literal: { kind: 'String', value: 'value' } }],
	});
	assert.ok(resolution, 'a valid existing CommonJS default import must remain callable in the whole-usage Program');
});
