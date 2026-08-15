import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as vscode from 'vscode';

export async function run() {
	const extension = vscode.extensions.getExtension('virune.virune-vscode');
	assert.ok(extension, 'Installed Virune extension was not discovered.');
	const expectedRoot = process.env.VIRUNE_VSIX_EXTENSIONS_DIR;
	assert.ok(expectedRoot && extension.extensionPath.startsWith(expectedRoot), `Virune was not loaded from the isolated VSIX directory: ${extension.extensionPath}`);
	assert.equal(extension.packageJSON.main, './dist/extension.cjs');
	assert.equal(extension.packageJSON.license, 'Apache-2.0');
	await verifyInstalledLegalFiles(extension.extensionPath);
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

async function verifyInstalledLegalFiles(extensionPath) {
	const repositoryRoot = process.env.VIRUNE_REPOSITORY_ROOT;
	assert.ok(repositoryRoot, 'VIRUNE_REPOSITORY_ROOT is required for installed legal-file verification.');
	const comparisons = [
		['LICENSE', resolve(repositoryRoot, 'LICENSE')],
		['NOTICE', resolve(repositoryRoot, 'NOTICE')],
		['THIRD_PARTY_NOTICES.md', resolve(repositoryRoot, 'packages/vscode/THIRD_PARTY_NOTICES.md')],
	];
	for (const [installedPath, expectedPath] of comparisons) {
		const [actual, expected] = await Promise.all([
			readFile(resolve(extensionPath, installedPath)),
			readFile(expectedPath),
		]);
		assert.deepEqual(actual, expected, `Installed VSIX ${installedPath} differs from the reviewed packaging input.`);
	}

	const generatedLegalText = await readFile(resolve(extensionPath, 'dist/THIRD_PARTY_LICENSES.txt'), 'utf8');
	assert.ok(generatedLegalText.trim().length > 0, 'Installed VSIX third-party license text is empty.');
	assert.match(generatedLegalText, /^Virune VS Code Extension — Bundled Third-Party License Texts$/mu);
	assert.match(generatedLegalText, /^PACKAGE: .+@.+$/mu);
	assert.match(generatedLegalText, /^DECLARED LICENSE: .+$/mu);
	assert.match(generatedLegalText, /^FILE: (?:LICENSE|LICENCE|COPYING)/imu);
}

async function waitFor(predicate, label) {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for ${label}.`);
}
