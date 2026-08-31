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
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-unknown-determinism-'));
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
	await writeFile(join(root, 'src/library.js'), `
const value = { stable: true };
export function foreignValue() { return value; }
export function acceptUnknown(_value) { return true; }
`, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), `
export declare function foreignValue(): unknown;
export declare function acceptUnknown(value: unknown): boolean;
`, 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import js { foreignValue, acceptUnknown } from "./library.js"

pub fn main(value: String) -> Bool uses JavaScript {
	let foreign: Unknown = foreignValue()
	discard acceptUnknown(foreign)
	let erased: Unknown = value
	return acceptUnknown(erased)
}
`, 'utf8');
	return root;
}

function stableResult(result: ProjectBuildResult) {
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const module = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(module?.semantic);
	assert.ok(module.output);
	const operations = externalOperationSequence(module.semantic);
	const serialized = JSON.stringify(operations);
	assert.doesNotMatch(serialized, /\.test-tmp|virune-interop-unknown-determinism|[A-Za-z]:\\|file:\/\//u);
	assert.match(module.output.code, /version: 'virune-safe-ffi\/v1', type: \{ kind: 'unknown' \}/u);
	return { code: module.output.code, operations };
}

// @virune-rule {"id":"ffi.unknown-provenance","runner":"integration","file":"packages/js-interop/test/unknown-provenance-determinism.test.ts","case":"Unknown provenance output and evidence are deterministic across clean, provider-cache, incremental, and equivalent-root builds","kind":"positive","platform":"node"}
test('Unknown provenance output and evidence are deterministic across clean, provider-cache, incremental, and equivalent-root builds', async () => {
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