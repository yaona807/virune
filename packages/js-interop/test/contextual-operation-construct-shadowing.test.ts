import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

test('External construction does not depend on a shadowable Reflect binding', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-construct-shadowing-'));
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
	await writeFile(join(root, 'src/main.virune'), `import js { Reflect, Box } from "./library.js"

@jsExport
pub fn constructValue() -> String uses JavaScript {
	discard Reflect
	return Box("ok").value
}
`, 'utf8');
	const librarySource = `
export const Reflect = {
	construct() { throw new Error('shadowed Reflect.construct'); },
};
export class Box {
	constructor(value) { this.value = value; }
}
`;
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), `
export declare const Reflect: { construct(): never };
export declare class Box { constructor(value: string); readonly value: string; }
`, 'utf8');

	const result = await buildProject(root, {
		write: true,
		jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }),
	});
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	await mkdir(join(root, 'dist'), { recursive: true });
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?construct-shadowing`) as { constructValue(): string };
	assert.equal(module.constructValue(), 'ok');
});
