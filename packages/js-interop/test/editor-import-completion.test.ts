import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { CachedTypeScriptInteropProvider } from '../src/cached-provider.js';

class EditorCompletionProvider extends CachedTypeScriptInteropProvider {
	public complete(
		containingFile: string,
		moduleSpecifier: string,
		typeOnly = false,
	): readonly { readonly name: string; readonly kind: string }[] {
		return this.editorImportCompletions({
			containingFile,
			moduleSpecifier,
			typeOnly,
			platform: 'node',
		});
	}
}

async function projectFixture(t: TestContext): Promise<{ root: string; sourcePath: string }> {
	const root = await mkdtemp(join(tmpdir(), 'virune-interop-editor-completion-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'src');
	const packageRoot = join(root, 'node_modules/demo-pkg');
	await mkdir(sourceDirectory, { recursive: true });
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(root, 'package.json'), JSON.stringify({
		dependencies: { 'demo-pkg': '1.0.0' },
	}), 'utf8');
	await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
		name: 'demo-pkg',
		version: '1.0.0',
		type: 'module',
		types: './index.d.ts',
		exports: {
			'.': {
				types: './index.d.ts',
				default: './index.js',
			},
		},
	}), 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), [
		'export declare function makeThing(value: string): string;',
		'export declare const value: number;',
		'export interface Options { readonly enabled: boolean; }',
		'export type Label = string;',
		'export declare class Widget { readonly name: string; }',
		'export default function defaultThing(): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(packageRoot, 'index.js'), [
		'export const value = 1;',
		'export function makeThing(value) { return value; }',
		'export class Widget { constructor() { this.name = "widget"; } }',
		'export default function defaultThing() {}',
		'',
	].join('\n'), 'utf8');
	return { root, sourcePath: join(sourceDirectory, 'main.virune') };
}

test('cached TypeScript interop provider exposes declaration-aware editor import completions', async t => {
	const fixture = await projectFixture(t);
	const provider = new EditorCompletionProvider({ projectRoot: fixture.root });
	t.after(() => provider.dispose());

	const values = provider.complete(fixture.sourcePath, 'demo-pkg');
	const names = values.map(item => item.name);
	assert.equal(names.includes('makeThing'), true);
	assert.equal(names.includes('value'), true);
	assert.equal(names.includes('Widget'), true);
	assert.equal(names.includes('Options'), false);
	assert.equal(names.includes('Label'), false);

	const types = provider.complete(fixture.sourcePath, 'demo-pkg', true);
	const typeNames = types.map(item => item.name);
	assert.equal(typeNames.includes('Options'), true);
	assert.equal(typeNames.includes('Label'), true);
	assert.equal(typeNames.includes('Widget'), true);
	assert.equal(typeNames.includes('makeThing'), false);
	assert.equal(typeNames.includes('value'), false);
});

test('editor import completion fails soft for unresolved modules', async t => {
	const fixture = await projectFixture(t);
	const provider = new EditorCompletionProvider({ projectRoot: fixture.root });
	t.after(() => provider.dispose());

	assert.deepEqual(provider.complete(fixture.sourcePath, 'missing-package'), []);
});
