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
type Position = { readonly offset: number; readonly line: number; readonly column: number };
type Span = { readonly start: Position; readonly end: Position };
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
	readonly moduleSpan: Span;
	readonly candidateSpan: Span;
	readonly parameterSpan: Span;
	readonly returnSpan: Span;
};
type EntryPointDiagnostic = {
	readonly code: string;
	readonly severity: 'error';
	readonly message: string;
	readonly sourcePath: string;
	readonly span: Span;
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

const position = (offset: number, line: number, column: number): Position => ({ offset, line, column });
const span = (start: Position, end: Position): Span => ({ start, end });
const moduleSpan = span(position(0, 1, 1), position(120, 8, 2));
const candidateSpan = span(position(20, 2, 1), position(118, 7, 2));
const parameterSpan = span(position(32, 2, 13), position(50, 2, 31));
const returnSpan = span(position(55, 2, 36), position(59, 2, 40));

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
	moduleSpan,
	candidateSpan,
	parameterSpan,
	returnSpan,
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

test('project entry-point contract preserves Legacy L5010-L5016 diagnostics and spans', async () => {
	const loaded = await loadEntryPointModule();
	try {
		const unanalyzed = validate(loaded.module, { ...validRequest, analyzed: false });
		assert.deepEqual(unanalyzed.diagnostics.map(item => item.code), ['L5010']);
		assert.deepEqual(unanalyzed.diagnostics[0]?.span, moduleSpan);

		const missing = validate(loaded.module, { ...validRequest, hasMain: false });
		assert.deepEqual(missing.diagnostics.map(item => item.code), ['L5011']);
		assert.deepEqual(missing.diagnostics[0]?.span, moduleSpan);

		const staleCandidate = validate(loaded.module, {
			...validRequest,
			candidateModulePath: 'src/other.virune',
		});
		assert.deepEqual(staleCandidate.diagnostics.map(item => item.code), ['L5011']);
		assert.deepEqual(staleCandidate.diagnostics[0]?.span, candidateSpan);

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
			invalidFunction.diagnostics.map(item => item.span),
			[candidateSpan, candidateSpan, candidateSpan, returnSpan],
		);

		const invalidParameter = validate(loaded.module, {
			...validRequest,
			parameterCount: 1,
			firstParameterType: 'Int',
		});
		assert.deepEqual(invalidParameter.diagnostics.map(item => item.code), ['L5015']);
		assert.deepEqual(invalidParameter.diagnostics[0]?.span, parameterSpan);

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
		const unsupported = validate(loaded.module, { ...validRequest, version: '2' });
		assert.deepEqual(unsupported.diagnostics.map(item => item.code), ['SHP2400']);
		assert.deepEqual(unsupported.diagnostics[0]?.span, moduleSpan);

		const invalidCounts = validate(loaded.module, { ...validRequest, parameterCount: -1 });
		assert.deepEqual(invalidCounts.diagnostics.map(item => item.code), ['SHP2401']);
		assert.deepEqual(invalidCounts.diagnostics[0]?.span, moduleSpan);

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
