import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { IncrementalProjectBuilder, type ProjectBuildResult } from '@virune/compiler/experimental';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from '../src/analysis/project-manager.js';
import { filePathToUri } from '../src/analysis/position.js';

const emptyBuildResult = { modules: [], diagnostics: [], stats: {} } as unknown as ProjectBuildResult;

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise<void>(resolve => setTimeout(resolve, 5));
	}
	assert.fail('Timed out waiting for condition');
}

test('ProjectManager.invalidate reloads changed files outside the editor overlay', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-lsp-cache-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'src');
	await mkdir(sourceDirectory);
	const mainPath = join(sourceDirectory, 'main.virune');
	const dependencyPath = join(sourceDirectory, 'value.virune');
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
	const mainText = 'import { value } from "./value.virune"\n\nfn main() -> Int => value()\n';
	await writeFile(mainPath, mainText);
	await writeFile(dependencyPath, 'pub fn value() -> Int => 1\n');
	const document = TextDocument.create(filePathToUri(mainPath), 'virune', 1, mainText);
	const manager = new ProjectManager({ getOpenDocuments: () => [document] });
	const initial = await manager.analyze(document.uri);
	assert.ok(initial);
	assert.equal(initial.result.diagnostics.length, 0);
	assert.equal(initial.result.stats.parsedModules, 2);
	assert.equal(initial.result.stats.checkedModules, 2);

	await writeFile(dependencyPath, 'pub fn value() -> String => "changed"\n');
	const cached = await manager.analyze(document.uri);
	assert.equal(cached, initial);
	manager.invalidate();
	const refreshed = await manager.analyze(document.uri);
	assert.ok(refreshed);
	assert.notEqual(refreshed, initial);
	assert.equal(refreshed.result.diagnostics.some(diagnostic => diagnostic.severity === 'error'), true);
	assert.equal(refreshed.result.stats.parsedModules, 1);
	assert.equal(refreshed.result.stats.reusedParsedModules, 1);
	assert.equal(refreshed.result.stats.checkedModules, 2);
});

test('ProjectManager keeps latency-sensitive document analysis focused and deduplicated', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-lsp-focused-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const mainPath = join(root, 'main.virune');
	const unrelatedPath = join(root, 'unrelated.virune');
	const mainText = 'fn main() -> Int => 1\n';
	await writeFile(mainPath, mainText);
	await writeFile(unrelatedPath, 'pub fn unrelated() -> Int => 2\n');
	const document = TextDocument.create(filePathToUri(mainPath), 'virune', 1, mainText);
	const manager = new ProjectManager({
		getOpenDocuments: () => [document],
		workspaceFolders: [root],
	});

	const [first, second] = await Promise.all([
		manager.analyzeDocument(document.uri),
		manager.analyzeDocument(document.uri),
	]);
	assert.ok(first);
	assert.equal(second, first);
	assert.equal(first.modulesByPath.has(unrelatedPath), false);

	const focusedIndex = await manager.analyzeDocumentIndexed(document.uri);
	assert.ok(focusedIndex);
	assert.equal(focusedIndex.modulesByPath.has(unrelatedPath), false);

	const workspace = await manager.analyze(document.uri);
	assert.ok(workspace);
	assert.equal(workspace.modulesByPath.has(unrelatedPath), true);
});

test('ProjectManager replaces intermediate queued builds with the latest document version', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-lsp-latest-build-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const mainPath = join(root, 'main.virune');
	const uri = filePathToUri(mainPath);
	const text = 'fn main() -> Int => 1\n';
	await writeFile(mainPath, text);
	let document = TextDocument.create(uri, 'virune', 1, text);
	let buildCount = 0;
	let releaseFirst!: () => void;
	const firstBuildGate = new Promise<void>(resolve => { releaseFirst = resolve; });
	const manager = new ProjectManager({
		getOpenDocuments: () => [document],
		workspaceFolders: [root],
		createBuilder: () => ({
			build: async () => {
				buildCount++;
				if (buildCount === 1) await firstBuildGate;
				return emptyBuildResult;
			},
		} as unknown as IncrementalProjectBuilder),
	});

	const requests = [manager.analyzeDocument(uri)];
	await waitFor(() => buildCount === 1);
	for (let version = 2; version <= 20; version++) {
		document = TextDocument.create(uri, 'virune', version, text);
		requests.push(manager.analyzeDocument(uri));
	}
	// Root discovery is asynchronous. Keep the first build gated until every
	// rapid request has had enough time to reach the latest-only build lane.
	await new Promise<void>(resolve => setTimeout(resolve, 500));
	assert.equal(buildCount, 1);
	releaseFirst();
	const results = await Promise.all(requests);
	assert.equal(buildCount, 2);
	assert.ok(results.at(-1));
});

test('ProjectManager skips semantic index creation after request cancellation', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-lsp-cancelled-index-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const mainPath = join(root, 'main.virune');
	const uri = filePathToUri(mainPath);
	const text = 'fn main() -> Int => 1\n';
	await writeFile(mainPath, text);
	const document = TextDocument.create(uri, 'virune', 1, text);
	let buildStarted = false;
	let releaseBuild!: () => void;
	const buildGate = new Promise<void>(resolve => { releaseBuild = resolve; });
	let semanticIndexBuilds = 0;
	const manager = new ProjectManager({
		getOpenDocuments: () => [document],
		workspaceFolders: [root],
		createBuilder: () => ({
			build: async () => {
				buildStarted = true;
				await buildGate;
				return emptyBuildResult;
			},
		} as unknown as IncrementalProjectBuilder),
		createSemanticIndex: async () => {
			semanticIndexBuilds++;
			throw new Error('Semantic index should not be created for a cancelled request');
		},
	});
	const token = { isCancellationRequested: false };
	const request = manager.analyze(uri, token);
	await waitFor(() => buildStarted);
	token.isCancellationRequested = true;
	releaseBuild();
	assert.equal(await request, undefined);
	assert.equal(semanticIndexBuilds, 0);
});
