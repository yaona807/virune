import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function projectRoot(): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	return mkdtemp(join(temporaryRoot, 'virune-interop-contextual-safety-'));
}

async function writeProject(root: string, source: string, librarySource: string, declarations: string): Promise<void> {
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
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
}

test('External property and index writes reject native aggregate and callable leakage', async () => {
	const root = await projectRoot();
	await writeProject(root, `import js { objectState, callableState } from "./library.js"

record Config {
	mode: String
}

fn double(value: Float) -> Float {
	return value * 2.0
}

fn main() -> Unit uses JavaScript {
	objectState.config = Config { mode: "strict" }
	objectState["config"] = Config { mode: "strict" }
	callableState.transform = double
	callableState["transform"] = double
	return Unit
}
`, 'export const objectState = {};\nexport const callableState = {};\n', `
export declare const objectState: {
	config: { mode: string };
	[key: string]: { mode: string };
};
export declare const callableState: {
	transform: (value: number) => number;
	[key: string]: (value: number) => number;
};
`);
	const result = await buildProject(root, {
		write: false,
		jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }),
	});
	const codes = result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
	assert.equal(codes.filter(code => code === 'L2119').length, 2);
	assert.equal(codes.filter(code => code === 'L2120').length, 2);
});

test('External index reads retain Proxy execution and JavaScript-effect evidence', async () => {
	const root = await projectRoot();
	const librarySource = `
const events = [];
export const proxied = new Proxy({ key: 'value' }, {
	get(target, key, receiver) {
		events.push('get:' + String(key));
		return Reflect.get(target, key, receiver);
	},
});
export function resetEvents() { events.length = 0; }
export function readEvents() { return events.join(','); }
`;
	await writeProject(root, `import js { proxied, resetEvents, readEvents } from "./library.js"

@jsExport
pub fn proxyRead() -> String uses JavaScript {
	discard resetEvents()
	discard proxied["key"]
	return readEvents()
}
`, librarySource, `
export declare const proxied: { [key: string]: string };
export declare function resetEvents(): void;
export declare function readEvents(): string;
`);
	const result = await buildProject(root, {
		write: true,
		jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }),
	});
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const mainModule = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(mainModule?.semantic);
	const indexOperation = externalOperationSequence(mainModule.semantic).find(item => item.kind === 'read-index');
	assert.ok(indexOperation !== undefined && indexOperation.kind === 'read-index');
	assert.equal(indexOperation.effect, 'JavaScript');

	await mkdir(join(root, 'dist'), { recursive: true });
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?proxy-index-read`) as { proxyRead(): string };
	assert.equal(module.proxyRead(), 'get:key');
});

test('callable-only values remain calls while protected constructors fail closed', async () => {
	const root = await projectRoot();
	await writeProject(root, `import js { callableOnly, ProtectedCtor } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard callableOnly(1.0)
	discard ProtectedCtor(1.0)
	return Unit
}
`, `
export function callableOnly(value) { return value + 1; }
export class ProtectedCtor { constructor(value) { this.value = value; } }
`, `
export declare function callableOnly(value: number): number;
export declare class ProtectedCtor { protected constructor(value: number); }
`);
	const result = await buildProject(root, {
		write: false,
		jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }),
	});
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.equal(errors.filter(item => item.code === 'L4204').length, 1);
	const mainModule = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(mainModule?.semantic);
	assert.equal(mainModule.semantic.interop.usages.filter(item => item.kind === 'call').length, 1);
	assert.equal(mainModule.semantic.interop.usages.filter(item => item.kind === 'construct').length, 0);
});
