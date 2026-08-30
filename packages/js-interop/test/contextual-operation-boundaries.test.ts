import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function projectRoot(): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	return mkdtemp(join(temporaryRoot, 'virune-interop-contextual-boundary-'));
}

async function errorCodesFor(source: string, declarations: string): Promise<string[]> {
	const root = await projectRoot();
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
	await writeFile(join(root, 'src/library.js'), 'export const box = {};\nexport function consume(value) { return value; }\n', 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: false, jsInteropProvider: provider });
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

test('private and protected External properties cannot be proven writable through member or literal-index usage', async () => {
	const codes = await errorCodesFor(`import js { box } from "./library.js"

fn main() -> Unit uses JavaScript {
	box.secret = "changed"
	box.hidden = "changed"
	box["secret"] = "changed"
	box["hidden"] = "changed"
	return Unit
}
`, `
export declare class Box {
	private secret: string;
	protected hidden: string;
	name: string;
}
export declare const box: Box;
`);
	assert.equal(codes.filter(code => code === 'L2119').length, 2);
	assert.equal(codes.filter(code => code === 'L2120').length, 2);
});

test('contextual External generic object succeeds only when TypeScript supplies concrete contextual evidence', async () => {
	const resolved = await errorCodesFor(`import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume({ mode: "strict" })
	return Unit
}
`, `export declare function consume<T extends { mode: 'strict' }>(value: T): boolean;\n`);
	assert.deepEqual(resolved, []);

	const unresolved = await errorCodesFor(`import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume({ mode: "strict" })
	return Unit
}
`, `export declare function consume<T>(value: { mode: NoInfer<T> }): boolean;\n`);
	assert.ok(unresolved.includes('L4204'));
});

test('readonly contextual External properties preserve TypeScript initialization semantics', async () => {
	const accepted = await errorCodesFor(`import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume({ mode: "strict" })
	return Unit
}
`, `export declare function consume(value: { readonly mode: 'strict' }): boolean;\n`);
	assert.deepEqual(accepted, []);

	const invalid = await errorCodesFor(`import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume({ mode: "loose" })
	return Unit
}
`, `export declare function consume(value: { readonly mode: 'strict' }): boolean;\n`);
	assert.ok(invalid.includes('L4204'));
});

test('generic External construct fails closed when its inferred result retains an unresolved type argument', async () => {
	const codes = await errorCodesFor(`import js { Box } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard Box()
	return Unit
}
`, `export declare class Box<T> { constructor(); readonly value: T }\n`);
	assert.ok(codes.includes('L4204'));
});

test('ordinary generic External calls preserve TypeScript-valid result compatibility', async () => {
	const ordinary = await errorCodesFor(`import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume()
	return Unit
}
`, `export declare function consume<T>(): number;\n`);
	assert.deepEqual(ordinary, []);

	const concrete = await errorCodesFor(`import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume("ok")
	return Unit
}
`, `export declare function consume<T>(value: T): { readonly value: T; readonly metadata: unknown };\n`);
	assert.deepEqual(concrete, []);
});
