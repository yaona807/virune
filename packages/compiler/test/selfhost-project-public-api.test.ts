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
type TypeFact = { readonly name: string; readonly isPublic: boolean };
type DeclarationFact = {
	readonly id: number;
	readonly name: string;
	readonly kind: string;
	readonly isPublic: boolean;
	readonly referencedTypeNames: readonly string[];
	readonly span: Span;
};
type PublicApiRequest = {
	readonly version: string;
	readonly sourcePath: string;
	readonly moduleSpan: Span;
	readonly localTypes: readonly TypeFact[];
	readonly declarations: readonly DeclarationFact[];
};
type PublicApiDiagnostic = {
	readonly code: string;
	readonly severity: 'error';
	readonly message: string;
	readonly sourcePath: string;
	readonly span: Span;
};
type PublicApiResult = {
	readonly accepted: boolean;
	readonly version: string;
	readonly sourcePath: string;
	readonly diagnostics: readonly PublicApiDiagnostic[];
};
type PublicApiModule = {
	readonly validateProjectPublicApiJson: (request: string) => ViruneResult<string>;
};

const position = (offset: number, line: number, column: number): Position => ({ offset, line, column });
const span = (start: Position, end: Position): Span => ({ start, end });
const moduleSpan = span(position(0, 1, 1), position(180, 12, 2));
const functionSpan = span(position(20, 2, 1), position(70, 4, 2));
const recordSpan = span(position(80, 6, 1), position(130, 8, 2));
const newtypeSpan = span(position(140, 10, 1), position(175, 10, 36));

const validRequest: PublicApiRequest = {
	version: '1',
	sourcePath: 'src/api.virune',
	moduleSpan,
	localTypes: [
		{ name: 'PublicType', isPublic: true },
		{ name: 'PrivateType', isPublic: false },
	],
	declarations: [
		{
			id: 0,
			name: 'load',
			kind: 'FunctionDeclaration',
			isPublic: true,
			referencedTypeNames: ['PublicType', 'String', 'ImportedType'],
			span: functionSpan,
		},
		{
			id: 1,
			name: 'InternalRecord',
			kind: 'RecordDeclaration',
			isPublic: false,
			referencedTypeNames: ['PrivateType'],
			span: recordSpan,
		},
		{
			id: 2,
			name: 'OpaqueId',
			kind: 'NewtypeDeclaration',
			isPublic: true,
			referencedTypeNames: ['PrivateType'],
			span: newtypeSpan,
		},
	],
};

test('project public API contract accepts visible, external, private, and opaque signatures', async () => {
	const loaded = await loadPublicApiModule();
	try {
		const result = validate(loaded.module, validRequest);
		assert.equal(result.accepted, true);
		assert.equal(result.version, '1');
		assert.equal(result.sourcePath, validRequest.sourcePath);
		assert.deepEqual(result.diagnostics, []);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('project public API contract preserves Legacy L4010 ordering, messages, and spans', async () => {
	const loaded = await loadPublicApiModule();
	try {
		const request: PublicApiRequest = {
			...validRequest,
			localTypes: [
				{ name: 'PrivateA', isPublic: false },
				{ name: 'PublicType', isPublic: true },
				{ name: 'PrivateB', isPublic: false },
			],
			declarations: [
				{
					id: 0,
					name: 'load',
					kind: 'FunctionDeclaration',
					isPublic: true,
					referencedTypeNames: ['PrivateA', 'PrivateA', 'PublicType', 'Missing', 'PrivateB'],
					span: functionSpan,
				},
				{
					id: 1,
					name: 'Envelope',
					kind: 'RecordDeclaration',
					isPublic: true,
					referencedTypeNames: ['PrivateB', 'PrivateA'],
					span: recordSpan,
				},
				{
					id: 2,
					name: 'internal',
					kind: 'FunctionDeclaration',
					isPublic: false,
					referencedTypeNames: ['PrivateA'],
					span: functionSpan,
				},
				{
					id: 3,
					name: 'OpaqueId',
					kind: 'NewtypeDeclaration',
					isPublic: true,
					referencedTypeNames: ['PrivateB'],
					span: newtypeSpan,
				},
			],
		};
		const result = validate(loaded.module, request);
		assert.equal(result.accepted, false);
		assert.deepEqual(result.diagnostics.map(item => item.code), ['L4010', 'L4010', 'L4010', 'L4010']);
		assert.deepEqual(
			result.diagnostics.map(item => item.message),
			[
				'Public declaration load exposes private type PrivateA',
				'Public declaration load exposes private type PrivateB',
				'Public declaration Envelope exposes private type PrivateB',
				'Public declaration Envelope exposes private type PrivateA',
			],
		);
		assert.deepEqual(
			result.diagnostics.map(item => item.span),
			[functionSpan, functionSpan, recordSpan, recordSpan],
		);
		assert.ok(result.diagnostics.every(item => (
			item.severity === 'error' && item.sourcePath === request.sourcePath
		)));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('project public API JSON boundary rejects stale and malformed facts', async () => {
	const loaded = await loadPublicApiModule();
	try {
		const unsupported = validate(loaded.module, { ...validRequest, version: '2' });
		assert.deepEqual(unsupported.diagnostics.map(item => item.code), ['SHP2410']);
		assert.deepEqual(unsupported.diagnostics[0]?.span, moduleSpan);

		const nonContiguous = validate(loaded.module, {
			...validRequest,
			declarations: [{ ...validRequest.declarations[0]!, id: 1 }],
		});
		assert.deepEqual(nonContiguous.diagnostics.map(item => item.code), ['SHP2411']);
		assert.deepEqual(nonContiguous.diagnostics[0]?.span, functionSpan);

		const unknownKind = validate(loaded.module, {
			...validRequest,
			declarations: [{ ...validRequest.declarations[0]!, kind: 'UnknownDeclaration' }],
		});
		assert.deepEqual(unknownKind.diagnostics.map(item => item.code), ['SHP2411']);

		const emptyReference = validate(loaded.module, {
			...validRequest,
			declarations: [{ ...validRequest.declarations[0]!, referencedTypeNames: [''] }],
		});
		assert.deepEqual(emptyReference.diagnostics.map(item => item.code), ['SHP2411']);

		assert.equal(loaded.module.validateProjectPublicApiJson('{').$tag, 'Err');
		assert.equal(loaded.module.validateProjectPublicApiJson('{}').$tag, 'Err');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function validate(module: PublicApiModule, request: PublicApiRequest): PublicApiResult {
	const encoded = module.validateProjectPublicApiJson(JSON.stringify(request));
	assert.equal(encoded.$tag, 'Ok');
	return JSON.parse(encoded.$values[0]) as PublicApiResult;
}

async function loadPublicApiModule(): Promise<{ readonly root: string; readonly module: PublicApiModule }> {
	const result = await buildProject(mvpRoot, {
		write: false,
		additionalEntries: ['src/project-public-api.virune'],
	});
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-project-public-api-'));
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
	const moduleUrl = `${pathToFileURL(join(root, 'project-public-api.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as PublicApiModule };
}
