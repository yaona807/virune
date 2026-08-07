import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { snapshotProjectBuild } from '../src/selfhost/bootstrap-artifact-snapshot.js';
import { materializeBootstrapCompilerCandidate } from '../src/selfhost/bootstrap-execution-probe.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'd'.repeat(64),
};

interface CanonicalModule {
	readonly canonicalizeProjectCompilerResultJson: (encoded: string) => {
		readonly $tag: 'Ok' | 'Err';
		readonly $values: readonly unknown[];
	};
}

interface Diagnostic {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly sourcePath: string | null;
	readonly span: {
		readonly start: { readonly offset: number; readonly line: number; readonly column: number };
		readonly end: { readonly offset: number; readonly line: number; readonly column: number };
	};
	readonly notes: readonly string[];
}

const diagnostic = (code: string, offset: number, notes: readonly string[] = []): Diagnostic => ({
	code,
	severity: 'error',
	message: `message ${code}`,
	sourcePath: 'src/main.virune',
	span: {
		start: { offset, line: offset + 1, column: 1 },
		end: { offset: offset + 1, line: offset + 1, column: 2 },
	},
	notes,
});

const firstDiagnostic = diagnostic('L1001', 1, ['first']);
const secondDiagnostic = diagnostic('L1002', 2, ['second']);

const unorderedResult = {
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	accepted: false,
	diagnostics: [secondDiagnostic, firstDiagnostic, firstDiagnostic],
	emittedModules: [],
	dependencies: [],
	exportedSymbols: [],
	stats: {
		parsedModules: 1,
		reusedParsedModules: 0,
		checkedModules: 0,
		reusedCheckedModules: 0,
		emittedModules: 0,
		reusedEmittedModules: 0,
		invalidatedModules: 0,
	},
};

test('generated project result boundary sorts and deduplicates diagnostics deterministically', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const moduleUrl = `${pathToFileURL(join(root, 'dist/project-compiler-canonical.js')).href}?test=${Date.now()}`;
		const module = await import(moduleUrl) as CanonicalModule;
		const encoded = JSON.stringify(unorderedResult);
		const first = module.canonicalizeProjectCompilerResultJson(encoded);
		const second = module.canonicalizeProjectCompilerResultJson(encoded);
		assert.equal(first.$tag, 'Ok');
		assert.equal(second.$tag, 'Ok');
		assert.equal(first.$values[0], second.$values[0]);
		assert.equal(typeof first.$values[0], 'string');
		const canonical = JSON.parse(first.$values[0] as string) as typeof unorderedResult;
		assert.deepEqual(canonical.diagnostics, [firstDiagnostic, secondDiagnostic]);
		assert.deepEqual(canonical.emittedModules, unorderedResult.emittedModules);
		assert.deepEqual(canonical.dependencies, unorderedResult.dependencies);
		assert.deepEqual(canonical.exportedSymbols, unorderedResult.exportedSymbols);
		assert.deepEqual(canonical.stats, unorderedResult.stats);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
