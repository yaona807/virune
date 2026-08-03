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
type EntryPointRequest = {
	readonly version: string;
	readonly analyzed: boolean;
	readonly entryPath: string;
	readonly candidateModulePath: string;
	readonly hasMain: boolean;
	readonly declarationKind: string;
	readonly isPublic: boolean;
	readonly typeParameterCount: number;
	readonly parameterCount: number;
	readonly firstParameterType: string;
	readonly returnKind: string;
};
type EntryPointDiagnostic = {
	readonly code: string;
	readonly severity: 'error';
	readonly message: string;
	readonly sourcePath: string;
};
type EntryPointResult = {
	readonly accepted: boolean;
	readonly version: string;
	readonly entryPath: string;
	readonly diagnostics: readonly EntryPointDiagnostic[];
};
type EntryPointModule = {
	readonly validateProjectEntryPointJson: (request: string) => ViruneResult<string>;
};

const validRequest: EntryPointRequest = {
	version: '1',
	analyzed: true,
	entryPath: 'src/main.virune',
	candidateModulePath: 'src/main.virune',
	hasMain: true,
	declarationKind: 'FunctionDeclaration',
	isPublic: true,
	typeParameterCount: 0,
	parameterCount: 0,
	firstParameterType: '',
	returnKind: 'unit',
};

test('project entry-point contract accepts canonical executable signatures', async () => {
	const loaded = await loadEntryPointModule();
	try {
		for (const request of [
			validRequest,
			{
				...validRequest,
				parameterCount: 1,
				firstParameterType: 'List<String>',
				returnKind: 'result-unit',
			},
		]) {
			const result = validate(loaded.module, request);
			assert.equal(result.accepted, true);
			assert.equal(result.version, '1');
			assert.equal(result.entryPath, 'src/main.virune');
			assert.deepEqual(result.diagnostics, []);
		}
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('project entry-point contract preserves Legacy L5010-L5016 diagnostics', async () => {
	const loaded = await loadEntryPointModule();
	try {
		assert.deepEqual(
			validate(loaded.module, { ...validRequest, analyzed: false }).diagnostics.map(item => item.code),
			['L5010'],
		);
		assert.deepEqual(
			validate(loaded.module, { ...validRequest, hasMain: false }).diagnostics.map(item => item.code),
			['L5011'],
		);
		assert.deepEqual(
			validate(loaded.module, {
				...validRequest,
				candidateModulePath: 'src/other.virune',
			}).diagnostics.map(item => item.code),
			['L5011'],
		);
		const invalidFunction = validate(loaded.module, {
			...validRequest,
			isPublic: false,
			typeParameterCount: 1,
			parameterCount: 2,
			returnKind: 'int',
		});
		assert.equal(invalidFunction.accepted, false);
		assert.deepEqual(
			invalidFunction.diagnostics.map(item => item.code),
			['L5012', 'L5013', 'L5014', 'L5016'],
		);
		assert.deepEqual(
			validate(loaded.module, {
				...validRequest,
				parameterCount: 1,
				firstParameterType: 'Int',
			}).diagnostics.map(item => item.code),
			['L5015'],
		);
		assert.ok(invalidFunction.diagnostics.every(item => (
			item.severity === 'error' && item.sourcePath === validRequest.entryPath
		)));
		assert.deepEqual(
			invalidFunction.diagnostics.map(item => item.message),
			[
				'Entry function main must be public',
				'Entry function main cannot be generic',
				'Entry function main accepts zero parameters or one List<String> parameter',
				'Entry function main must return Unit or Result<Unit, E>',
			],
		);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('project entry-point JSON boundary rejects stale and malformed facts', async () => {
	const loaded = await loadEntryPointModule();
	try {
		assert.deepEqual(
			validate(loaded.module, { ...validRequest, version: '2' }).diagnostics.map(item => item.code),
			['SHP2400'],
		);
		assert.deepEqual(
			validate(loaded.module, { ...validRequest, parameterCount: -1 }).diagnostics.map(item => item.code),
			['SHP2401'],
		);
		assert.equal(loaded.module.validateProjectEntryPointJson('{').$tag, 'Err');
		assert.equal(loaded.module.validateProjectEntryPointJson('{}').$tag, 'Err');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function validate(module: EntryPointModule, request: EntryPointRequest): EntryPointResult {
	const encoded = module.validateProjectEntryPointJson(JSON.stringify(request));
	assert.equal(encoded.$tag, 'Ok');
	return JSON.parse(encoded.$values[0]) as EntryPointResult;
}

async function loadEntryPointModule(): Promise<{ readonly root: string; readonly module: EntryPointModule }> {
	const result = await buildProject(mvpRoot, {
		write: false,
		additionalEntries: ['src/project-entry-point.virune'],
	});
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-project-entry-point-'));
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
	const moduleUrl = `${pathToFileURL(join(root, 'project-entry-point.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as EntryPointModule };
}
