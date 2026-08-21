import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	buildProject,
	externalOperationSequence,
	ProjectBuildCache,
	type ProjectBuildResult,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

function operationsForMain(result: ProjectBuildResult): readonly unknown[] {
	const module = result.modules.find(item => item.source.path.endsWith('/src/main.virune') || item.source.path.endsWith('\\src\\main.virune'));
	assert.ok(module?.ast);
	assert.ok(module.semantic);
	return externalOperationSequence({
		module: module.ast,
		interop: module.semantic.interop,
		diagnostics: module.diagnostics,
	});
}

test('equivalent project builds serialize identical operations regardless of incremental file-id history', async () => {
	const root = await fixtureRoot();
	await writeFile(
		join(root, 'src/main.virune'),
		`import js { greet } from "./library.js"\n\nfn main() -> String uses JavaScript {\n\treturn greet("Project")\n}\n`,
		'utf8',
	);
	await writeFile(join(root, 'src/warmup.virune'), 'fn warmup() -> Unit {}\n', 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		const cache = new ProjectBuildCache();
		const warmup = await buildProject(root, {
			write: false,
			includeConfigEntry: false,
			additionalEntries: ['src/warmup.virune'],
			incrementalCache: cache,
			jsInteropProvider: provider,
		});
		assert.deepEqual(warmup.diagnostics.filter(item => item.severity === 'error'), []);

		const historyBuild = await buildProject(root, {
			write: false,
			incrementalCache: cache,
			jsInteropProvider: provider,
		});
		const cleanBuild = await buildProject(root, {
			write: false,
			jsInteropProvider: provider,
		});
		assert.deepEqual(historyBuild.diagnostics.filter(item => item.severity === 'error'), []);
		assert.deepEqual(cleanBuild.diagnostics.filter(item => item.severity === 'error'), []);

		const historyMain = historyBuild.modules.find(item => item.source.path === join(root, 'src/main.virune'));
		const cleanMain = cleanBuild.modules.find(item => item.source.path === join(root, 'src/main.virune'));
		assert.ok(historyMain);
		assert.ok(cleanMain);
		assert.notEqual(historyMain.source.id, cleanMain.source.id, 'test must exercise different cache-local file ids');
		assert.equal(JSON.stringify(operationsForMain(historyBuild)), JSON.stringify(operationsForMain(cleanBuild)));
	} finally {
		provider.dispose();
	}
});
