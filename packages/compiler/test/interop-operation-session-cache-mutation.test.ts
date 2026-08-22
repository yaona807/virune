import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject, IncrementalProjectBuilder } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

const sourceText = [
	'import js "./first.js"',
	'import js "./second.js"',
	'',
	'fn main() -> Unit uses JavaScript {}',
	'',
].join('\n');

function provider(): JsInteropProvider {
	return {
		id: 'cache-mutation-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			if (request.kind !== 'side-effect') throw new Error('test provider expects side-effect imports');
			return {
				runtime: { kind: 'side-effect' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: `dist/${request.moduleSpecifier.replace(/^\.\//u, '')}`,
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'cache-mutation-provider-1',
				},
			};
		},
		getProperty() { return undefined; },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'unknown'; },
	};
}

function hostFor(mainPath: string): ProjectHost {
	return {
		async readFile(path) {
			if (path === mainPath) return sourceText;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

function gatedHostFor(mainPath: string): { readonly host: ProjectHost; readonly entered: Promise<void>; readonly release: () => void } {
	let markEntered: () => void = () => {};
	let release: () => void = () => {};
	const entered = new Promise<void>(resolveEntered => { markEntered = resolveEntered; });
	const gate = new Promise<void>(resolveGate => { release = resolveGate; });
	return {
		entered,
		release: () => release(),
		host: {
			async readFile(path) {
				if (path === mainPath) {
					markEntered();
					await gate;
					return sourceText;
				}
				throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
			},
	};
}

function mainModule(result: Awaited<ReturnType<typeof buildProject>>) {
	const checked = result.modules.filter(module => module.ast !== undefined && module.semantic !== undefined);
	assert.equal(checked.length, 1, 'test project must contain exactly one checked Virune module');
	return checked[0]!;
}

function operationKinds(result: Awaited<ReturnType<typeof buildProject>>): readonly string[] {
	const main = mainModule(result);
	return externalOperationSequence({ module: main.ast!, semantic: main.semantic! }).map(operation => operation.kind);
}

test('mutated cached AST cannot be promoted into a new checked session and retry rebuilds fresh source', async () => {
	const root = resolve('virtual-operation-session-cache-source-mutation-project');
	const mainPath = join(root, 'src/main.virune');
	const host = hostFor(mainPath);
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: provider() });
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(first), ['module-load', 'module-load']);
	const firstMain = mainModule(first);

	(firstMain.ast!.imports[0] as { typeOnly: boolean }).typeOnly = true;
	await assert.rejects(
		buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: provider() }),
		/Cannot reuse experimental project cache after its checked result was mutated/u,
	);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const rebuilt = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: provider() });
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(rebuilt), ['module-load', 'module-load']);
	assert.notEqual(mainModule(rebuilt).ast, firstMain.ast, 'failed cache reuse must clear the mutated parsed AST before retry');
});

test('structurally equivalent Proxy substitution cannot cross a cached project rebuild', async () => {
	const root = resolve('virtual-operation-session-cache-proxy-project');
	const mainPath = join(root, 'src/main.virune');
	const host = hostFor(mainPath);
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: provider() });
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	const firstMain = mainModule(first);
	const imports = firstMain.ast!.imports;
	const proxy = new Proxy(imports, {
		get(target, property, receiver) {
			if (property === Symbol.iterator) {
				return function* hideFirstImport() {
					yield target[1]!;
				};
			}
			return Reflect.get(target, property, receiver);
		},
	});
	assert.equal(Array.isArray(proxy), true);
	assert.equal(Object.getPrototypeOf(proxy), Array.prototype);
	assert.deepEqual(Reflect.ownKeys(proxy), Reflect.ownKeys(imports));
	(firstMain.ast as unknown as { imports: typeof imports }).imports = proxy;

	await assert.rejects(
		buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: provider() }),
		/Cannot reuse experimental project cache after its checked result was mutated/u,
	);
});

test('mutated cached semantic evidence cannot be re-approved by IncrementalProjectBuilder', async () => {
	const root = resolve('virtual-operation-session-incremental-semantic-mutation-project');
	const mainPath = join(root, 'src/main.virune');
	const host = hostFor(mainPath);
	const builder = new IncrementalProjectBuilder();
	const first = await builder.build(root, { write: false, host, jsInteropProvider: provider() });
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(first), ['module-load', 'module-load']);
	const firstMain = mainModule(first);

	(firstMain.semantic!.interop.moduleWitnesses as unknown as { length: number }).length = 1;
	await assert.rejects(
		builder.build(root, { write: false, host, jsInteropProvider: provider() }),
		/Cannot reuse experimental incremental builder after its checked result was mutated/u,
	);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const rebuilt = await builder.build(root, { write: false, host, jsInteropProvider: provider() });
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(rebuilt), ['module-load', 'module-load']);
});

test('semantic mutation during an async cached build is rejected before evidence can be re-exposed', async () => {
	const root = resolve('virtual-operation-session-cache-mid-build-mutation-project');
	const mainPath = join(root, 'src/main.virune');
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, { write: false, host: hostFor(mainPath), incrementalCache: cache, jsInteropProvider: provider() });
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(first), ['module-load', 'module-load']);
	const firstMain = mainModule(first);

	const gated = gatedHostFor(mainPath);
	const pending = buildProject(root, { write: false, host: gated.host, incrementalCache: cache, jsInteropProvider: provider() });
	await gated.entered;
	(firstMain.semantic!.interop.moduleWitnesses as unknown as { length: number }).length = 1;
	gated.release();
	await assert.rejects(
		pending,
		/Cannot reuse checked semantic after its operation evidence changed/u,
	);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const rebuilt = await buildProject(root, { write: false, host: hostFor(mainPath), incrementalCache: cache, jsInteropProvider: provider() });
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(rebuilt), ['module-load', 'module-load']);
});
