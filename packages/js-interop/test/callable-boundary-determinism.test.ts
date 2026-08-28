import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	buildProject,
	externalOperationSequence,
	IncrementalProjectBuilder,
	type ProjectBuildResult,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function createProject(): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-callable-determinism-'));
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: false,
		sourcesContent: false,
	}), 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function consume(callback: (value: number) => number): void;\n', 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function consume(callback) { callback(1); }\n', 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import js { consume } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\npub fn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`, 'utf8');
	return root;
}

function stableResult(result: ProjectBuildResult) {
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const module = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(module?.semantic);
	assert.ok(module.output);
	return {
		code: module.output.code,
		operations: externalOperationSequence(module.semantic),
	};
}

test('callable helper and stable operation evidence are deterministic across clean, cached-provider, incremental, and equivalent-root builds', async () => {
	const root = await createProject();
	const sharedProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const clean = stableResult(await buildProject(root, { write: false, jsInteropProvider: sharedProvider }));
	const reusedProvider = stableResult(await buildProject(root, { write: false, jsInteropProvider: sharedProvider }));
	const freshProvider = stableResult(await buildProject(root, { write: false, jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) }));

	const incremental = new IncrementalProjectBuilder();
	const incrementalProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const incrementalFirst = await incremental.build(root, { write: false, jsInteropProvider: incrementalProvider });
	const incrementalSecond = await incremental.build(root, { write: false, jsInteropProvider: incrementalProvider });
	assert.ok(incrementalSecond.stats.reusedCheckedModules > 0);
	const incrementalFirstStable = stableResult(incrementalFirst);
	const incrementalSecondStable = stableResult(incrementalSecond);

	const equivalentRoot = await createProject();
	const equivalent = stableResult(await buildProject(equivalentRoot, {
		write: false,
		jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: equivalentRoot }),
	}));

	for (const candidate of [reusedProvider, freshProvider, incrementalFirstStable, incrementalSecondStable, equivalent]) {
		assert.equal(candidate.code, clean.code);
		assert.deepEqual(candidate.operations, clean.operations);
	}
});
