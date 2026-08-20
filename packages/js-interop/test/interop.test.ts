import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import {
	compileSource,
	externalOperationSequence,
	isResolvedDirectInteropDecision,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('TypeScript provider resolves a conservative primitive facade', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const imported = provider.resolveImport({
		containingFile: join(root, 'src/main.virune'),
		moduleSpecifier: './library.js',
		kind: 'named',
		importedName: 'greet',
		platform: 'node',
	});
	assert.equal(imported.type?.category, 'function');
	assert.ok(imported.type);
	const result = provider.resolveCall(imported.type.ref, [{ kind: 'native-primitive', primitive: 'String' }]);
	assert.equal(result?.result.primitive, 'string');
});

test('compiler emits direct JavaScript import, checked primitive bridge, and provider-independent operations', async () => {
	const root = await fixtureRoot();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const source = {
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { greet } from "./library.js"\n\nfn main() -> String uses JavaScript {\n\treturn greet("Virune")\n}\n`,
	};
	const result = compileSource(source, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.match(result.output?.code ?? '', /import \{ greet \} from "\.\/library\.js"/u);
	assert.match(result.output?.code ?? '', /checkForeignString\(greet\("Virune"\)\)/u);
	const usage = result.semantic?.interop.usageIR.find(item => item.kind === 'call');
	assert.ok(usage);
	assert.equal('ref' in usage.foreignType, false);
	assert.doesNotThrow(() => JSON.stringify(result.semantic?.interop.usageIR));

	assert.ok(result.ast);
	assert.ok(result.semantic);
	const operations = externalOperationSequence({
		module: result.ast,
		interop: result.semantic.interop,
		diagnostics: result.diagnostics,
	});
	assert.deepEqual(operations.map(operation => operation.kind), [
		'module-load',
		'call',
		'bridge-foreign-primitive',
	]);
	assert.equal(operations[0]?.kind, 'module-load');
	if (operations[0]?.kind === 'module-load') {
		assert.equal(operations[0].moduleSpecifier, './library.js');
		assert.equal(isResolvedDirectInteropDecision(operations[0].decision), true);
		assert.equal(operations[0].runtimeWitness?.runtimeFormat, 'esm');
	}
	assert.equal(operations[1]?.kind, 'call');
	assert.equal(operations[2]?.kind, 'bridge-foreign-primitive');
	const serialized = JSON.stringify(operations);
	assert.equal(serialized.includes(root.replaceAll('\\', '/')), false);
	assert.equal(serialized.includes('providerVersion'), false);
	assert.equal(serialized.includes('declarationEntry'), false);
	assert.equal(serialized.includes('declarationGraphHash'), false);
});
