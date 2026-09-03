import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function buildRuntimeProject(source: string, declarations: string, librarySource: string): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-usage-matrix-'));
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: false,
		sourcesContent: false,
	}), 'utf8');
	await writeFile(join(root, 'src/main.virune'), source, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: true, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	return root;
}

test('static module evaluation failure remains distinct from a later Direct call throw', async () => {
	const source = `import js { explode } from "./library.js"\n\n@jsExport\npub fn callExplode() -> String uses JavaScript {\n\treturn explode()\n}\n`;
	const declarations = 'export declare function explode(): string;\n';

	const moduleFailureRoot = await buildRuntimeProject(
		source,
		declarations,
		'throw new Error("module-evaluation-failure");\nexport function explode() { throw new Error("call-failure"); }\n',
	);
	await assert.rejects(
		import(`${pathToFileURL(join(moduleFailureRoot, 'dist/main.js')).href}?case=module-failure`),
		/module-evaluation-failure/u,
	);

	const callFailureRoot = await buildRuntimeProject(
		source,
		declarations,
		'export function explode() { throw new Error("call-failure"); }\n',
	);
	const module = await import(`${pathToFileURL(join(callFailureRoot, 'dist/main.js')).href}?case=call-failure`) as {
		callExplode(): string;
	};
	assert.throws(() => module.callExplode(), /call-failure/u);
});

test('deferred External callback starts at a fresh root and awaits structured parallel child work', async () => {
	const root = await buildRuntimeProject(
		`import js { remember, invokeAsync } from "./library.js"\n\nasync fn child(value: String) -> String {\n\treturn value\n}\n\nasync fn callback(value: String) -> String {\n\tlet values = await parallel {\n\t\tleft: child("{value}:left"),\n\t\tright: child("{value}:right"),\n\t}\n\treturn "{values.left}|{values.right}"\n}\n\n@jsExport\npub fn rememberCallback() -> Unit uses JavaScript {\n\tdiscard remember(callback)\n\treturn Unit\n}\n\n@jsExport\npub async fn invokeSaved(value: String) -> String uses JavaScript {\n\treturn await invokeAsync(value)\n}\n`,
		'export declare function remember(callback: (value: string) => Promise<string>): void;\nexport declare function invokeAsync(value: string): Promise<string>;\n',
		'let saved;\nexport function remember(callback) { saved = callback; }\nexport async function invokeAsync(value) { return await saved(value); }\n',
	);
	const output = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(output, /\$fn\(validateFfiValue\([\s\S]*?rootTaskContext\(\)\)/u);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=structured-deferred-root`) as {
		rememberCallback(): void;
		invokeSaved(value: string): Promise<string>;
	};
	module.rememberCallback();
	assert.equal(await module.invokeSaved('job'), 'job:left|job:right');
});
