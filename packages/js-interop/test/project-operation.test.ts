import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildProject, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('project builds derive the same provider-independent operation contract from checked modules', async () => {
	const root = await fixtureRoot();
	await writeFile(
		join(root, 'src/main.virune'),
		`import js { greet } from "./library.js"\n\nfn main() -> String uses JavaScript {\n\treturn greet("Project")\n}\n`,
		'utf8',
	);
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: false, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const module = result.modules.find(item => item.source.path === join(root, 'src/main.virune'));
	assert.ok(module?.ast);
	assert.ok(module.semantic);
	const operations = externalOperationSequence({
		module: module.ast,
		semantic: module.semantic,
	});
	assert.deepEqual(operations.map(operation => operation.kind), [
		'module-load',
		'call',
		'bridge-foreign-primitive',
	]);
	assert.equal(JSON.stringify(operations).includes(root.replaceAll('\\', '/')), false);
	provider.dispose();
});
