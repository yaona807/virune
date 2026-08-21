import assert from 'node:assert/strict';
import test from 'node:test';
import { checkModule as checkModuleBase } from '../src/checker/checker.js';
import { checkModule } from '../src/interop/checked-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

test('nested same-AST base check during provider resolution cannot register the outer semantic under the nested witness', () => {
	const source = {
		id: 1,
		path: '/virtual/reentrant-check.virune',
		text: [
			'import js "./library.js"',
			'',
			'fn main() -> Unit uses JavaScript {}',
			'',
		].join('\n'),
	};
	const parsed = parseSource(source);
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);

	let nestedCheckRan = false;
	const provider: JsInteropProvider = {
		id: 'reentrant-check-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			if (!nestedCheckRan) {
				nestedCheckRan = true;
				const nested = checkModuleBase(parsed.ast!, {
					containingFile: source.path,
					platform: 'node',
				});
				assert.ok(nested.diagnostics.items.some(item => item.code === 'L4200'));
			}
			return {
				runtime: { kind: 'side-effect' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'reentrant-check-provider-1',
				},
			};
		},
		getProperty() { return undefined; },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return '<external>'; },
	};

	assert.throws(
		() => checkModule(parsed.ast!, {
			containingFile: source.path,
			platform: 'node',
			jsInteropProvider: provider,
		}),
		/Cannot re-register checked semantic after its checker witness has changed/u,
	);
	assert.equal(nestedCheckRan, true);
});
