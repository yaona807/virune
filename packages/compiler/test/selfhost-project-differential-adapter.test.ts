import assert from 'node:assert/strict';
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
};

const semanticRuntimeExpectations: readonly (readonly [string, unknown])[] = [
	['project-semantic-arithmetic-branch', 17],
	['project-semantic-list-fold', 10],
	['project-semantic-literal-match', 30],
	['project-semantic-tuple-roundtrip', [4, 7]],
	['project-semantic-record-field', 42],
	['project-semantic-result-branch', { $tag: 'Ok', $values: [42] }],
	['project-semantic-async-await', 42],
];

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
		...semanticRuntimeExpectations.map(([id]) => id),
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

test('semantic Project differential fixtures retain independently grounded Legacy runtime meaning', async t => {
	const corpus = loadDifferentialCorpus();
	for (const [fixtureId, expectedReturnValue] of semanticRuntimeExpectations) {
		await t.test(fixtureId, async () => {
			const fixture = corpus.fixtures.find(item => item.id === fixtureId);
			assert.ok(fixture, `missing semantic differential fixture ${fixtureId}`);
			assert.ok(fixture.tags.includes('semantic'), `${fixtureId}: semantic tag`);
			const fixtureInput = validateKernelInput(fixture.input);
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
