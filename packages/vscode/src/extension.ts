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
		synchronize: { fileEvents: fileWatchers },
	};
	client = new LanguageClient('virune', 'Virune Language Server', serverOptions, clientOptions);
	await client.start();
}

export async function deactivate(): Promise<void> {
	if (client !== undefined) await client.stop();
}
