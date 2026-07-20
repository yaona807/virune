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
	assert.equal(capabilities?.documentFormattingProvider, true);
	assert.equal(capabilities?.semanticTokensProvider?.full, true);
	assert.equal(capabilities?.codeActionProvider, true);
	send({ jsonrpc: '2.0', method: 'initialized', params: {} });
	const shutdown = await request(2, 'shutdown', null);
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
