import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from '../src/analysis/project-manager.js';
import { filePathToUri } from '../src/analysis/position.js';
import { collectWorkspaceExports } from '../src/features/auto-import.js';

test('collectWorkspaceExports exposes public workspace declarations without a semantic index', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-lsp-auto-import-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'src');
	await mkdir(sourceDirectory);
	const mainPath = join(sourceDirectory, 'main.virune');
	const utilityPath = join(sourceDirectory, 'utility.virune');
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
	const mainText = 'fn main() -> Int => 1\n';
	await writeFile(mainPath, mainText);
	await writeFile(utilityPath, 'pub fn multiply(left: Int, right: Int) -> Int => left * right\n\nfn hidden() -> Int => 0\n');
	const document = TextDocument.create(filePathToUri(mainPath), 'virune', 1, mainText);
	const manager = new ProjectManager({
		getOpenDocuments: () => [document],
		workspaceFolders: [root],
	});

	const snapshot = await manager.analyzeWorkspaceDocument(document.uri);
	assert.ok(snapshot);
	assert.equal('index' in snapshot, false);
	const exports = collectWorkspaceExports(snapshot.modulesByPath);
	assert.deepEqual(
		exports.filter(item => item.modulePath === utilityPath).map(item => ({ name: item.name, kind: item.kind })),
		[{ name: 'multiply', kind: 'function' }],
	);
});
