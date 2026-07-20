import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

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
		rootUri: null,
		capabilities: {},
		workspaceFolders: null,
	});
	assert.equal(initialized.error, undefined);
	const capabilities = initialized.result?.capabilities;
	assert.equal(capabilities?.hoverProvider, true);
	assert.equal(capabilities?.definitionProvider, true);
	assert.equal(capabilities?.documentSymbolProvider, true);
	assert.equal(capabilities?.inlayHintProvider, true);
	assert.deepEqual(capabilities?.signatureHelpProvider?.triggerCharacters, ['(', ',']);
	assert.equal(capabilities?.documentFormattingProvider, true);
	assert.equal(capabilities?.semanticTokensProvider?.full, true);
	assert.equal(capabilities?.codeActionProvider, true);
	send({ jsonrpc: '2.0', method: 'initialized', params: {} });
	const documentUri = 'file:///tmp/virune-vscode-smoke.virune';
	const documentText = 'fn add(left: Int, right: Int) -> Int => left + right\n\nfn inferred() {\n\tlet total = add(1, 2)\n\treturn total\n}\n';
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
	for (const symbol of documentSymbols.result) assertDocumentSymbolRanges(symbol);

	const inlayHintResponse = await request(3, 'textDocument/inlayHint', {
		textDocument: { uri: documentUri },
		range: { start: { line: 0, character: 0 }, end: offsetToPosition(documentText, documentText.length) },
	});
	assert.equal(inlayHintResponse.error, undefined);
	assert.ok(Array.isArray(inlayHintResponse.result));
	const inlayLabels = inlayHintResponse.result.map(hint => typeof hint.label === 'string' ? hint.label : JSON.stringify(hint.label));
	assert.ok(inlayLabels.includes(': Int'));
	assert.ok(inlayLabels.includes(' -> Int'));
	assert.ok(inlayLabels.includes('left:'));
	assert.ok(inlayLabels.includes('right:'));

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

	const shutdown = await request(6, 'shutdown', null);
	assert.equal(shutdown.error, undefined);
	send({ jsonrpc: '2.0', method: 'exit', params: null });
	await new Promise((resolveExit, reject) => {
		const timer = setTimeout(() => {
			server.kill();
			reject(new Error(`Language Server did not exit. stderr: ${stderr}`));
		}, 10_000);
		server.once('exit', code => {
			clearTimeout(timer);
			if (code === 0) resolveExit();
			else reject(new Error(`Language Server exited with ${code}. stderr: ${stderr}`));
		});
	});
} catch (error) {
	server.kill();
	throw error;
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
