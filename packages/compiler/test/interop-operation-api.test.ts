import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject, checkModule, compileSource } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { parseSource, ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

function providerForGeneration(generation: number): JsInteropProvider {
	return {
		id: 'test-provider',
		version: '1',
		generation,
		resolveImport(request) {
			return {
				type: {
					ref: { providerId: 'test-provider', generation, id: 'value' },
					display: 'Value',
					category: 'object',
					origin: { moduleSpecifier: request.moduleSpecifier, exportName: request.importedName ?? 'value' },
				},
				runtime: { kind: 'named', importedName: request.importedName ?? 'value' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: `provider-${generation}`,
				},
			};
		},
		getProperty() {
			return {
				ref: { providerId: 'test-provider', generation, id: 'field' },
				display: 'string',
				category: 'primitive',
				primitive: 'string',
				origin: { moduleSpecifier: './library.js', exportName: 'field' },
			};
		},
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
	};
}

const provider = providerForGeneration(1);
const source = {
	id: 1,
	path: '/virtual/main.virune',
	text: [
		'import js { value } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard value.field',
		'}',
		'',
	].join('\n'),
};

function operationKinds(module: NonNullable<ReturnType<typeof parseSource>['ast']>, semantic: Parameters<typeof externalOperationSequence>[0]['semantic']): readonly string[] {
	return externalOperationSequence({ module, semantic }).map(operation => operation.kind);
}

test('public operation derivation is bound to the exact AST that produced its SemanticModel', () => {
	const checked = compileSource(source, { emit: false, jsInteropProvider: provider });
	assert.deepEqual(checked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(checked.ast);
	assert.ok(checked.semantic);
	assert.deepEqual(operationKinds(checked.ast, checked.semantic), ['module-load', 'read-property']);

	const reparsed = parseSource(source);
	assert.ok(reparsed.ast);
	assert.deepEqual(reparsed.diagnostics.filter(item => item.severity === 'error'), []);
	assert.throws(
		() => externalOperationSequence({ module: reparsed.ast!, semantic: checked.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const separatelyChecked = compileSource(source, { emit: false, jsInteropProvider: provider });
	assert.deepEqual(separatelyChecked.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(separatelyChecked.ast);
	assert.ok(separatelyChecked.semantic);
	assert.throws(
		() => externalOperationSequence({ module: separatelyChecked.ast!, semantic: checked.semantic! }),
		/not from the current checked AST semantic session/u,
	);
});

test('checking the same AST again invalidates the previous semantic session', () => {
	const parsed = parseSource(source);
	assert.ok(parsed.ast);
	assert.deepEqual(parsed.diagnostics.filter(item => item.severity === 'error'), []);

	const first = checkModule(parsed.ast, { containingFile: source.path, platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(first.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(parsed.ast, first), ['module-load', 'read-property']);

	const second = checkModule(parsed.ast, { containingFile: source.path, platform: 'node', jsInteropProvider: providerForGeneration(2) });
	assert.deepEqual(second.diagnostics.items.filter(item => item.severity === 'error'), []);
	assert.throws(
		() => externalOperationSequence({ module: parsed.ast!, semantic: first }),
		/not from the current checked AST semantic session/u,
	);
	assert.deepEqual(operationKinds(parsed.ast, second), ['module-load', 'read-property']);
});

test('incremental project recheck invalidates retained semantics when the parsed AST is reused', async () => {
	const root = resolve('virtual-operation-session-project');
	const mainPath = join(root, 'src/main.virune');
	const host: ProjectHost = {
		async readFile(path) {
			if (path === mainPath) return source.text;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: providerForGeneration(1) });
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(firstMain.ast, firstMain.semantic), ['module-load', 'read-property']);

	const second = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: providerForGeneration(2) });
	const secondMain = second.modules.find(module => module.source.path === mainPath);
	assert.ok(secondMain?.ast);
	assert.ok(secondMain.semantic);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(second.stats.reusedParsedModules > 0);
	assert.equal(secondMain.ast, firstMain.ast, 'test must exercise the same cached parsed AST object');
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);
	assert.deepEqual(operationKinds(secondMain.ast, secondMain.semantic), ['module-load', 'read-property']);
});
