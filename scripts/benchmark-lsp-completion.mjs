import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from '../packages/language-server/dist/src/analysis/project-manager.js';
import { filePathToUri } from '../packages/language-server/dist/src/analysis/position.js';
import { collectWorkspaceExports } from '../packages/language-server/dist/src/features/auto-import.js';
import { completionItems } from '../packages/language-server/dist/src/features/completion.js';

const moduleCounts = [100, 500, 1_000];
const report = [];

for (const moduleCount of moduleCounts) {
	const root = await mkdtemp(join(tmpdir(), `virune-lsp-completion-${moduleCount}-`));
	try {
		const sourceDirectory = join(root, 'src');
		await mkdir(sourceDirectory);
		const mainPath = join(sourceDirectory, 'main.virune');
		const mainText = 'fn main() -> Int => val\n';
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
		await writeFile(mainPath, mainText);
		await Promise.all(Array.from({ length: moduleCount - 1 }, async (_, index) => {
			const path = join(sourceDirectory, `module-${String(index).padStart(4, '0')}.virune`);
			await writeFile(path, `pub fn value${index}() -> Int => ${index}\n`);
		}));
		let document = TextDocument.create(filePathToUri(mainPath), 'virune', 1, mainText);
		const manager = new ProjectManager({
			getOpenDocuments: () => [document],
			workspaceFolders: [root],
		});

		const coldStart = performance.now();
		const focused = await manager.analyzeDocument(document.uri);
		const workspace = await manager.analyzeWorkspaceDocument(document.uri);
		if (focused === undefined || workspace === undefined) throw new Error('LSP benchmark analysis failed');
		const module = focused.modulesByPath.get(mainPath);
		if (module === undefined) throw new Error('LSP benchmark main module missing');
		const exports = collectWorkspaceExports(workspace.modulesByPath);
		completionItems(module, module.source, mainText.lastIndexOf('val') + 3, exports);
		const coldMs = performance.now() - coldStart;

		document = TextDocument.create(document.uri, 'virune', 2, mainText.replace('val', 'valu'));
		const editStart = performance.now();
		const edited = await manager.analyzeDocument(document.uri);
		if (edited === undefined) throw new Error('LSP benchmark edited analysis failed');
		const editedModule = edited.modulesByPath.get(mainPath);
		if (editedModule === undefined) throw new Error('LSP benchmark edited module missing');
		completionItems(editedModule, editedModule.source, editedModule.source.text.lastIndexOf('valu') + 4, exports);
		const editedMs = performance.now() - editStart;

		report.push({ modules: moduleCount, initialCompletionMs: coldMs, editedCompletionMs: editedMs });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

console.table(report);
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
