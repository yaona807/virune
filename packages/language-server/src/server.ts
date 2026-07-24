import {
	createConnection,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
	type InitializeParams,
	type InitializeResult,
	type TextDocumentPositionParams,
	CodeActionKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from './analysis/project-manager.js';
import { diagnosticsForPath } from './features/diagnostics.js';
import { completionItems } from './features/completion.js';
import { collectWorkspaceExports, type WorkspaceExport } from './features/auto-import.js';
import { codeActionsForDiagnostics, documentationCodeActions } from './features/code-actions.js';
import {
	declarationAt,
	definitionAt as indexedDefinitionAt,
	documentHighlightsAt,
	incomingCalls,
	outgoingCalls,
	prepareCallHierarchyAt,
	prepareRenameAt,
	referencesAt,
	renameAt,
	typeDefinitionAt,
} from './features/navigation.js';
import { documentSymbols } from './features/document-symbols.js';
import { formattingEdits } from './features/formatting.js';
import { hoverAt } from './features/hover.js';
import { semanticTokenModifiers, semanticTokens, semanticTokenTypes } from './features/semantic-tokens.js';
import { inlayHints } from './features/inlay-hints.js';
import { signatureHelpAt } from './features/signature-help.js';
import { workspaceSymbols } from './features/workspace-symbols.js';
import { codeLenses } from './features/code-lens.js';
import { organizeImportsAction } from './features/imports.js';
import { defaultEditorInformationSettings, resolveEditorInformationSettings } from './editor-information.js';
import { filePathToUri, positionToOffset, uriToFilePath } from './analysis/position.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let projectManager = new ProjectManager({ getOpenDocuments: () => documents.all() });
const pending = new Map<string, ReturnType<typeof setTimeout>>();
const generations = new Map<string, number>();
const publishedDiagnostics = new Map<string, Set<string>>();
const documentRoots = new Map<string, string>();
const completionExports = new Map<string, readonly WorkspaceExport[]>();
const completionExportPromises = new Map<string, Promise<readonly WorkspaceExport[]>>();
let completionExportRevision = 0;
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
	invalidateCompletionExports();
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			documentFormattingProvider: true,
			hoverProvider: true,
			inlayHintProvider: true,
			signatureHelpProvider: { triggerCharacters: ['(', ','], retriggerCharacters: [','] },
			documentSymbolProvider: true,
			declarationProvider: true,
			definitionProvider: true,
			typeDefinitionProvider: true,
			referencesProvider: true,
			documentHighlightProvider: true,
			renameProvider: { prepareProvider: true },
			callHierarchyProvider: true,
			workspaceSymbolProvider: true,
			codeLensProvider: { resolveProvider: false },
			completionProvider: { triggerCharacters: ['.', '@'] },
			semanticTokensProvider: {
				legend: { tokenTypes: [...semanticTokenTypes], tokenModifiers: [...semanticTokenModifiers] },
				full: true,
			},
			codeActionProvider: {
				codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.Refactor, CodeActionKind.SourceOrganizeImports],
			},
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
		const snapshot = await projectManager.analyzeDocument(uri);
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

async function analyzeDocumentPosition(params: TextDocumentPositionParams) {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return undefined;
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	if (snapshot === undefined || module === undefined) return undefined;
	return { snapshot, module, offset: positionToOffset(module.source, params.position) };
}

async function analyzeIndexedPosition(params: TextDocumentPositionParams) {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return undefined;
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	if (snapshot === undefined || module === undefined) return undefined;
	return { snapshot, module, offset: positionToOffset(module.source, params.position) };
}

async function analyzeCompletionPosition(params: TextDocumentPositionParams) {
	const analysis = await analyzeDocumentPosition(params);
	if (analysis === undefined) return undefined;
	const workspaceExports = await workspaceExportsFor(params.textDocument.uri, analysis.snapshot.root);
	return { ...analysis, workspaceExports };
}

async function workspaceExportsFor(uri: string, root: string): Promise<readonly WorkspaceExport[]> {
	const existing = completionExports.get(root);
	if (existing !== undefined) return existing;
	const pendingExports = completionExportPromises.get(root);
	if (pendingExports !== undefined) return pendingExports;
	const revision = completionExportRevision;
	const promise = projectManager.analyzeWorkspaceDocument(uri)
		.then(snapshot => snapshot === undefined ? [] : collectWorkspaceExports(snapshot.modulesByPath));
	completionExportPromises.set(root, promise);
	try {
		const exports = await promise;
		if (completionExportRevision === revision && completionExportPromises.get(root) === promise) completionExports.set(root, exports);
		return exports;
	} finally {
		if (completionExportPromises.get(root) === promise) completionExportPromises.delete(root);
	}
}

function invalidateCompletionExports(): void {
	completionExportRevision++;
	completionExports.clear();
	completionExportPromises.clear();
}

connection.onDocumentFormatting(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? [] : [...formattingEdits(module.source)];
});

connection.onHover(async params => {
	const analysis = await analyzeDocumentPosition(params);
	return analysis === undefined ? undefined : hoverAt(analysis.module, analysis.module.source, analysis.offset, {
		settings: editorInformationSettings,
		sourcesById: analysis.snapshot.sourcesById,
	});
});

connection.languages.inlayHint.on(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? [] : [...inlayHints(module, params.range, editorInformationSettings)];
});

connection.onSignatureHelp(async params => {
	const analysis = await analyzeDocumentPosition(params);
	return analysis === undefined ? undefined : signatureHelpAt(analysis.module, analysis.module.source, analysis.offset);
});

connection.onDocumentSymbol(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? [] : [...documentSymbols(module)];
});

connection.onDeclaration(async params => {
	const snapshot = await projectManager.analyzeDocumentIndexed(params.textDocument.uri);
	const result = snapshot === undefined ? undefined : declarationAt(snapshot, params.textDocument.uri, params.position);
	return result === undefined ? undefined : [result];
});

connection.onDefinition(async params => {
	const snapshot = await projectManager.analyzeDocumentIndexed(params.textDocument.uri);
	const result = snapshot === undefined ? undefined : indexedDefinitionAt(snapshot, params.textDocument.uri, params.position);
	return result === undefined ? undefined : [result];
});

connection.onTypeDefinition(async params => {
	const snapshot = await projectManager.analyzeDocumentIndexed(params.textDocument.uri);
	const result = snapshot === undefined ? undefined : typeDefinitionAt(snapshot, params.textDocument.uri, params.position);
	return result === undefined ? undefined : [result];
});

connection.onReferences(async params => {
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	return snapshot === undefined ? [] : [...referencesAt(snapshot, params.textDocument.uri, params.position, params.context.includeDeclaration)];
});

connection.onDocumentHighlight(async params => {
	const snapshot = await projectManager.analyzeDocumentIndexed(params.textDocument.uri);
	return snapshot === undefined ? [] : [...documentHighlightsAt(snapshot, params.textDocument.uri, params.position)];
});

connection.onPrepareRename(async params => {
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	return snapshot === undefined ? undefined : prepareRenameAt(snapshot, params.textDocument.uri, params.position);
});

connection.onRenameRequest(async params => {
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	return snapshot === undefined ? undefined : renameAt(snapshot, params.textDocument.uri, params.position, params.newName);
});

connection.languages.callHierarchy.onPrepare(async params => {
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	return snapshot === undefined ? [] : [...prepareCallHierarchyAt(snapshot, params.textDocument.uri, params.position)];
});

connection.languages.callHierarchy.onIncomingCalls(async params => {
	const snapshot = await projectManager.analyze(params.item.uri);
	return snapshot === undefined ? [] : [...incomingCalls(snapshot, params.item)];
});

connection.languages.callHierarchy.onOutgoingCalls(async params => {
	const snapshot = await projectManager.analyze(params.item.uri);
	return snapshot === undefined ? [] : [...outgoingCalls(snapshot, params.item)];
});

connection.onCompletion(async params => {
	const analysis = await analyzeCompletionPosition(params);
	return analysis === undefined ? [] : [...completionItems(analysis.module, analysis.module.source, analysis.offset, analysis.workspaceExports)];
});

connection.onWorkspaceSymbol(async params => {
	const snapshots = await projectManager.analyzeWorkspace();
	return [...workspaceSymbols(snapshots, params.query)];
});

connection.onCodeLens(async params => {
	if (!editorInformationSettings.codeLens.references && !editorInformationSettings.codeLens.callers) return [];
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyze(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return snapshot === undefined || module === undefined ? [] : [...codeLenses(snapshot, module, editorInformationSettings)];
});

connection.languages.semanticTokens.on(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return { data: [] };
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? { data: [] } : semanticTokens(module);
});

connection.onCodeAction(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	if (snapshot === undefined || module === undefined) return [];
	const organizeImports = organizeImportsAction(module);
	return [
		...codeActionsForDiagnostics(snapshot, path, params.context.diagnostics),
		...documentationCodeActions(module, module.source, params.range.start.line),
		...(organizeImports === undefined ? [] : [organizeImports]),
	];
});

connection.onDidChangeConfiguration(params => {
	editorInformationSettings = resolveEditorInformationSettings(params.settings);
});

connection.onDidChangeWatchedFiles(() => {
	invalidateCompletionExports();
	projectManager.invalidate();
	for (const document of documents.all()) scheduleDiagnostics(document.uri);
});

documents.onDidOpen(event => scheduleDiagnostics(event.document.uri));
documents.onDidChangeContent(event => scheduleDiagnostics(event.document.uri));
documents.onDidSave(event => {
	invalidateCompletionExports();
	scheduleDiagnostics(event.document.uri);
});
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
