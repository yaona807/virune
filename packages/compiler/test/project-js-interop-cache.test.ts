import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { JsImportResolution, JsInteropProvider } from '../src/interop/types.js';
import { buildProject, ProjectBuildCache } from '../src/project/project.js';

function interopProvider(generation: number): JsInteropProvider {
	const resolution: JsImportResolution = {
		type: {
			ref: { providerId: 'typescript', generation, id: 'join' },
			display: '(left: string, right: string) => string',
			category: 'function',
		},
		runtime: { kind: 'named', importedName: 'join' },
		witness: {
			moduleSpecifier: 'node:path',
			conditions: ['types', 'import', 'node'],
			platform: 'node',
			providerVersion: 'typescript-test',
		},
	};
	return {
		id: 'typescript',
		version: 'typescript-test',
		generation,
		resolveImport: () => resolution,
		getProperty: () => undefined,
		resolveCall: () => undefined,
		resolveConstruct: () => undefined,
		getAwaitedType: () => undefined,
		display: type => type.id,
	};
}

test('incremental builds reuse JS import modules within one interop generation', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-js-checked-cache-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'src');
	await mkdir(sourceDirectory);
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: true,
		sourcesContent: true,
	}));
	await writeFile(join(sourceDirectory, 'main.virune'), `import js { join } from "node:path"

fn main() -> Int => 1
`);
	const cache = new ProjectBuildCache();
	const first = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: interopProvider(1) });
	assert.equal(first.diagnostics.some(diagnostic => diagnostic.severity === 'error'), false);
	assert.equal(first.stats.checkedModules, 1);
	assert.equal(first.stats.reusedCheckedModules, 0);

	const second = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: interopProvider(1) });
	assert.equal(second.stats.checkedModules, 0);
	assert.equal(second.stats.reusedCheckedModules, 1);

	// The provider generation is part of the build fingerprint, so stale
	// TypeScript handles cannot cross an invalidation boundary.
	const nextGeneration = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: interopProvider(2) });
	assert.equal(nextGeneration.stats.checkedModules, 1);
	assert.equal(nextGeneration.stats.reusedCheckedModules, 0);
});
