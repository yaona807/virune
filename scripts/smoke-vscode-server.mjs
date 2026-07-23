import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const documentText = 'pub fn add(left: Int, right: Int) -> Int => left + right\n\nfn inferred() {\n\tlet total = add(1, 2)\n\treturn total\n}\n';
const workspaceRoot = await mkdtemp(join(tmpdir(), 'virune-vscode-smoke-'));
const workspaceUri = pathToFileURL(workspaceRoot).href;
const documentPath = join(workspaceRoot, 'main.virune');
const documentUri = pathToFileURL(documentPath).href;
const utilityPath = join(workspaceRoot, 'utility.virune');
await writeFile(documentPath, documentText, 'utf8');
await writeFile(utilityPath, 'pub fn multiply(left: Int, right: Int) -> Int => left * right\n', 'utf8');

const server = spawn(process.execPath, [resolve('packages/vscode/dist/server.cjs'), '--stdio'], {
	cwd: process.cwd(),
	stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
server.stderr.setEncoding('utf8');
server.stderr.on('data', chunk => {
	stderr += chunk;
});

const responses = new Map();
let buffer = Buffer.alloc(0);
server.stdout.on('data', chunk => {
	buffer = Buffer.concat([buffer, chunk]);
	while (true) {
		const headerEnd = buffer.indexOf('\r\n\r\n');
		if (headerEnd < 0) return;
		const header = buffer.subarray(0, headerEnd).toString('ascii');
		const match = /(?:^|\r\n)Content-Length: (\d+)/iu.exec(header);
		if (match?.[1] === undefined) throw new Error(`Invalid LSP response header: ${header}`);
		const length = Number(match[1]);
		const bodyStart = headerEnd + 4;
		if (buffer.length < bodyStart + length) return;
		const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString('utf8'));
		buffer = buffer.subarray(bodyStart + length);
		if (message.id !== undefined) responses.get(message.id)?.(message);
	}
});

function send(message) {
	const body = Buffer.from(JSON.stringify(message));
	server.stdin.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
	server.stdin.write(body);
}

function request(id, method, params) {
	return new Promise((resolveResponse, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}. stderr: ${stderr}`)), 10_000);
		responses.set(id, message => {
			clearTimeout(timer);
			responses.delete(id);
			resolveResponse(message);
		});
		send({ jsonrpc: '2.0', id, method, params });
	});
}

try {
	const initialized = await request(1, 'initialize', {
		processId: null,
		rootUri: workspaceUri,
		capabilities: {},
		workspaceFolders: [{ uri: workspaceUri, name: 'virune-vscode-smoke' }],
		initializationOptions: {
			virune: {
				inlayHints: {
					variableTypes: { enabled: true },
					functionReturnTypes: { enabled: true },
					parameterNames: 'literals',
					forLoopVariableTypes: { enabled: true },
					lambdaParameterTypes: { enabled: true },
				},
				hover: { showEffects: true, showModule: true },
				codeLens: { references: { enabled: true }, callers: { enabled: true }, visibility: 'public' },
			},
		},
	});
	assert.equal(initialized.error, undefined);
	const capabilities = initialized.result?.capabilities;
	assert.equal(capabilities?.hoverProvider, true);
	assert.equal(capabilities?.declarationProvider, true);
	assert.equal(capabilities?.definitionProvider, true);
	assert.equal(capabilities?.typeDefinitionProvider, true);
	assert.equal(capabilities?.referencesProvider, true);
	assert.equal(capabilities?.documentHighlightProvider, true);
	assert.deepEqual(capabilities?.renameProvider, { prepareProvider: true });
	assert.equal(capabilities?.callHierarchyProvider, true);
	assert.equal(capabilities?.workspaceSymbolProvider, true);
	assert.deepEqual(capabilities?.codeLensProvider, { resolveProvider: false });
	assert.equal(capabilities?.documentSymbolProvider, true);
	assert.equal(capabilities?.inlayHintProvider, true);
	assert.deepEqual(capabilities?.signatureHelpProvider?.triggerCharacters, ['(', ',']);
	assert.equal(capabilities?.documentFormattingProvider, true);
	assert.equal(capabilities?.semanticTokensProvider?.full, true);
	assert.deepEqual(capabilities?.codeActionProvider?.codeActionKinds, ['quickfix', 'refactor', 'source.organizeImports']);
	send({ jsonrpc: '2.0', method: 'initialized', params: {} });
	send({
		jsonrpc: '2.0',
		method: 'textDocument/didOpen',
		params: {
			textDocument: {
				uri: documentUri,
				languageId: 'virune',
				version: 1,
				text: documentText,
			},
		},
	});
	const documentSymbols = await request(2, 'textDocument/documentSymbol', {
		textDocument: { uri: documentUri },
	});
	assert.equal(documentSymbols.error, undefined);
	assert.ok(Array.isArray(documentSymbols.result));
	assert.deepEqual(documentSymbols.result.map(symbol => symbol.name), ['add', 'inferred']);
	for (const symbol of documentSymbols.result) assertDocumentSymbolRanges(symbol);

	const inlayHintResponse = await request(3, 'textDocument/inlayHint', {
		textDocument: { uri: documentUri },
		range: { start: { line: 0, character: 0 }, end: offsetToPosition(documentText, documentText.length) },
	});
	assert.equal(inlayHintResponse.error, undefined);
	assert.ok(Array.isArray(inlayHintResponse.result));
	const inlayLabels = inlayHintResponse.result.map(hint => typeof hint.label === 'string' ? hint.label : JSON.stringify(hint.label));
	assert.ok(inlayLabels.includes(': Int'), `Expected inferred variable type hint; received ${JSON.stringify(inlayLabels)}`);
	assert.ok(inlayLabels.includes(' -> Int'), `Expected inferred return type hint; received ${JSON.stringify(inlayLabels)}`);
	assert.ok(inlayLabels.includes('left:'), `Expected left parameter hint; received ${JSON.stringify(inlayLabels)}`);
	assert.ok(inlayLabels.includes('right:'), `Expected right parameter hint; received ${JSON.stringify(inlayLabels)}`);

	const secondArgumentOffset = documentText.lastIndexOf('2');
	const signatureHelp = await request(4, 'textDocument/signatureHelp', {
		textDocument: { uri: documentUri },
		position: offsetToPosition(documentText, secondArgumentOffset),
		context: { triggerKind: 1, isRetrigger: false },
	});
	assert.equal(signatureHelp.error, undefined);
	assert.match(signatureHelp.result?.signatures?.[0]?.label ?? '', /fn add\(left: Int, right: Int\) -> Int/u);
	assert.equal(signatureHelp.result?.activeParameter, 1);

	const hover = await request(5, 'textDocument/hover', {
		textDocument: { uri: documentUri },
		position: offsetToPosition(documentText, documentText.lastIndexOf('add')),
	});
	assert.equal(hover.error, undefined);
	assert.match(JSON.stringify(hover.result?.contents), /fn add\(left: Int, right: Int\) -> Int/u);

	const callPosition = offsetToPosition(documentText, documentText.lastIndexOf('add'));
	const definition = await request(6, 'textDocument/definition', { textDocument: { uri: documentUri }, position: callPosition });
	assert.equal(definition.error, undefined);
	assert.equal(definition.result?.[0]?.targetUri, documentUri);

	const references = await request(7, 'textDocument/references', {
		textDocument: { uri: documentUri },
		position: callPosition,
		context: { includeDeclaration: true },
	});
	assert.equal(references.error, undefined);
	assert.ok(references.result.length >= 2);

	const hierarchy = await request(8, 'textDocument/prepareCallHierarchy', {
		textDocument: { uri: documentUri },
		position: offsetToPosition(documentText, documentText.indexOf('add')),
	});
	assert.equal(hierarchy.error, undefined);
	assert.equal(hierarchy.result?.[0]?.name, 'add');
	const incoming = await request(9, 'callHierarchy/incomingCalls', { item: hierarchy.result[0] });
	assert.equal(incoming.error, undefined);
	assert.deepEqual(incoming.result.map(call => call.from.name), ['inferred']);

	const workspaceSymbol = await request(10, 'workspace/symbol', { query: 'multiply' });
	assert.equal(workspaceSymbol.error, undefined);
	assert.equal(workspaceSymbol.result?.some(symbol => symbol.name === 'multiply'), true);

	const completion = await request(11, 'textDocument/completion', {
		textDocument: { uri: documentUri },
		position: offsetToPosition(documentText, documentText.length),
	});
	assert.equal(completion.error, undefined);
	const completionItems = Array.isArray(completion.result) ? completion.result : completion.result?.items ?? [];
	const autoImport = completionItems.find(item => item.label === 'multiply');
	assert.ok(autoImport);
	assert.match(autoImport.additionalTextEdits?.[0]?.newText ?? '', /import \{ multiply \}/u);

	const lenses = await request(12, 'textDocument/codeLens', { textDocument: { uri: documentUri } });
	assert.equal(lenses.error, undefined);
	assert.equal(lenses.result?.some(lens => lens.command?.title.includes('references')), true);
	assert.equal(lenses.result?.some(lens => lens.command?.title.includes('callers')), true);

	const preparedRename = await request(13, 'textDocument/prepareRename', { textDocument: { uri: documentUri }, position: callPosition });
	assert.equal(preparedRename.error, undefined);
	assert.equal(preparedRename.result?.placeholder, 'add');
	const rename = await request(14, 'textDocument/rename', { textDocument: { uri: documentUri }, position: callPosition, newName: 'sum' });
	assert.equal(rename.error, undefined);
	assert.ok(rename.result?.changes?.[documentUri]?.length >= 2);

	const shutdown = await request(15, 'shutdown', null);
	assert.equal(shutdown.error, undefined);
	send({ jsonrpc: '2.0', method: 'exit', params: null });
	await new Promise((resolveExit, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Language Server did not exit. stderr: ${stderr}`));
		}, 10_000);
		server.once('exit', code => {
			clearTimeout(timer);
			if (code === 0) resolveExit();
			else reject(new Error(`Language Server exited with ${code}. stderr: ${stderr}`));
		});
	});
} catch (error) {
	await stopServerProcess(server);
	throw error;
} finally {
	await removeWorkspace(workspaceRoot);
}

async function removeWorkspace(path) {
	try {
		await rm(path, {
			recursive: true,
			force: true,
			maxRetries: process.platform === 'win32' ? 10 : 3,
			retryDelay: 200,
		});
	} catch (error) {
		const code = error instanceof Error && 'code' in error ? String(error.code) : '';
		if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code)) throw error;
		process.emitWarning(`Unable to remove VS Code smoke workspace after retries: ${path}\n${String(error)}`);
	}
}

async function stopServerProcess(child) {
	if (child.exitCode !== null || child.signalCode !== null) return;
	if (process.platform === 'win32' && child.pid !== undefined) {
		await new Promise(resolveStop => {
			const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
				stdio: 'ignore',
				windowsHide: true,
			});
			killer.once('error', resolveStop);
			killer.once('exit', resolveStop);
		});
		await waitForExit(child, 5_000);
		return;
	}
	child.kill('SIGTERM');
	if (await waitForExit(child, 5_000)) return;
	child.kill('SIGKILL');
	await waitForExit(child, 5_000);
}

function waitForExit(child, timeout) {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
	return new Promise(resolveExit => {
		const finish = exited => {
			clearTimeout(timer);
			child.off('exit', onExit);
			resolveExit(exited);
		};
		const onExit = () => { finish(true); };
		const timer = setTimeout(() => { finish(false); }, timeout);
		child.once('exit', onExit);
		if (child.exitCode !== null || child.signalCode !== null) finish(true);
	});
}

function assertDocumentSymbolRanges(symbol) {
	assert.ok(rangeContains(symbol.range, symbol.selectionRange));
	for (const child of symbol.children ?? []) assertDocumentSymbolRanges(child);
}

function rangeContains(parent, child) {
	return comparePosition(parent.start, child.start) <= 0 && comparePosition(child.end, parent.end) <= 0;
}

function comparePosition(left, right) {
	return left.line === right.line ? left.character - right.character : left.line - right.line;
}

function offsetToPosition(text, targetOffset) {
	const offset = Math.max(0, Math.min(text.length, targetOffset));
	let line = 0;
	let lineStart = 0;
	for (let index = 0; index < offset; index++) {
		if (text.charCodeAt(index) === 10) {
			line++;
			lineStart = index + 1;
		}
	}
	return { line, character: offset - lineStart };
}
