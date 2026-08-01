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
type SemanticModule = {
	readonly path: string;
	readonly allowedEffects: readonly string[];
	readonly symbols: readonly {
		readonly name: string;
		readonly declarationKind: string;
		readonly public: boolean;
		readonly effect: string;
	}[];
	readonly references: readonly {
		readonly name: string;
		readonly targetModulePath: string;
		readonly targetName: string;
		readonly requiredEffect: string;
	}[];
};
type SemanticResult = {
	readonly accepted: boolean;
	readonly checkedModules: number;
	readonly diagnostics: readonly {
		readonly code: string;
		readonly modulePath: string;
		readonly symbolName: string | null;
		readonly targetModulePath: string | null;
		readonly targetName: string | null;
	}[];
};
type SemanticModuleApi = {
	readonly checkProjectSemanticsJson: (request: string) => ViruneResult<string>;
};

test('project semantic context accepts public cross-module references and available effects', async () => {
	const loaded = await loadSemanticModule();
	try {
		const result = check(loaded.module, [
			{
				path: 'src/helper.virune',
				allowedEffects: [],
				symbols: [{ name: 'value', declarationKind: 'TopLevelValueDeclaration', public: true, effect: '' }],
				references: [],
			},
			{
				path: 'src/main.virune',
				allowedEffects: ['io'],
				symbols: [{ name: 'main', declarationKind: 'FunctionDeclaration', public: true, effect: 'io' }],
				references: [{
					name: 'value',
					targetModulePath: 'src/helper.virune',
					targetName: 'value',
					requiredEffect: 'io',
				}],
			},
		]);
		assert.equal(result.accepted, true);
		assert.equal(result.checkedModules, 2);
		assert.deepEqual(result.diagnostics, []);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('project semantic context reports duplicate, visibility, missing target, and effect diagnostics', async () => {
	const loaded = await loadSemanticModule();
	try {
		const result = check(loaded.module, [
			{
				path: 'src/helper.virune',
				allowedEffects: [],
				symbols: [
					{ name: 'privateValue', declarationKind: 'TopLevelValueDeclaration', public: false, effect: '' },
					{ name: 'privateValue', declarationKind: 'TopLevelValueDeclaration', public: false, effect: '' },
				],
				references: [],
			},
			{
				path: 'src/main.virune',
				allowedEffects: [],
				symbols: [{ name: 'main', declarationKind: 'FunctionDeclaration', public: true, effect: '' }],
				references: [
					{
						name: 'privateValue',
						targetModulePath: 'src/helper.virune',
						targetName: 'privateValue',
						requiredEffect: 'io',
					},
					{
						name: 'missing',
						targetModulePath: 'src/missing.virune',
						targetName: 'missing',
						requiredEffect: '',
					},
				],
			},
		]);
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), [
			'SHP3002',
			'SHP3103',
			'SHP3201',
			'SHP3101',
		]);
		assert.equal(result.checkedModules, 2);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function check(module: SemanticModuleApi, modules: readonly SemanticModule[]): SemanticResult {
	const encoded = module.checkProjectSemanticsJson(JSON.stringify({ modules }));
	assert.equal(encoded.$tag, 'Ok');
	return JSON.parse(encoded.$values[0]) as SemanticResult;
}

async function loadSemanticModule(): Promise<{ readonly root: string; readonly module: SemanticModuleApi }> {
	const result = await buildProject(mvpRoot, {
		write: false,
		additionalEntries: ['src/project-semantic.virune'],
	});
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-project-semantic-'));
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
	const moduleUrl = `${pathToFileURL(join(root, 'project-semantic.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as SemanticModuleApi };
}
