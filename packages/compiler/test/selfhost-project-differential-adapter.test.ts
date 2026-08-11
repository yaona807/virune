import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateKernelInput, type KernelInputV1 } from '../src/selfhost/contract.js';
import { compileWithLegacyKernel } from '../src/selfhost/legacy-adapter.js';
import { executeKernelOutputWithNode } from '../src/selfhost/node-executor.js';
import {
	compileWithSelfhostProject,
	createSelfhostProjectKernel,
	projectCompilerResultToKernelOutput,
} from '../src/selfhost/project-differential-adapter.js';
import type {
	ProjectCompilerResultV1,
	SelfhostProjectCompilerModule,
} from '../src/selfhost/project-compiler-adapter.js';

const input = (): KernelInputV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: 'pub fn main() -> Int {\n\treturn 7\n}\n' }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
});

const acceptedProjectResult = (): ProjectCompilerResultV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	accepted: true,
	diagnostics: [],
	emittedModules: [{
		sourcePath: 'src/main.virune',
		outputPath: '.selfhost-output/src/main.js',
		code: 'export function main() { return 7; }\n',
		sourceMap: '',
	}],
	dependencies: [{
		modulePath: 'src/main.virune',
		sourceKind: 'virune',
		specifier: './missing.virune',
		resolvedPath: null,
		typeOnly: false,
		public: false,
	}],
	exportedSymbols: [{ modulePath: 'src/main.virune', name: 'main', declarationKind: 'FunctionDeclaration' }],
	stats: {
		parsedModules: 1,
		reusedParsedModules: 0,
		checkedModules: 1,
		reusedCheckedModules: 0,
		emittedModules: 1,
		reusedEmittedModules: 0,
		invalidatedModules: 0,
	},
});

type DifferentialCorpusFixture = {
	readonly id: string;
	readonly tags: readonly string[];
	readonly input: unknown;
	readonly expectedDivergences?: readonly unknown[];
};

const semanticRuntimeFixtures = [
	{ id: 'project-semantic-arithmetic-branch', sourceSha256: '39d823ab4f757784c215e7b6a5d8f68197dc1ba9bb01c5d937434d76c99ae52b', expectedReturnValue: 17 },
	{ id: 'project-semantic-list-fold', sourceSha256: 'a2d603a00cdf2a1e6322415b0bc125ccf76962d234842e5c6f6dfb01851ad5cb', expectedReturnValue: 10 },
	{ id: 'project-semantic-literal-match', sourceSha256: 'f1cab445d8aba2ef0f7304a88e07b08a80dadaf1bb61630a5a416fe1e3804956', expectedReturnValue: 30 },
	{ id: 'project-semantic-tuple-roundtrip', sourceSha256: '49e171bbf8f047f7bd9eba010d024444934eaaa8908ddce2239e685ccad25a2a', expectedReturnValue: [4, 7] },
	{ id: 'project-semantic-record-field', sourceSha256: 'd7431efb1ddae40ea2d98e257a900f6feaaee9681fedcb3bb19eb07655050171', expectedReturnValue: 42 },
	{ id: 'project-semantic-result-branch', sourceSha256: '8ff0ba426eba08d681b4604cb9e1eb9b66b9ad849b2a5fa35b6c31ab3aab5864', expectedReturnValue: { $tag: 'Ok', $values: [42] } },
	{ id: 'project-semantic-async-await', sourceSha256: '8575208a0a4bb2d0e1d58d16df820edc3c540369d4af068cf70bcaec5adef854', expectedReturnValue: 42 },
] as const;

const semanticDiagnosticFixtures = [
	{
		id: 'project-semantic-invalid-data-types',
		sourceSha256: '74d2739d6cde3e7b8e5f531062929da3b5aad4da4753f85d102129d5073aca56',
		expectedDiagnostics: [
			{
				code: 'L1001',
				severity: 'error',
				sourcePath: 'src/main.virune',
				span: {
					start: { offset: 0, line: 1, column: 1 },
					end: { offset: 0, line: 1, column: 1 },
				},
				help: null,
			},
			{
				code: 'L1001',
				severity: 'error',
				sourcePath: 'src/main.virune',
				span: {
					start: { offset: 84, line: 5, column: 5 },
					end: { offset: 97, line: 5, column: 19 },
				},
				help: null,
			},
			{
				code: 'L2041',
				severity: 'error',
				sourcePath: 'src/main.virune',
				span: {
					start: { offset: 112, line: 7, column: 12 },
					end: { offset: 122, line: 7, column: 23 },
				},
				help: null,
			},
		],
	},
	{
		id: 'project-semantic-recursive-alias',
		sourceSha256: 'b7a44ffd0cd0367f01d524c613174034ce5c17c9fc82c964071776c6e55cdefc',
		expectedDiagnostics: [
			{
				code: 'L2040',
				severity: 'error',
				sourcePath: 'src/main.virune',
				span: {
					start: { offset: 20, line: 1, column: 21 },
					end: { offset: 20, line: 1, column: 22 },
				},
				help: null,
			},
		],
	},
] as const;

function acceptedProjectModule(onCompile?: (request: string) => void): SelfhostProjectCompilerModule {
	return {
		compileMvp: () => ({ $tag: 'Err', $values: ['unused'] }),
		projectCompilerCapability: () => ({
			$tag: 'Ok',
			$values: [JSON.stringify({
				contractVersion: '1',
				ready: true,
				requestSchema: 'virune.selfhost.project-compiler.request.v1',
				resultSchema: 'virune.selfhost.project-compiler.result.v2',
				blockers: [],
			})],
		}),
		compileProjectMvp: request => {
			onCompile?.(request);
			return { $tag: 'Ok', $values: [JSON.stringify(acceptedProjectResult())] };
		},
	};
}

function hasErrorMessage(message: string): (error: unknown) => boolean {
	return error => error instanceof Error && error.message === message;
}

function loadDifferentialCorpus(): { readonly fixtures: readonly DifferentialCorpusFixture[] } {
	return JSON.parse(readFileSync(
		new URL('../../../../.github/self-hosting/differential-corpus-v1.json', import.meta.url),
		'utf8',
	)) as { readonly fixtures: readonly DifferentialCorpusFixture[] };
}

test('project result conversion preserves the shared Kernel contract and omits null optionals', () => {
	const output = projectCompilerResultToKernelOutput(acceptedProjectResult());
	assert.equal(output.accepted, true);
	assert.equal(output.platform, 'node');
	assert.equal(output.emittedModules[0]?.code, 'export function main() { return 7; }\n');
	assert.equal('resolvedPath' in (output.dependencies[0] ?? {}), false);
	assert.deepEqual(output.exportedSymbols, [
		{ modulePath: 'src/main.virune', name: 'main', declarationKind: 'FunctionDeclaration' },
	]);
});

test('project-only diagnostic notes are not invented as Kernel metadata', () => {
	const rejected: ProjectCompilerResultV1 = {
		...acceptedProjectResult(),
		accepted: false,
		diagnostics: [{
			code: 'L0001',
			severity: 'error',
			message: 'broken source',
			sourcePath: null,
			span: {
				start: { offset: 0, line: 1, column: 1 },
				end: { offset: 1, line: 1, column: 2 },
			},
			notes: ['project-only note'],
		}],
		emittedModules: [],
		dependencies: [],
		exportedSymbols: [],
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 0,
			reusedCheckedModules: 0,
			emittedModules: 0,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
	const output = projectCompilerResultToKernelOutput(rejected);
	assert.equal(output.accepted, false);
	assert.equal('sourcePath' in (output.diagnostics[0] ?? {}), false);
	assert.equal('notes' in (output.diagnostics[0] ?? {}), false);
});

test('Self-host project kernel delegates through the validated Project Compiler boundary', async () => {
	const module = acceptedProjectModule(request => {
		const parsed = JSON.parse(request) as { readonly entryPath: string };
		assert.equal(parsed.entryPath, 'src/main.virune');
	});
	const kernel = createSelfhostProjectKernel(module);
	assert.equal(kernel.name, 'selfhost-project');
	const output = await kernel.compile(input());
	assert.equal(output.accepted, true);
	assert.equal(output.stats.checkedModules, 1);
});

test('project differential rejects unsupported evidence profiles before invoking the project compiler', async () => {
	let compileCalls = 0;
	const module = acceptedProjectModule(() => { compileCalls += 1; });
	const browserInput = input();
	await assert.rejects(
		compileWithSelfhostProject(module, {
			...browserInput,
			platform: 'browser',
		}),
		hasErrorMessage('Project differential currently requires the node platform'),
	);
	const interopInput = input();
	await assert.rejects(
		compileWithSelfhostProject(module, {
			...interopInput,
			interopManifest: {
				version: '1',
				modules: [{ specifier: 'node:fs', metadata: {} }],
			},
		}),
		hasErrorMessage('Project differential v1 does not compare JavaScript interop yet'),
	);
	const sourceMapped = input();
	await assert.rejects(
		compileWithSelfhostProject(module, {
			...sourceMapped,
			emit: { ...sourceMapped.emit, sourceMap: true },
		}),
		hasErrorMessage('Project differential v1 requires source maps to be disabled'),
	);
	const withoutSourcesContent = input();
	await assert.rejects(
		compileWithSelfhostProject(module, {
			...withoutSourcesContent,
			emit: { ...withoutSourcesContent.emit, sourcesContent: false },
		}),
		hasErrorMessage('Project differential v1 requires sourcesContent'),
	);
	assert.equal(compileCalls, 0);
});

test('project-tagged differential fixtures preserve required coverage and satisfy the Project Compiler v1 evidence profile', () => {
	const corpus = loadDifferentialCorpus();
	const requiredProjectFixtureIds = [
		'project-smoke-return-value',
		'project-smoke-multi-module',
		'project-smoke-diagnostic',
		'mvp-arithmetic-call',
		'mvp-primitives-logic',
		'mvp-unknown-name',
		...semanticRuntimeFixtures.map(fixture => fixture.id),
		...semanticDiagnosticFixtures.map(fixture => fixture.id),
	] as const;
	const projectFixtures = corpus.fixtures.filter(fixture => fixture.tags.includes('project'));
	const projectFixtureIds = new Set(projectFixtures.map(fixture => fixture.id));
	for (const fixtureId of requiredProjectFixtureIds) {
		assert.ok(projectFixtureIds.has(fixtureId), `missing required Project Compiler differential fixture ${fixtureId}`);
	}
	for (const fixture of projectFixtures) {
		const fixtureInput = validateKernelInput(fixture.input);
		assert.equal(fixtureInput.platform, 'node', `${fixture.id}: platform`);
		assert.deepEqual(fixtureInput.interopManifest.modules, [], `${fixture.id}: interop must remain out of v1 scope`);
		assert.equal(fixtureInput.emit.sourceMap, false, `${fixture.id}: source maps are outside Project Compiler v1`);
		assert.equal(fixtureInput.emit.sourcesContent, true, `${fixture.id}: sourcesContent`);
	}
});

test('semantic Project differential fixtures retain canonical inputs and independently grounded Legacy runtime meaning', async t => {
	const corpus = loadDifferentialCorpus();
	for (const { id: fixtureId, sourceSha256, expectedReturnValue } of semanticRuntimeFixtures) {
		await t.test(fixtureId, async () => {
			const fixture = corpus.fixtures.find(item => item.id === fixtureId);
			assert.ok(fixture, `missing semantic differential fixture ${fixtureId}`);
			assert.ok(fixture.tags.includes('semantic'), `${fixtureId}: semantic tag`);
			assert.deepEqual(fixture.expectedDivergences, [], `${fixtureId}: semantic baseline must not whitelist divergences`);
			const fixtureInput = validateKernelInput(fixture.input);
			assert.equal(fixtureInput.entryPath, 'src/main.virune', `${fixtureId}: entry path`);
			assert.equal(fixtureInput.sources.length, 1, `${fixtureId}: representative semantic fixture must stay single-module`);
			const source = fixtureInput.sources[0]!;
			assert.equal(source.path, fixtureInput.entryPath, `${fixtureId}: source path`);
			assert.equal(
				createHash('sha256').update(source.text, 'utf8').digest('hex'),
				sourceSha256,
				`${fixtureId}: canonical semantic source`,
			);
			const output = await compileWithLegacyKernel(fixtureInput);
			assert.equal(output.accepted, true, `${fixtureId}: Legacy compiler rejected representative semantic input`);
			const execution = await executeKernelOutputWithNode(fixtureInput, output);
			assert.equal(execution.exitCode, 0, `${fixtureId}: runtime exit code`);
			assert.equal(execution.signal, null, `${fixtureId}: runtime signal`);
			assert.equal(execution.panic, null, `${fixtureId}: runtime panic`);
			assert.deepEqual(execution.returnValue, expectedReturnValue, `${fixtureId}: runtime return value`);
		});
	}
});

test('semantic diagnostic Project differential fixtures retain canonical inputs and the current Legacy diagnostic baseline', async t => {
	const corpus = loadDifferentialCorpus();
	for (const { id: fixtureId, sourceSha256, expectedDiagnostics } of semanticDiagnosticFixtures) {
		await t.test(fixtureId, async () => {
			const fixture = corpus.fixtures.find(item => item.id === fixtureId);
			assert.ok(fixture, `missing semantic diagnostic differential fixture ${fixtureId}`);
			assert.ok(fixture.tags.includes('semantic'), `${fixtureId}: semantic tag`);
			assert.ok(fixture.tags.includes('diagnostic'), `${fixtureId}: diagnostic tag`);
			assert.deepEqual(fixture.expectedDivergences, [], `${fixtureId}: semantic diagnostic baseline must not whitelist divergences`);
			const fixtureInput = validateKernelInput(fixture.input);
			assert.equal(fixtureInput.entryPath, 'src/main.virune', `${fixtureId}: entry path`);
			assert.equal(fixtureInput.sources.length, 1, `${fixtureId}: representative semantic diagnostic fixture must stay single-module`);
			const source = fixtureInput.sources[0]!;
			assert.equal(source.path, fixtureInput.entryPath, `${fixtureId}: source path`);
			assert.equal(
				createHash('sha256').update(source.text, 'utf8').digest('hex'),
				sourceSha256,
				`${fixtureId}: canonical semantic diagnostic source`,
			);
			const output = await compileWithLegacyKernel(fixtureInput);
			assert.equal(output.accepted, false, `${fixtureId}: Legacy compiler unexpectedly accepted representative negative semantic input`);
			assert.deepEqual(
				output.diagnostics.map(diagnostic => ({
					code: diagnostic.code,
					severity: diagnostic.severity,
					sourcePath: diagnostic.sourcePath ?? null,
					span: diagnostic.span,
					help: diagnostic.help ?? null,
				})),
				expectedDiagnostics,
				`${fixtureId}: Legacy diagnostic baseline`,
			);
		});
	}
});

test('Nightly records non-blocking Project differential execution status before evidence upload', () => {
	const workflow = readFileSync(
		new URL('../../../../.github/workflows/nightly.yml', import.meta.url),
		'utf8',
	);
	const runMarker = '      - name: Run the Project Compiler differential suite\n';
	const statusMarker = '      - name: Record Project Compiler differential execution status\n';
	const uploadMarker = '      - name: Upload non-promotable self-host evidence\n';
	const runStart = workflow.indexOf(runMarker);
	const statusStart = workflow.indexOf(statusMarker);
	const uploadStart = workflow.indexOf(uploadMarker);
	assert.notEqual(runStart, -1, 'Project differential Nightly step must exist');
	assert.ok(statusStart > runStart, 'Project differential execution status must follow the runner');
	assert.ok(uploadStart > statusStart, 'Project differential execution status must be recorded before artifact upload');
	const runBlock = workflow.slice(runStart, statusStart);
	assert.ok(runBlock.includes('        id: project-compiler-differential\n'), 'Project differential step must expose its outcome');
	assert.ok(runBlock.includes('        continue-on-error: true\n'), 'Project differential Nightly evidence must remain non-blocking');
	const statusBlock = workflow.slice(statusStart, uploadStart);
	assert.ok(
		statusBlock.includes('          PROJECT_DIFFERENTIAL_OUTCOME: ${{ steps.project-compiler-differential.outcome }}\n'),
		'Project differential status evidence must use the raw step outcome',
	);
	assert.ok(statusBlock.includes("            reportPresent: existsSync(join(output, 'report.json')),\n"));
	assert.ok(statusBlock.includes("          writeFileSync(join(output, 'execution.json')"));
});
