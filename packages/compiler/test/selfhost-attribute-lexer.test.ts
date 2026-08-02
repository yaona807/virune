import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

interface LexTransport {
	readonly tokens: readonly {
		readonly kind: string;
		readonly text: string;
	}[];
	readonly diagnostics: readonly {
		readonly code: string;
		readonly message: string;
	}[];
}

interface LexerModule {
	readonly lexMvpJson: (source: string) => {
		readonly $tag: 'Ok' | 'Err';
		readonly $values: readonly unknown[];
	};
}

test('Pure Core lexer tokenizes attribute markers without a character diagnostic', async () => {
	const loaded = await loadLexerModule();
	try {
		const result = loaded.module.lexMvpJson('@mustUse\npub fn value() -> Int {\n\treturn 1\n}\n');
		assert.equal(result.$tag, 'Ok');
		const encoded = result.$values[0];
		assert.equal(typeof encoded, 'string');
		const lexed = JSON.parse(encoded as string) as LexTransport;
		assert.deepEqual(lexed.diagnostics, []);
		assert.deepEqual(
			lexed.tokens.slice(0, 3).map(token => [token.kind, token.text]),
			[
				['Symbol', '@'],
				['Identifier', 'mustUse'],
				['NewLine', '\n'],
			],
		);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadLexerModule(): Promise<{ readonly root: string; readonly module: LexerModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-attribute-lexer-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) {
		await execFileAsync(process.execPath, ['--check', outputPath]);
	}
	const moduleUrl = `${pathToFileURL(join(root, 'lexer.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as LexerModule };
}
