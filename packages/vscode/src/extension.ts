import { join } from 'node:path';
import { workspace, type ExtensionContext } from 'vscode';
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
	context.subscriptions.push(...fileWatchers);
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
	};
}
