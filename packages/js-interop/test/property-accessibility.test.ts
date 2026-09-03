import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function errorsFor(source: string) {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-property-accessibility-'));
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
	await writeFile(join(root, 'src/library.js'), 'export const box = { name: "public" };\n', 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), `
export declare class Box {
	private secret: string;
	protected hidden: string;
	name: string;
}
export declare const box: Box;
`, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: false, jsInteropProvider: provider });
	return result.diagnostics.filter(item => item.severity === 'error');
}

test('private and protected External property reads fail closed while public reads retain their resolved type', async () => {
	const errors = await errorsFor(`import js { box } from "./library.js"

fn readPublicName() -> String uses JavaScript {
	return box.name
}

fn main() -> Unit uses JavaScript {
	discard box.secret
	discard box.hidden
	return Unit
}
`);
	assert.equal(errors.filter(item => item.code === 'L4202' && item.message.includes('secret')).length, 1);
	assert.equal(errors.filter(item => item.code === 'L4202' && item.message.includes('hidden')).length, 1);
	assert.equal(errors.length, 2);
});
