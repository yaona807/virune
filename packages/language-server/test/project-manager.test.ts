import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from '../src/analysis/project-manager.js';
import { filePathToUri } from '../src/analysis/position.js';

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
