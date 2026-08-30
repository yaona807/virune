import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

test('External index reads reject unsupported key types through TypeScript usage resolution', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-index-boundary-'));
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
	await writeFile(join(root, 'src/main.virune'), `import js { values } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard values[true]
	return Unit
}
`, 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export const values = { key: "value" };\n', 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), 'export declare const values: { [key: string]: string };\n', 'utf8');

	const result = await buildProject(root, {
		write: false,
		jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }),
	});
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.ok(errors.some(item => item.code === 'L2121'));
	const mainModule = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(mainModule?.semantic);
	assert.equal(mainModule.semantic.interop.usages.some(item => item.kind === 'index'), false);
});
