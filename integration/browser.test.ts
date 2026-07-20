import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProject } from '@virune/compiler/experimental';

const repositoryRoot = resolve(import.meta.dirname, '../..');

test('browser target executes emitted ESM in Chromium', { timeout: 45_000 }, async t => {
	const browser = await findBrowser();
	if (browser === undefined) {
		if (process.env.CI === 'true' && process.platform === 'linux') assert.fail('Chromium or Chrome is required for browser conformance on Linux CI');
		t.skip('Chromium or Chrome is not installed');
		return;
	}

	const root = await mkdtemp(join(tmpdir(), 'virune-browser-'));
	try {
		await mkdir(join(root, 'src'), { recursive: true });
		await writeFile(join(root, 'virune.json'), JSON.stringify({
			languageVersion: '1.0', platform: 'browser', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022', sourceMap: true, sourcesContent: true,
		}, null, 2));
		await writeFile(join(root, 'src/main.virune'), `@jsExport
pub fn verify() -> Result<String, JsError> uses Dom {
	let updated = Dom.setText("#status", "Virune browser")?
	return Ok(Bytes.toHex(Bytes.fromUtf8("ok")))
}
`);
		const result = await buildProject(root, true);
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);

		const imports = await browserImportMap(root);
		const html = `<!doctype html><html><head><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports })}</script></head><body><div id="status">pending</div></body></html>`;
		const browserResult = await executeInBrowser(
			browser,
			html,
			'virune_app_main',
			join(root, 'chromium-profile'),
		);
		assert.deepEqual(browserResult, { result: '6f6b', status: 'Virune browser', timeout: 'Err:true', parallel: true });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('extracts the DevTools port from Chromium stderr when the active port file is unavailable', () => {
	const stderr = 'DevTools listening on ws://127.0.0.1:45067/devtools/browser/example-id\n';
	assert.equal(devToolsPortFromStderr(stderr), 45067);
});

async function browserImportMap(projectRoot: string): Promise<Record<string, string>> {
	const imports: Record<string, string> = {};
	const runtimeDirectory = join(repositoryRoot, 'packages/runtime/dist/src');
	for (const file of (await readdir(runtimeDirectory)).filter(file => file.endsWith('.js'))) {
		const source = await readFile(join(runtimeDirectory, file), 'utf8');
		const rewritten = source.replace(/(["'])\.\/([^"']+)\1/gu, (_match, quote: string, target: string) => `${quote}virune_runtime/${target}${quote}`);
		imports[`virune_runtime/${file}`] = dataUrl('text/javascript', rewritten);
	}
	imports['@virune/runtime'] = imports['virune_runtime/index.js']!;
	imports['@virune/runtime/v2/index.js'] = imports['virune_runtime/index.js']!;
	imports['@virune/stdlib/browser/dom'] = dataUrl('text/javascript', await readFile(join(repositoryRoot, 'packages/stdlib/dist/src/browser-dom.js'), 'utf8'));
	imports['@virune/stdlib/browser/storage'] = dataUrl('text/javascript', await readFile(join(repositoryRoot, 'packages/stdlib/dist/src/browser-storage.js'), 'utf8'));
	imports.virune_app_main = dataUrl('text/javascript', await readFile(join(projectRoot, 'dist/main.js'), 'utf8'));
	return imports;
}

function dataUrl(type: string, value: string): string { return `data:${type};base64,${Buffer.from(value).toString('base64')}`; }

async function findBrowser(): Promise<string | undefined> {
	const explicit = process.env.VIRUNE_BROWSER_EXECUTABLE;
	const candidates = [
		explicit,
		'/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
		process.env.PROGRAMFILES === undefined ? undefined : join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
		process.env['PROGRAMFILES(X86)'] === undefined ? undefined : join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
	].filter((value): value is string => value !== undefined && value.length > 0);
	for (const candidate of candidates) {
		try { await access(candidate); return candidate; } catch {}
	}
	for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
		const resolved = await run(process.platform === 'win32' ? 'where' : 'which', [name]).catch(() => undefined);
		const path = resolved?.stdout.trim().split(/\r?\n/u)[0];
		if (resolved?.code === 0 && path) return path;
	}
	return undefined;
}

async function executeInBrowser(executable: string, html: string, moduleUrl: string, profile: string): Promise<{ readonly result: string; readonly status: string; readonly timeout: string; readonly parallel: boolean }> {
	const child = spawn(executable, [
		'--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-proxy-server', '--allow-file-access-from-files',
		'--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
	], { stdio: ['ignore', 'ignore', 'pipe'] });
	let stderr = '';
	child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
	try {
		const port = await waitForDevToolsPort(profile, child, () => stderr);
		const target = await waitForTarget(port, child, () => stderr);
		const client = await CdpClient.connect(target.webSocketDebuggerUrl);
		try {
			await client.call('Page.enable');
			await client.call('Runtime.enable');
			const frameTree = await client.call('Page.getFrameTree') as { frameTree: { frame: { id: string } } };
			await client.call('Page.setDocumentContent', { frameId: frameTree.frameTree.frame.id, html });
			const evaluation = await client.call('Runtime.evaluate', {
				expression: `(async () => {
					const module = await import(${JSON.stringify(moduleUrl)});
					const runtime = await import('@virune/runtime/v2/index.js');
					const result = module.verify();
					let timeoutSettled = false;
					const timeoutResult = await runtime.taskTimeout(runtime.rootTaskContext(), runtime.durationMilliseconds(1), async context => {
						try { await runtime.sleep(context, runtime.durationMilliseconds(100)); }
						finally { timeoutSettled = true; }
					});
					let siblingSettled = false;
					try {
						await runtime.mapParallel(runtime.rootTaskContext(), [0, 1], 2, async (value, _index, context) => {
							if (value === 0) { await runtime.sleep(context, runtime.durationMilliseconds(1)); throw new Error('failed'); }
							try { await runtime.sleep(context, runtime.durationMilliseconds(100)); }
							finally { siblingSettled = true; }
						});
					} catch {}
					return {
						result: result.$tag === 'Ok' ? result.$values[0] : 'error',
						status: document.querySelector('#status')?.textContent ?? '',
						timeout: timeoutResult.$tag + ':' + String(timeoutSettled),
						parallel: siblingSettled,
					};
				})()`,
				awaitPromise: true,
				returnByValue: true,
			});
			const typed = evaluation as { result?: { value?: { result?: string; status?: string; timeout?: string; parallel?: boolean }; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
			if (typed.exceptionDetails !== undefined) throw new Error(typed.exceptionDetails.exception?.description ?? typed.exceptionDetails.text ?? 'Browser evaluation failed');
			const value = typed.result?.value;
			if (value === undefined) throw new Error(`Browser returned no result: ${typed.result?.description ?? 'unknown'}\n${stderr}`);
			return { result: value.result ?? '', status: value.status ?? '', timeout: value.timeout ?? '', parallel: value.parallel ?? false };
		} finally { client.close(); }
	} finally {
		child.kill('SIGTERM');
		await Promise.race([new Promise<void>(resolvePromise => child.once('exit', () => resolvePromise())), delay(2_000)]);
		if (child.exitCode === null) child.kill('SIGKILL');
	}
}

async function waitForDevToolsPort(
	profile: string,
	child: ReturnType<typeof spawn>,
	readStderr: () => string,
): Promise<number> {
	const activePortFile = join(profile, 'DevToolsActivePort');
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const stderr = readStderr();
		throwIfBrowserExited(child, stderr);
		try {
			const [portText] = (await readFile(activePortFile, 'utf8')).split(/\r?\n/u);
			const port = Number(portText);
			if (Number.isInteger(port) && port > 0) return port;
		} catch {}

		const stderrPort = devToolsPortFromStderr(stderr);
		if (stderrPort !== undefined) return stderrPort;

		await delay(100);
	}
	throw new Error(`Chromium did not expose a DevTools endpoint within 30 seconds\n${readStderr()}`);
}

function devToolsPortFromStderr(stderr: string): number | undefined {
	const match = /DevTools listening on (ws:\/\/\S+)/u.exec(stderr);
	if (match?.[1] === undefined) return undefined;
	try {
		const port = Number(new URL(match[1]).port);
		return Number.isInteger(port) && port > 0 ? port : undefined;
	} catch {
		return undefined;
	}
}

async function waitForTarget(
	port: number,
	child: ReturnType<typeof spawn>,
	readStderr: () => string,
): Promise<{ readonly webSocketDebuggerUrl: string }> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		throwIfBrowserExited(child, readStderr());
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			if (response.ok) {
				const targets = await response.json() as readonly { readonly type: string; readonly webSocketDebuggerUrl: string }[];
				const page = targets.find(target => target.type === 'page');
				if (page !== undefined) return page;
			}
		} catch {}
		await delay(100);
	}
	throw new Error(`Chromium DevTools page target did not become ready within 15 seconds\n${readStderr()}`);
}

function throwIfBrowserExited(child: ReturnType<typeof spawn>, stderr: string): void {
	if (child.exitCode === null && child.signalCode === null) return;
	throw new Error(`Chromium exited before DevTools became ready (exit=${String(child.exitCode)}, signal=${String(child.signalCode)})\n${stderr}`);
}

class CdpClient {
	readonly #socket: WebSocket;
	readonly #pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	#nextId = 1;
	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.addEventListener('message', event => {
			const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
			if (message.id === undefined) return;
			const pending = this.#pending.get(message.id); if (pending === undefined) return;
			this.#pending.delete(message.id);
			if (message.error !== undefined) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
		});
	}
	public static connect(url: string): Promise<CdpClient> {
		return new Promise((resolvePromise, reject) => {
			const socket = new WebSocket(url);
			socket.addEventListener('open', () => resolvePromise(new CdpClient(socket)), { once: true });
			socket.addEventListener('error', () => reject(new Error('Failed to connect to Chromium DevTools')), { once: true });
		});
	}
	public call(method: string, params: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
		const id = this.#nextId++;
		return new Promise((resolvePromise, reject) => {
			this.#pending.set(id, { resolve: resolvePromise, reject });
			this.#socket.send(JSON.stringify({ id, method, params }));
		});
	}
	public close(): void { this.#socket.close(); }
}

const delay = (milliseconds: number): Promise<void> => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

function run(command: string, args: readonly string[]): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = ''; let stderr = '';
		child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
		child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
		child.once('error', reject); child.once('exit', code => resolvePromise({ code: code ?? 1, stdout, stderr }));
	});
}
