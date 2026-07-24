import { basename } from 'node:path';
import {
	createConnection,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
	FileChangeType,
	type CancellationToken,
	type FileEvent,
	type InitializeParams,
	type InitializeResult,
	type TextDocumentPositionParams,
	CodeActionKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager, type ProjectInvalidationOptions } from './analysis/project-manager.js';
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
const pendingDiagnostics = new Map<string, ReturnType<typeof setTimeout>>();
const diagnosticGenerations = new Map<string, number>();
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
	void scheduleDiagnosticsForUri(uri);
}

async function scheduleDiagnosticsForUri(uri: string): Promise<void> {
	const root = await projectManager.projectRootForUri(uri);
	if (root === undefined) return;
	documentRoots.set(uri, root);
	scheduleProjectDiagnostics(root);
}

function scheduleProjectDiagnostics(root: string): void {
	const previous = pendingDiagnostics.get(root);
	if (previous !== undefined) clearTimeout(previous);
	const generation = (diagnosticGenerations.get(root) ?? 0) + 1;
	diagnosticGenerations.set(root, generation);
	pendingDiagnostics.set(root, setTimeout(() => {
		pendingDiagnostics.delete(root);
		void publishProjectDiagnostics(root, generation);
	}, 150));
}

async function publishProjectDiagnostics(root: string, generation: number): Promise<void> {
	try {
		const entry = documents.all().find(document => documentRoots.get(document.uri) === root);
		if (entry === undefined) return;
		const snapshot = await projectManager.analyzeWorkspaceDocument(entry.uri);
		if (snapshot === undefined || snapshot.root !== root || diagnosticGenerations.get(root) !== generation) return;
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
		for (const previousUri of publishedDiagnostics.get(root) ?? []) {
			if (!currentUris.has(previousUri)) connection.sendDiagnostics({ uri: previousUri, diagnostics: [] });
		}
		publishedDiagnostics.set(root, currentUris);
	} catch (error) {
		connection.console.error(`Virune analysis failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	}
}

function isCancelled(token: CancellationToken | undefined): boolean {
	return token?.isCancellationRequested === true;
}

async function analyzeDocumentPosition(params: TextDocumentPositionParams, token?: CancellationToken) {
	if (isCancelled(token)) return undefined;
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return undefined;
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri, token);
	if (snapshot === undefined || isCancelled(token)) return undefined;
	const module = snapshot.modulesByPath.get(path);
	if (module === undefined) return undefined;
	return { snapshot, module, offset: positionToOffset(module.source, params.position) };
}

async function analyzeCompletionPosition(params: TextDocumentPositionParams, token?: CancellationToken) {
	const analysis = await analyzeDocumentPosition(params, token);
	if (analysis === undefined || isCancelled(token)) return undefined;
	const workspaceExports = await workspaceExportsFor(params.textDocument.uri, analysis.snapshot.root, token);
	if (isCancelled(token)) return undefined;
	return { ...analysis, workspaceExports };
}

async function workspaceExportsFor(uri: string, root: string, token?: CancellationToken): Promise<readonly WorkspaceExport[]> {
	if (isCancelled(token)) return [];
	const existing = completionExports.get(root);
	if (existing !== undefined) return existing;
	const pendingExports = completionExportPromises.get(root);
	if (pendingExports !== undefined) {
		const exports = await pendingExports;
		return isCancelled(token) ? [] : exports;
	}
	const revision = completionExportRevision;
	const promise = projectManager.analyzeWorkspaceDocument(uri, token)
		.then(snapshot => snapshot === undefined ? [] : collectWorkspaceExports(snapshot.modulesByPath));
	completionExportPromises.set(root, promise);
	try {
		const exports = await promise;
		if (!isCancelled(token) && completionExportRevision === revision && completionExportPromises.get(root) === promise) {
			completionExports.set(root, exports);
		}
		return isCancelled(token) ? [] : exports;
	} finally {
		if (completionExportPromises.get(root) === promise) completionExportPromises.delete(root);
	}
}

function invalidateCompletionExports(root?: string): void {
	completionExportRevision++;
	if (root === undefined) {
		completionExports.clear();
		completionExportPromises.clear();
		return;
	}
	completionExports.delete(root);
	completionExportPromises.delete(root);
}

connection.onDocumentFormatting(async params => {
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri);
	const module = snapshot?.modulesByPath.get(path);
	return module === undefined ? [] : [...formattingEdits(module.source)];
});

connection.onHover(async (params, token) => {
	const analysis = await analyzeDocumentPosition(params, token);
	if (analysis === undefined || isCancelled(token)) return undefined;
	return hoverAt(analysis.module, analysis.module.source, analysis.offset, {
		settings: editorInformationSettings,
		sourcesById: analysis.snapshot.sourcesById,
	});
});

connection.languages.inlayHint.on(async (params, token) => {
	if (isCancelled(token)) return [];
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return [];
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri, token);
	if (snapshot === undefined || isCancelled(token)) return [];
	const module = snapshot.modulesByPath.get(path);
	return module === undefined ? [] : [...inlayHints(module, params.range, editorInformationSettings)];
});

connection.onSignatureHelp(async (params, token) => {
	const analysis = await analyzeDocumentPosition(params, token);
	return analysis === undefined || isCancelled(token) ? undefined : signatureHelpAt(analysis.module, analysis.module.source, analysis.offset);
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

connection.onCompletion(async (params, token) => {
	const analysis = await analyzeCompletionPosition(params, token);
	if (analysis === undefined || isCancelled(token)) return [];
	return [...completionItems(analysis.module, analysis.module.source, analysis.offset, analysis.workspaceExports)];
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

connection.languages.semanticTokens.on(async (params, token) => {
	if (isCancelled(token)) return { data: [] };
	const path = uriToFilePath(params.textDocument.uri);
	if (path === undefined) return { data: [] };
	const snapshot = await projectManager.analyzeDocument(params.textDocument.uri, token);
	if (snapshot === undefined || isCancelled(token)) return { data: [] };
	const module = snapshot.modulesByPath.get(path);
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

connection.onDidChangeWatchedFiles(params => {
	void handleWatchedFiles(params.changes);
});

async function handleWatchedFiles(changes: readonly FileEvent[]): Promise<void> {
	const affected = new Map<string, ProjectInvalidationOptions>();
	for (const change of changes) {
		const path = uriToFilePath(change.uri);
		if (path === undefined) continue;
		if (documents.get(change.uri) !== undefined && change.type === FileChangeType.Changed && path.endsWith('.virune')) continue;
		const root = await projectManager.projectRootForPath(path);
		const previous = affected.get(root) ?? {};
		const name = basename(path);
		const workspaceEntries = previous.workspaceEntries === true
			|| (path.endsWith('.virune') && change.type !== FileChangeType.Changed);
		const projectRoots = previous.projectRoots === true || name === 'virune.json';
		const interop = previous.interop === true || (projectManager.hasInteropProvider(root) && isInteropDependency(path));
		affected.set(root, { workspaceEntries, projectRoots, interop });
	}
	for (const [root, options] of affected) {
		projectManager.invalidateProject(root, options);
		invalidateCompletionExports(root);
		if ([...documentRoots.values()].includes(root)) scheduleProjectDiagnostics(root);
	}
}

function isInteropDependency(path: string): boolean {
	const name = basename(path);
	return name === 'package.json'
		|| /^tsconfig(?:\..+)?\.json$/u.test(name)
		|| path.endsWith('.d.ts')
		|| path.endsWith('.interop.ts')
		|| path.endsWith('.interop.tsx')
		|| path.endsWith('.interop.mts')
		|| path.endsWith('.interop.cts');
}

documents.onDidOpen(event => {
	void projectManager.projectRootForUri(event.document.uri).then(root => {
		if (root !== undefined) invalidateCompletionExports(root);
	});
	scheduleDiagnostics(event.document.uri);
});
documents.onDidChangeContent(event => scheduleDiagnostics(event.document.uri));
documents.onDidSave(event => {
	void projectManager.projectRootForUri(event.document.uri).then(root => {
		if (root !== undefined) invalidateCompletionExports(root);
	});
	scheduleDiagnostics(event.document.uri);
});
documents.onDidClose(event => {
	const root = documentRoots.get(event.document.uri);
	documentRoots.delete(event.document.uri);
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	if (root === undefined) return;
	if ([...documentRoots.values()].includes(root)) {
		scheduleProjectDiagnostics(root);
		return;
	}
	const timer = pendingDiagnostics.get(root);
	if (timer !== undefined) clearTimeout(timer);
	pendingDiagnostics.delete(root);
	diagnosticGenerations.delete(root);
	for (const publishedUri of publishedDiagnostics.get(root) ?? []) {
		connection.sendDiagnostics({ uri: publishedUri, diagnostics: [] });
	}
	publishedDiagnostics.delete(root);
});

documents.listen(connection);
connection.listen();
