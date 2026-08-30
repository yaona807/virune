import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildProject, externalOperationSequence } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function buildEquivalentPackage(packageName: string) {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-package-rename-'));
	await mkdir(join(root, 'src'), { recursive: true });
	const packageRoot = join(root, 'node_modules', packageName);
	await mkdir(packageRoot, { recursive: true });
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
	await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
		name: packageName,
		version: '1.0.0',
		type: 'module',
		exports: { '.': { types: './index.d.ts', import: './index.js' } },
	}), 'utf8');
	await writeFile(join(packageRoot, 'index.js'), `
export const values = { key: 'value' };
export const state = { name: 'old' };
export class Box { constructor(value) { this.value = value; } }
`, 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), `
export declare const values: { [key: string]: string };
export declare const state: { name: string };
export declare class Box<T> { constructor(value: T); readonly value: T; }
`, 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import js { values, state, Box } from "${packageName}"

pub fn main() -> Unit uses JavaScript {
	discard values["key"]
	state.name = "changed"
	discard Box("value")
	return Unit
}
`, 'utf8');
	const result = await buildProject(root, {
		write: false,
		jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }),
	});
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const mainModule = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(mainModule?.semantic);
	assert.ok(mainModule.output);
	const normalizePackageText = (value: string): string => value.replaceAll(packageName, '<fixture-package>');
	const operations = JSON.stringify(externalOperationSequence(mainModule.semantic), (key, value: unknown) => {
		if (key === 'packageJsonHash') return '<fixture-package-json-hash>';
		return typeof value === 'string' ? normalizePackageText(value) : value;
	});
	return {
		code: normalizePackageText(mainModule.output.code),
		operations,
		usageKinds: mainModule.semantic.interop.usageIR.map(item => item.kind),
	};
}

test('equivalent External package fixtures remain behaviorally and semantically independent of package name', async () => {
	const original = await buildEquivalentPackage('virune-fixture-alpha');
	const renamed = await buildEquivalentPackage('virune-fixture-bravo');
	assert.deepEqual(renamed, original);
});
