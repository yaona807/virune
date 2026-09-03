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
	private 0: string;
	protected 1.5: string;
	name: string;
	2.5: string;
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

test('private and protected External exact-literal index reads fail closed while public indexed reads retain their resolved type', async () => {
	const publicErrors = await errorsFor(`import js { box } from "./library.js"

fn readPublicStringKey() -> String uses JavaScript {
	return box["name"]
}

fn readPublicNumericKey() -> String uses JavaScript {
	return box[2.5]
}

fn main() -> Unit uses JavaScript {
	return Unit
}
`);
	assert.equal(publicErrors.length, 0);

	const inaccessibleErrors = await errorsFor(`import js { box } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard box["secret"]
	discard box["hidden"]
	discard box[0]
	discard box[-0]
	discard box[1.5]
	return Unit
}
`);
	assert.equal(inaccessibleErrors.filter(item => item.code === 'L2121').length, 5);
	assert.equal(inaccessibleErrors.length, 5);
});
