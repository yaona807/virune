import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import { buildProject as buildProjectBase, ProjectBuildCache, type ProjectHost } from '../src/project/project.js';

function hostFor(files: ReadonlyMap<string, string>): ProjectHost {
	return {
		async readFile(path) {
			const text = files.get(path);
			if (text !== undefined) return text;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

test('inherited result-module iteration cannot spoof tracked reuse counts and promote stable cache provenance', async () => {
	const root = resolve('virtual-operation-session-cache-provenance-intrinsics');
	const mainPath = join(root, 'src/main.virune');
	const helperPath = join(root, 'src/helper.virune');
	const files = new Map([
		[mainPath, 'fn main() -> Unit {}\n'],
		[helperPath, 'fn helper() -> Unit {}\n'],
	]);
	const host = hostFor(files);
	const cache = new ProjectBuildCache();

	const first = await buildProject(root, { write: false, host, incrementalCache: cache });
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);

	const stableHelper = await buildProjectBase(root, {
		write: false,
		host,
		incrementalCache: cache,
		includeConfigEntry: false,
		additionalEntries: ['src/helper.virune'],
	});
	assert.deepEqual(stableHelper.diagnostics.filter(item => item.severity === 'error'), []);
	const exposedHelper = stableHelper.modules.find(module => module.source.path === helperPath);
	assert.ok(exposedHelper?.ast);
	assert.ok(exposedHelper.semantic);
	assert.throws(
		() => externalOperationSequence({ module: exposedHelper.ast!, semantic: exposedHelper.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const previous = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
	const original = Array.prototype[Symbol.iterator];
	Object.defineProperty(Array.prototype, Symbol.iterator, {
		configurable: true,
		writable: true,
		value: function provenanceSpoofingIterator(this: unknown[]) {
			const stack = new Error().stack ?? '';
			if (stack.includes('trackedReusedParsedCount') || stack.includes('trackedReusedSemanticCount')) {
				return Reflect.apply(original, [firstMain], []) as IterableIterator<unknown>;
			}
			return Reflect.apply(original, this, []) as IterableIterator<unknown>;
		},
	});
	try {
		await assert.rejects(
			buildProject(root, {
				write: false,
				host,
				incrementalCache: cache,
				includeConfigEntry: false,
				additionalEntries: ['src/helper.virune'],
			}),
			/Cannot promote parsed or checked results from an unregistered or changed project cache/u,
			'reuse accounting must inspect actual result modules rather than inherited iteration results',
		);
	} finally {
		if (previous === undefined) Reflect.deleteProperty(Array.prototype, Symbol.iterator);
		else Object.defineProperty(Array.prototype, Symbol.iterator, previous);
	}

	assert.throws(
		() => externalOperationSequence({ module: exposedHelper.ast!, semantic: exposedHelper.semantic! }),
		/not from the current checked AST semantic session/u,
		'rejected stable-created semantic must remain outside the experimental session registry',
	);

	const rebuilt = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		includeConfigEntry: false,
		additionalEntries: ['src/helper.virune'],
	});
	assert.equal(rebuilt.stats.reusedParsedModules, 0);
	assert.equal(rebuilt.stats.reusedCheckedModules, 0);
	const rebuiltHelper = rebuilt.modules.find(module => module.source.path === helperPath);
	assert.ok(rebuiltHelper?.ast);
	assert.ok(rebuiltHelper.semantic);
	assert.notEqual(rebuiltHelper.semantic, exposedHelper.semantic);
	assert.deepEqual(externalOperationSequence({ module: rebuiltHelper.ast, semantic: rebuiltHelper.semantic }), []);
});
