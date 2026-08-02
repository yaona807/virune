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

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };

type ImportBinding = {
	readonly modulePath: string;
	readonly targetModulePath: string;
	readonly specifier: string;
	readonly importedName: string;
	readonly localName: string;
	readonly typeOnly: boolean;
	readonly public: boolean;
};

type ExportedSymbol = {
	readonly modulePath: string;
	readonly name: string;
	readonly declarationKind: string;
};

type ImportBindingDiagnostic = {
	readonly code: string;
	readonly severity: 'error';
	readonly message: string;
	readonly modulePath: string;
	readonly targetModulePath: string;
	readonly specifier: string;
	readonly importedName: string;
	readonly localName: string;
};

type ImportBindingResult = {
	readonly accepted: boolean;
	readonly bindings: readonly ImportBinding[];
	readonly diagnostics: readonly ImportBindingDiagnostic[];
};

type ImportBindingModule = {
	readonly validateProjectImportBindingsJson: (request: string) => ViruneResult<string>;
};

const exportsFixture: readonly ExportedSymbol[] = [
	{ modulePath: 'src/types.virune', name: 'User', declarationKind: 'RecordDeclaration' },
	{ modulePath: 'src/value.virune', name: 'value', declarationKind: 'FunctionDeclaration' },
];

test('project import bindings are canonical regardless of request order', async () => {
	const loaded = await loadImportBindingModule();
	try {
		const bindings: readonly ImportBinding[] = [
			{
				modulePath: 'src/main.virune',
				targetModulePath: 'src/types.virune',
				specifier: './types.virune',
				importedName: 'User',
				localName: 'userType',
				typeOnly: true,
				public: false,
			},
			{
				modulePath: 'src/main.virune',
				targetModulePath: 'src/value.virune',
				specifier: './value.virune',
				importedName: 'value',
				localName: 'helper',
				typeOnly: false,
				public: true,
			},
		];
		const first = validate(loaded.module, bindings, exportsFixture);
		const second = validate(loaded.module, [...bindings].reverse(), [...exportsFixture].reverse());
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.bindings.map(item => item.localName), ['helper', 'userType']);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('project import bindings reject missing exports, duplicate locals, and invalid type-only imports', async () => {
	const loaded = await loadImportBindingModule();
	try {
		const bindings: readonly ImportBinding[] = [
			{
				modulePath: 'src/main.virune',
				targetModulePath: 'src/value.virune',
				specifier: './value.virune',
				importedName: 'value',
				localName: 'typedValue',
				typeOnly: true,
				public: false,
			},
			{
				modulePath: 'src/main.virune',
				targetModulePath: 'src/z.virune',
				specifier: './z.virune',
				importedName: 'value',
				localName: 'shared',
				typeOnly: false,
				public: false,
			},
			{
				modulePath: 'src/main.virune',
				targetModulePath: 'src/a.virune',
				specifier: './a.virune',
				importedName: 'User',
				localName: 'shared',
				typeOnly: true,
				public: false,
			},
			{
				modulePath: 'src/main.virune',
				targetModulePath: 'src/types.virune',
				specifier: './types.virune',
				importedName: 'Missing',
				localName: 'missing',
				typeOnly: true,
				public: false,
			},
		];
		const exportedSymbols: readonly ExportedSymbol[] = [
			...exportsFixture,
			{ modulePath: 'src/a.virune', name: 'User', declarationKind: 'RecordDeclaration' },
			{ modulePath: 'src/z.virune', name: 'value', declarationKind: 'FunctionDeclaration' },
		];
		const first = validate(loaded.module, bindings, exportedSymbols);
		const second = validate(loaded.module, [...bindings].reverse(), [...exportedSymbols].reverse());
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.deepEqual(first.diagnostics.map(item => [item.code, item.localName]), [
			['SHP2202', 'missing'],
			['SHP2201', 'shared'],
			['SHP2203', 'typedValue'],
		]);
		assert.ok(first.diagnostics.every(item => item.severity === 'error'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('project import binding JSON boundary fails closed on malformed input', async () => {
	const loaded = await loadImportBindingModule();
	try {
		assert.equal(loaded.module.validateProjectImportBindingsJson('{').$tag, 'Err');
		assert.equal(loaded.module.validateProjectImportBindingsJson('{}').$tag, 'Err');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function validate(
	module: ImportBindingModule,
	bindings: readonly ImportBinding[],
	exportedSymbols: readonly ExportedSymbol[],
): ImportBindingResult {
	const encoded = module.validateProjectImportBindingsJson(JSON.stringify({ bindings, exportedSymbols }));
	assert.equal(encoded.$tag, 'Ok');
	return JSON.parse(encoded.$values[0]) as ImportBindingResult;
}

async function loadImportBindingModule(): Promise<{ readonly root: string; readonly module: ImportBindingModule }> {
	const result = await buildProject(mvpRoot, {
		write: false,
		additionalEntries: ['src/project-import-binding.virune'],
	});
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-project-import-binding-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) await execFileAsync(process.execPath, ['--check', outputPath]);
	const moduleUrl = `${pathToFileURL(join(root, 'project-import-binding.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as ImportBindingModule };
}
