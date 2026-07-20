import {
	createConnection,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
	type InitializeParams,
	type InitializeResult,
	type TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from './analysis/project-manager.js';
import { diagnosticsForPath } from './features/diagnostics.js';
import { completionItems } from './features/completion.js';
import { codeActionsForDiagnostics } from './features/code-actions.js';
import { definitionAt } from './features/definition.js';
import { documentSymbols } from './features/document-symbols.js';
import { formattingEdits } from './features/formatting.js';
import { hoverAt } from './features/hover.js';
import { semanticTokenModifiers, semanticTokens, semanticTokenTypes } from './features/semantic-tokens.js';
import { inlayHints } from './features/inlay-hints.js';
import { signatureHelpAt } from './features/signature-help.js';
import { defaultEditorInformationSettings, resolveEditorInformationSettings } from './editor-information.js';
import { filePathToUri, positionToOffset, uriToFilePath } from './analysis/position.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let projectManager = new ProjectManager({ getOpenDocuments: () => documents.all() });
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const generations = new Map<string, number>();
const publishedDiagnostics = new Map<string, Set<string>>();
const documentRoots = new Map<string, string>();
let editorInformationSettings = defaultEditorInformationSettings;

connection.onInitialize((params: InitializeParams): InitializeResult => {
	editorInformationSettings = resolveEditorInformationSettings(params.initializationOptions);
	const workspaceFolders = params.workspaceFolders
		?.map(folder => uriToFilePath(folder.uri))
		.filter((path): path is string => path !== undefined);
	projectManager = new ProjectManager({
		getOpenDocuments: () => documents.all(),
		...(workspaceFolders === undefined ? {} : { workspaceFolders }),
	});
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			documentFormattingProvider: true,
			hoverProvider: true,
			inlayHintProvider: true,
			signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [','] },
			documentSymbolProvider: true,
			definitionProvider: true,
			completionProvider: { triggerCharacters: ['.', '@'] },
			semanticTokensProvider: {
				legend: { tokenTypes: [...semanticTokenTypes], tokenModifiers: [...semanticTokenModifiers] },
				full: true,
			},
			codeActionProvider: true,
		},
		serverInfo: {
			name: 'Virune Language Server',
			version: '1.0.0',
		},
	};
});

function scheduleDiagnostics(uri: string): void {
	const previous = pending.get(uri);
	if (previous !== undefined) clearTimeout(previous);
	const generation = (generations.get(uri) ?? 0) + 1;
	generations.set(uri, generation);
	pending.set(uri, setTimeout(() => {
		pending.delete(uri);
		void publishDiagnostics(uri, generation);
	}, 150));
}

async function publishDiagnostics(uri: string, generation: number): Promise<void> {
	try {
		const snapshot = await projectManager.analyze(uri);
		if (snapshot === undefined || generations.get(uri) !== generation) return;
		const openVersions = new Map<string, number>();
		for (const document of documents.all()) {
			const documentPath = uriToFilePath(document.uri);
			if (documentPath === undefined) continue;
			const documentUri = filePathToUri(documentPath);
			openVersions.set(documentUri, document.version);
			if (snapshot.modulesByPath.has(documentPath)) documentRoots.set(document.uri, snapshot.root);
		}
		const currentUris = new Set<string>();
		for (const path of snapshot.modulesByPath.keys()) {
			const moduleUri = filePathToUri(path);
			currentUris.add(moduleUri);
			const moduleDiagnostics = [...diagnosticsForPath(snapshot, path)];
			const version = openVersions.get(moduleUri);
			connection.sendDiagnostics(version === undefined
				? { uri: moduleUri, diagnostics: moduleDiagnostics }
				: { uri: moduleUri, version, diagnostics: moduleDiagnostics });
		}
		for (const previousUri of publishedDiagnostics.get(snapshot.root) ?? []) {
			if (!currentUris.has(previousUri)) connection.sendDiagnostics({ uri: previousUri, diagnostics: [] });
		}
		publishedDiagnostics.set(snapshot.root, currentUris);
	} catch (error) {
		connection.console.error(`Virune analysis failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	}
}

async function analyzePosition(params: TextDocumentPositionParams) {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return undefined;
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	if (snapshot === undefined || module === undefined) return undefined;
	return { snapshot, module, offset: positionToOffset(module.source, params.position) };
}

connection.onDocumentFormatting(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? [] : [...formattingEdits(module.source)];
});

connection.onHover(async params => {
	const analysis = await analyzePosition(params);
	return analysis === undefined ? undefined : hoverAt(analysis.module, analysis.module.source, analysis.offset, {
		settings: editorInformationSettings,
		sourcesById: analysis.snapshot.sourcesById,
	});
});

connection.languages.inlayHint.on(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? [] : [...inlayHints(module, params.range, editorInformationSettings)];
});

connection.onSignatureHelp(async params => {
	const analysis = await analyzePosition(params);
	return analysis === undefined ? undefined : signatureHelpAt(analysis.module, analysis.module.source, analysis.offset);
});

connection.onDocumentSymbol(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? [] : [...documentSymbols(module)];
});

connection.onDefinition(async params => {
	const analysis = await analyzePosition(params);
	return analysis === undefined ? undefined : definitionAt(analysis.snapshot, analysis.module, analysis.module.source, analysis.offset);
});

connection.onCompletion(async params => {
	const analysis = await analyzePosition(params);
	return analysis === undefined ? [] : [...completionItems(analysis.module, analysis.module.source, analysis.offset)];
});

connection.languages.semanticTokens.on(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return { data: [] };
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? { data: [] } : semanticTokens(module);
});

connection.onCodeAction(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	return snapshot === undefined ? [] : [...codeActionsForDiagnostics(snapshot, path, params.context.diagnostics)];
});

connection.onDidChangeConfiguration(params => {
	editorInformationSettings = resolveEditorInformationSettings(params.settings);
});

connection.onDidChangeWatchedFiles(() => {
	projectManager.invalidate();
	for (const document of documents.all()) scheduleDiagnostics(document.uri);
});

documents.onDidOpen(event => scheduleDiagnostics(event.document.uri));
documents.onDidChangeContent(event => scheduleDiagnostics(event.document.uri));
documents.onDidSave(event => scheduleDiagnostics(event.document.uri));
documents.onDidClose(event => {
	const timer = pending.get(event.document.uri);
	if (timer !== undefined) clearTimeout(timer);
	pending.delete(event.document.uri);
	generations.delete(event.document.uri);
	const root = documentRoots.get(event.document.uri);
	documentRoots.delete(event.document.uri);
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	if (root !== undefined && ![...documentRoots.values()].includes(root)) {
		for (const publishedUri of publishedDiagnostics.get(root) ?? []) {
			connection.sendDiagnostics({ uri: publishedUri, diagnostics: [] });
		}
		publishedDiagnostics.delete(root);
	}
});

documents.listen(connection);
connection.listen();
