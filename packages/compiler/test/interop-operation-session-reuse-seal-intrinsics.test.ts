import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

const sourceText = [
	'import js { first, second } from "./library.js"',
	'',
	'fn main() -> Unit uses JavaScript {}',
	'',
].join('\n');

function provider(): JsInteropProvider {
	return {
		id: 'reuse-seal-intrinsics-provider',
		version: '1',
		generation: 1,
		resolveImport(request) {
			if (request.kind !== 'named') throw new Error('test provider expects named imports');
			const importedName = request.importedName ?? 'missing';
			return {
				type: {
					ref: { providerId: 'reuse-seal-intrinsics-provider', generation: 1, id: importedName },
					display: 'Value',
					category: 'object',
					origin: { moduleSpecifier: request.moduleSpecifier, exportName: importedName },
				},
				runtime: { kind: 'named', importedName },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: importedName === 'first' ? 'dist/library.js' : 'dist/other.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'reuse-seal-intrinsics-provider-1',
				},
			};
		},
		getProperty() { return undefined; },
		resolveCall() { return undefined; },
		resolveConstruct() { return undefined; },
		getAwaitedType() { return undefined; },
		display() { return 'Value'; },
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

function gatedHostFor(mainPath: string): {
	readonly host: ProjectHost;
	readonly entered: Promise<void>;
	readonly release: () => void;
} {
	let markEntered: () => void = () => {};
	let releaseGate: () => void = () => {};
	const entered = new Promise<void>(resolveEntered => { markEntered = resolveEntered; });
	const gate = new Promise<void>(resolveGate => { releaseGate = resolveGate; });
	return {
		entered,
		release: () => releaseGate(),
		host: {
			async readFile(path) {
				if (path === mainPath) {
					markEntered();
					await gate;
					return sourceText;
				}
				throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
			},
		},
	};
}

function installSelectiveKeyIterator(): () => void {
	const previous = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
	const original = Array.prototype[Symbol.iterator];
	Object.defineProperty(Array.prototype, Symbol.iterator, {
		configurable: true,
		writable: true,
		value: function selectiveIterator(this: unknown[]) {
			let hasUsages = false;
			let hasUsageIR = false;
			let hasModuleWitnesses = false;
			let hasInitialization = false;
			for (let index = 0; index < this.length; index++) {
				if (this[index] === 'usages') hasUsages = true;
				else if (this[index] === 'usageIR') hasUsageIR = true;
				else if (this[index] === 'moduleWitnesses') hasModuleWitnesses = true;
				else if (this[index] === 'requiresJavaScriptInitialization') hasInitialization = true;
			}
			if (hasUsages && hasUsageIR && hasModuleWitnesses && hasInitialization) {
				const retained: unknown[] = [];
				for (let index = 0; index < this.length; index++) {
					if (this[index] !== 'moduleWitnesses') retained[retained.length] = this[index];
				}
				return Reflect.apply(original, retained, []) as IterableIterator<unknown>;
			}
			return Reflect.apply(original, this, []) as IterableIterator<unknown>;
		},
	});
	return () => {
		if (previous === undefined) Reflect.deleteProperty(Array.prototype, Symbol.iterator);
		else Object.defineProperty(Array.prototype, Symbol.iterator, previous);
	};
}

test('inherited key iteration cannot hide mid-build module-witness mutation from the cached semantic reuse seal', async () => {
	const root = resolve('virtual-operation-session-reuse-seal-intrinsics');
	const mainPath = join(root, 'src/main.virune');
	const cache = new ProjectBuildCache();
	const restoreIterator = installSelectiveKeyIterator();
	try {
		const first = await buildProject(root, {
			write: false,
			host: hostFor(mainPath),
			incrementalCache: cache,
			jsInteropProvider: provider(),
		});
		assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
		const firstMain = first.modules.find(module => module.source.path === mainPath);
		assert.ok(firstMain?.ast);
		assert.ok(firstMain.semantic);
		const firstOperations = externalOperationSequence({ module: firstMain.ast, semantic: firstMain.semantic });
		assert.equal(firstOperations.length, 1);
		assert.equal(firstOperations[0]?.kind, 'module-load');
		assert.equal(firstOperations[0]?.decision.status, 'unresolved');
		assert.ok(firstMain.semantic.interop.moduleWitnesses.length >= 2);

		const gated = gatedHostFor(mainPath);
		const pending = buildProject(root, {
			write: false,
			host: gated.host,
			incrementalCache: cache,
			jsInteropProvider: provider(),
		});
		await gated.entered;
		const secondWitness = firstMain.semantic.interop.moduleWitnesses[1];
		assert.ok(secondWitness);
		(secondWitness as { runtimeEntry?: string }).runtimeEntry = 'dist/library.js';
		gated.release();
		await assert.rejects(
			pending,
			/Cannot reuse checked semantic after its operation evidence changed/u,
			'mid-build mutation must not be re-snapshotted as new current truth when inherited key iteration hides that field',
		);
	} finally {
		restoreIterator();
	}

	const rebuilt = await buildProject(root, {
		write: false,
		host: hostFor(mainPath),
		incrementalCache: cache,
		jsInteropProvider: provider(),
	});
	assert.equal(rebuilt.stats.reusedParsedModules, 0);
	assert.equal(rebuilt.stats.reusedCheckedModules, 0);
	const rebuiltMain = rebuilt.modules.find(module => module.source.path === mainPath);
	assert.ok(rebuiltMain?.ast);
	assert.ok(rebuiltMain.semantic);
	const rebuiltOperations = externalOperationSequence({ module: rebuiltMain.ast, semantic: rebuiltMain.semantic });
	assert.equal(rebuiltOperations[0]?.kind, 'module-load');
	assert.equal(rebuiltOperations[0]?.decision.status, 'unresolved');
});
