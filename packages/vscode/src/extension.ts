import { join } from 'node:path';
import {
	CodeActionKind,
	Position,
	Range,
	commands,
	window,
	workspace,
	type CodeAction,
	type Command,
	type ExtensionContext,
} from 'vscode';
import {
	LanguageClient,
	TransportKind,
	type LanguageClientOptions,
	type ServerOptions,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
	const serverModule = context.asAbsolutePath(join('dist', 'server.cjs'));
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc },
	};
	const fileWatchers = [
		workspace.createFileSystemWatcher('**/*.virune'),
		workspace.createFileSystemWatcher('**/virune.json'),
		workspace.createFileSystemWatcher('**/package.json'),
	];
	context.subscriptions.push(
		...fileWatchers,
		commands.registerCommand('virune.generateDocumentationComment', () => applyDocumentationAction('Generate documentation comment')),
		commands.registerCommand('virune.generateModuleDocumentation', () => applyDocumentationAction('Generate module documentation', new Position(0, 0))),
	);
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'virune' }],
		outputChannelName: 'Virune Language Server',
		initializationOptions: editorInformationSettings(),
		synchronize: { configurationSection: 'virune', fileEvents: fileWatchers },
	};
	client = new LanguageClient('virune', 'Virune Language Server', serverOptions, clientOptions);
	await client.start();
}

export async function deactivate(): Promise<void> {
	if (client !== undefined) await client.stop();
}

function editorInformationSettings(): object {
	const configuration = workspace.getConfiguration('virune');
	return {
		inlayHints: {
			variableTypes: { enabled: configuration.get('inlayHints.variableTypes.enabled', true) },
			functionReturnTypes: { enabled: configuration.get('inlayHints.functionReturnTypes.enabled', true) },
			parameterNames: configuration.get('inlayHints.parameterNames', 'literals'),
			forLoopVariableTypes: { enabled: configuration.get('inlayHints.forLoopVariableTypes.enabled', true) },
			lambdaParameterTypes: { enabled: configuration.get('inlayHints.lambdaParameterTypes.enabled', true) },
		},
		hover: {
			showEffects: configuration.get('hover.showEffects', true),
			showModule: configuration.get('hover.showModule', true),
		},
		codeLens: {
			references: { enabled: configuration.get('codeLens.references.enabled', false) },
			callers: { enabled: configuration.get('codeLens.callers.enabled', false) },
			visibility: configuration.get('codeLens.visibility', 'public'),
		},
	};
}

async function applyDocumentationAction(title: string, requestedPosition?: Position): Promise<void> {
	const editor = window.activeTextEditor;
	if (editor === undefined || editor.document.languageId !== 'virune') return;
	const position = requestedPosition ?? editor.selection.active;
	const range = new Range(position, position);
	const actions = await commands.executeCommand<readonly (CodeAction | Command)[]>(
		'vscode.executeCodeActionProvider',
		editor.document.uri,
		range,
		CodeActionKind.Refactor,
	);
	const action = actions?.find(candidate => candidate.title === title);
	if (action === undefined) return;
	if ('edit' in action && action.edit !== undefined) await workspace.applyEdit(action.edit);
	if (isCommand(action)) {
		await commands.executeCommand(action.command, ...(action.arguments ?? []));
	} else if (action.command !== undefined) {
		await commands.executeCommand(action.command.command, ...(action.command.arguments ?? []));
	}
}

function isCommand(action: CodeAction | Command): action is Command {
	return typeof action.command === 'string';
}
