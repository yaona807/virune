import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject } from '../src/interop/checked-api.js';
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
		id: 'source-intrinsics-provider',
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
					providerVersion: 'source-intrinsics-provider-1',
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

function mainModule(result: Awaited<ReturnType<typeof buildProject>>) {
	const checked = result.modules.filter(module => module.ast !== undefined && module.semantic !== undefined);
	assert.equal(checked.length, 1);
	return checked[0]!;
}

function operationKinds(result: Awaited<ReturnType<typeof buildProject>>): readonly string[] {
	const main = mainModule(result);
	return externalOperationSequence({ module: main.ast!, semantic: main.semantic! }).map(operation => operation.kind);
}

test('inherited Array map cannot erase checked source structure and promote a scalar-mutated cached AST', async () => {
	const root = resolve('virtual-operation-session-source-intrinsics-project');
	const mainPath = join(root, 'src/main.virune');
	const host = hostFor(mainPath);
	const cache = new ProjectBuildCache();
	const previous = Object.getOwnPropertyDescriptor(Array.prototype, 'map');
	const originalMap = Array.prototype.map;
	Object.defineProperty(Array.prototype, 'map', {
		configurable: true,
		writable: true,
		value(this: unknown[], callback: (...args: unknown[]) => unknown, thisArg?: unknown): unknown[] {
			let hasId = false;
			let hasKind = false;
			let hasSpan = false;
			for (let index = 0; index < this.length; index++) {
				if (this[index] === 'id') hasId = true;
				else if (this[index] === 'kind') hasKind = true;
				else if (this[index] === 'span') hasSpan = true;
			}
			if (hasId && hasKind && hasSpan) return [];
			return Reflect.apply(originalMap, this, [callback, thisArg]) as unknown[];
		},
	});
	try {
		const first = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: provider() });
		assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
		assert.deepEqual(operationKinds(first), ['module-load', 'module-load']);
		const firstMain = mainModule(first);
		(firstMain.ast!.imports[0] as { typeOnly: boolean }).typeOnly = true;

		await assert.rejects(
			buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: provider() }),
			/Cannot reuse experimental project cache after its checked result was mutated/u,
		);
	} finally {
		if (previous === undefined) delete (Array.prototype as { map?: unknown }).map;
		else Object.defineProperty(Array.prototype, 'map', previous);
	}

	const rebuilt = await buildProject(root, { write: false, host, incrementalCache: cache, jsInteropProvider: provider() });
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(operationKinds(rebuilt), ['module-load', 'module-load']);
});
