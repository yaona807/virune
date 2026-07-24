import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import * as vscode from 'vscode';

export async function run() {
	const extension = vscode.extensions.getExtension('virune.virune-vscode');
	assert.ok(extension, 'Installed Virune extension was not discovered.');
	const expectedRoot = process.env.VIRUNE_VSIX_EXTENSIONS_DIR;
	assert.ok(expectedRoot && extension.extensionPath.startsWith(expectedRoot), `Virune was not loaded from the isolated VSIX directory: ${extension.extensionPath}`);
	assert.equal(extension.packageJSON.main, './dist/extension.cjs');
	await extension.activate();
	assert.equal(extension.isActive, true);

	const workspaceRoot = process.env.VIRUNE_VSIX_WORKSPACE;
	assert.ok(workspaceRoot);
	const sourcePath = vscode.Uri.file(`${workspaceRoot}/src/main.virune`);
	await mkdir(dirname(sourcePath.fsPath), { recursive: true });
	const source = 'pub fn add(left: Int,right: Int)->Int => left+right\n\nfn main() {\nlet total=add(1,2)\nreturn total\n}\n';
	await writeFile(sourcePath.fsPath, source, 'utf8');
	const document = await vscode.workspace.openTextDocument(sourcePath);
	await vscode.window.showTextDocument(document);
	await waitFor(() => vscode.languages.getDiagnostics(sourcePath).length === 0, 'diagnostics');

	const completion = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', sourcePath, new vscode.Position(3, 2));
	assert.ok(completion && completion.items.length > 0, 'Completion provider returned no items.');
	const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', sourcePath, { tabSize: 4, insertSpaces: false });
	assert.ok(Array.isArray(edits), 'Formatting provider did not respond.');
	const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', sourcePath);
	assert.ok(Array.isArray(symbols) && symbols.some(symbol => symbol.name === 'add'), 'Language Server did not return document symbols.');
}

async function waitFor(predicate, label) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for ${label}.`);
}
