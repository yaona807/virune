import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { compileSource, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileOperations(root: string): Promise<string> {
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const source = {
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { greet } from "./library.js"\n\nfn main() -> String uses JavaScript {\n\treturn greet("Virune")\n}\n`,
	};
	const result = compileSource(source, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.ast);
	assert.ok(result.semantic);
	const operations = externalOperationSequence({
		module: result.ast,
		semantic: result.semantic,
	});
	const serialized = JSON.stringify(operations);
	assert.equal(serialized.includes(root.replaceAll('\\', '/')), false);
	provider.dispose();
	return serialized;
}

test('equivalent TypeScript provider checkouts serialize byte-identical External Operation evidence', async () => {
	const firstRoot = await fixtureRoot();
	const secondRoot = await fixtureRoot();
	assert.notEqual(firstRoot, secondRoot);
	assert.equal(await compileOperations(firstRoot), await compileOperations(secondRoot));
});
