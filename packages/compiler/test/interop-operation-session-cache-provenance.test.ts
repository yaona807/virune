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

test('stable API cannot inject an untracked checked semantic into an otherwise tracked experimental cache', async () => {
	const root = resolve('virtual-operation-session-mixed-cache-provenance');
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
	assert.deepEqual(externalOperationSequence({ module: firstMain.ast, semantic: firstMain.semantic }), []);

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

	await assert.rejects(
		buildProject(root, {
			write: false,
			host,
			incrementalCache: cache,
			includeConfigEntry: false,
			additionalEntries: ['src/helper.virune'],
		}),
		/Cannot promote checked results from an unregistered project cache/u,
		'a cache-level tracked flag must not authorize a different stable-created semantic',
	);
	assert.throws(
		() => externalOperationSequence({ module: exposedHelper.ast!, semantic: exposedHelper.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const rebuilt = await buildProject(root, {
		write: false,
		host,
		incrementalCache: cache,
		includeConfigEntry: false,
		additionalEntries: ['src/helper.virune'],
	});
	assert.deepEqual(rebuilt.diagnostics.filter(item => item.severity === 'error'), []);
	const rebuiltHelper = rebuilt.modules.find(module => module.source.path === helperPath);
	assert.ok(rebuiltHelper?.ast);
	assert.ok(rebuiltHelper.semantic);
	assert.notEqual(rebuiltHelper.semantic, exposedHelper.semantic, 'rejected mixed provenance must force a fresh checker result');
	assert.deepEqual(externalOperationSequence({ module: rebuiltHelper.ast, semantic: rebuiltHelper.semantic }), []);
});
