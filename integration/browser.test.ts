import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium, firefox, webkit, type BrowserType } from 'playwright';
import { buildProject } from '@virune/compiler/experimental';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const engine = browserEngine(process.env.VIRUNE_BROWSER_ENGINE ?? 'chromium');
const artifactDirectory = process.env.VIRUNE_BROWSER_ARTIFACT_DIR === undefined
	? undefined
	: resolve(process.env.VIRUNE_BROWSER_ARTIFACT_DIR);

test(`browser target executes emitted ESM in ${engine.name()}`, { timeout: 120_000 }, async () => {
	const root = await mkdtemp(join(tmpdir(), `virune-${engine.name()}-`));
	const browserLogs: string[] = [];
	let server: Server | undefined;
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
		const started = await serveHtml(html);
		server = started.server;
		const launchOptions = await browserLaunchOptions(engine.name());
		const browser = await engine.launch(launchOptions);
		const context = await browser.newContext();
		if (artifactDirectory !== undefined) {
			await mkdir(artifactDirectory, { recursive: true });
			await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
		}
		const page = await context.newPage();
		page.on('console', message => browserLogs.push(`[console:${message.type()}] ${message.text()}`));
		page.on('pageerror', error => browserLogs.push(`[pageerror] ${error.stack ?? error.message}`));
		try {
			await page.goto(started.url, { waitUntil: 'load' });
			const browserResult = await page.evaluate(async () => {
				const applicationSpecifier = 'virune_app_main';
				const module = await import(applicationSpecifier);
				const runtime = await import('@virune/runtime/v2/index.js');
				const storage = await import('@virune/stdlib/browser/storage');
				const result = module.verify();
				storage.clear();
				storage.set('virune', 'browser');
				const stored = storage.get('virune');
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
					stored: stored.$tag === 'Some' ? stored.$values[0] : 'missing',
					timeout: timeoutResult.$tag + ':' + String(timeoutSettled),
					parallel: siblingSettled,
				};
			});
			assert.deepEqual(browserResult, { result: '6f6b', status: 'Virune browser', stored: 'browser', timeout: 'Err:true', parallel: true });
			await persistBrowserReport(engine.name(), { browserResult, logs: browserLogs, version: browser.version() });
		} finally {
			if (artifactDirectory !== undefined) await context.tracing.stop({ path: join(artifactDirectory, `${engine.name()}-trace.zip`) });
			await context.close();
			await browser.close();
		}
	} catch (error) {
		await persistBrowserReport(engine.name(), { error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error), logs: browserLogs });
		throw error;
	} finally {
		await new Promise<void>(resolveClose => server?.close(() => resolveClose()) ?? resolveClose());
		await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
	}
});

function browserEngine(name: string): BrowserType {
	if (name === 'chromium') return chromium;
	if (name === 'firefox') return firefox;
	if (name === 'webkit') return webkit;
	throw new Error(`Unsupported browser engine: ${name}`);
}

async function browserLaunchOptions(name: string): Promise<{ executablePath?: string; args?: string[] }> {
	if (name !== 'chromium' || process.env.VIRUNE_PLAYWRIGHT_MANAGED === 'true') return {};
	const candidates = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
	for (const candidate of candidates) {
		try { await access(candidate); return { executablePath: candidate, args: ['--no-sandbox', '--disable-dev-shm-usage'] }; }
		catch {}
	}
	throw new Error('A system Chromium executable is required unless VIRUNE_PLAYWRIGHT_MANAGED=true.');
}

async function serveHtml(html: string): Promise<{ server: Server; url: string }> {
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		response.end(html);
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolveListen());
	});
	const address = server.address();
	if (address === null || typeof address === 'string') throw new Error('Browser test server did not expose a TCP port.');
	return { server, url: `http://127.0.0.1:${address.port}/` };
}

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

async function persistBrowserReport(name: string, report: unknown): Promise<void> {
	if (artifactDirectory === undefined) return;
	await mkdir(artifactDirectory, { recursive: true });
	await writeFile(join(artifactDirectory, `${name}-report.json`), `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
}

function dataUrl(type: string, value: string): string { return `data:${type};base64,${Buffer.from(value).toString('base64')}`; }
