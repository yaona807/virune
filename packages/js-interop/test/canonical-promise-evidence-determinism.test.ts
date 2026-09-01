import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	buildProject,
	externalOperationSequence,
	IncrementalProjectBuilder,
	type ProjectBuildResult,
} from '@virune/compiler/experimental';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type DeclarationOrder = 'promise-first' | 'marker-first';

async function createProject(order: DeclarationOrder): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-promise-identity-'));
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
	await writeFile(join(root, 'src/library.js'), [
		'export async function load() { return "ok"; }',
		'export const marker = "stable";',
		'',
	].join('\n'), 'utf8');
	const declarations = order === 'promise-first'
		? ['export declare function load(): Promise<string>;', 'export declare const marker: string;', '']
		: ['export declare const marker: string;', 'export declare function load(): Promise<string>;', ''];
	await writeFile(join(root, 'src/library.d.ts'), declarations.join('\n'), 'utf8');
	await writeFile(join(root, 'src/main.virune'), [
		'import js { load } from "./library.js"',
		'',
		'fn main() -> Unit uses JavaScript {',
		'\tdiscard load()',
		'\treturn Unit',
		'}',
		'',
	].join('\n'), 'utf8');
	return root;
}

function stableEvidence(result: ProjectBuildResult) {
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const module = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(module?.semantic);
	assert.ok(module.output);
	const operations = externalOperationSequence(module.semantic);
	const call = operations.find(operation => operation.kind === 'call');
	assert.equal(call?.kind, 'call');
	if (call?.kind === 'call') {
		assert.equal(call.result.category, 'promise');
		assert.equal(call.result.canonicalIdentity, 'ecmascript:Promise');
	}
	const serialized = JSON.stringify(operations);
	assert.doesNotMatch(serialized, /\.test-tmp|virune-interop-promise-identity|[A-Za-z]:\\|file:\/\//u);
	return { code: module.output.code, operations };
}

// @virune-rule {"id":"interop.ecmascript-canonical-identity","runner":"unit","file":"packages/js-interop/test/canonical-promise-evidence-determinism.test.ts","case":"canonical Promise stable evidence is deterministic across clean cache incremental roots and declaration order","kind":"positive","platform":"node"}
test('canonical Promise stable evidence is deterministic across clean, cache, incremental, roots, and declaration order', async () => {
	const roots: string[] = [];
	try {
		const root = await createProject('promise-first');
		roots.push(root);
		const sharedProvider = new TypeScriptInteropProvider({ projectRoot: root });
		const clean = stableEvidence(await buildProject(root, { write: false, jsInteropProvider: sharedProvider }));
		const reusedProvider = stableEvidence(await buildProject(root, { write: false, jsInteropProvider: sharedProvider }));
		const freshProvider = stableEvidence(await buildProject(root, { write: false, jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) }));
		const cachedProvider = stableEvidence(await buildProject(root, { write: false, jsInteropProvider: new CachedTypeScriptInteropProvider({ projectRoot: root }) }));

		const incremental = new IncrementalProjectBuilder();
		const incrementalProvider = new TypeScriptInteropProvider({ projectRoot: root });
		const incrementalFirst = await incremental.build(root, { write: false, jsInteropProvider: incrementalProvider });
		const incrementalSecond = await incremental.build(root, { write: false, jsInteropProvider: incrementalProvider });
		assert.ok(incrementalSecond.stats.reusedCheckedModules > 0);
		const incrementalFirstStable = stableEvidence(incrementalFirst);
		const incrementalSecondStable = stableEvidence(incrementalSecond);

		const equivalentRoot = await createProject('promise-first');
		roots.push(equivalentRoot);
		const equivalent = stableEvidence(await buildProject(equivalentRoot, {
			write: false,
			jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: equivalentRoot }),
		}));

		const reorderedRoot = await createProject('marker-first');
		roots.push(reorderedRoot);
		const reordered = stableEvidence(await buildProject(reorderedRoot, {
			write: false,
			jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: reorderedRoot }),
		}));

		for (const candidate of [reusedProvider, freshProvider, cachedProvider, incrementalFirstStable, incrementalSecondStable, equivalent, reordered]) {
			assert.equal(candidate.code, clean.code);
			assert.deepEqual(candidate.operations, clean.operations);
		}
	} finally {
		await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
	}
});
