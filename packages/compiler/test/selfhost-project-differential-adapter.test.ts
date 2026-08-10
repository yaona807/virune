import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateKernelInput, type KernelInputV1 } from '../src/selfhost/contract.js';
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
		/^Project differential currently requires the node platform$/u,
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
		/^Project differential v1 does not compare JavaScript interop yet$/u,
	);
	const sourceMapped = input();
	await assert.rejects(
		compileWithSelfhostProject(module, {
			...sourceMapped,
			emit: { ...sourceMapped.emit, sourceMap: true },
		}),
		/^Project differential v1 requires source maps to be disabled$/u,
	);
	const withoutSourcesContent = input();
	await assert.rejects(
		compileWithSelfhostProject(module, {
			...withoutSourcesContent,
			emit: { ...withoutSourcesContent.emit, sourcesContent: false },
		}),
		/^Project differential v1 requires sourcesContent$/u,
	);
	assert.equal(compileCalls, 0);
});

test('project-tagged differential fixtures satisfy the Project Compiler v1 evidence profile', () => {
	const corpus = JSON.parse(readFileSync(
		new URL('../../../../.github/self-hosting/differential-corpus-v1.json', import.meta.url),
		'utf8',
	)) as {
		readonly fixtures: readonly {
			readonly id: string;
			readonly tags: readonly string[];
			readonly input: unknown;
		}[];
	};
	const projectFixtures = corpus.fixtures.filter(fixture => fixture.tags.includes('project'));
	assert.equal(projectFixtures.length, 6, 'the Project Compiler evidence lane must cover six representative cases');
	for (const fixture of projectFixtures) {
		const fixtureInput = validateKernelInput(fixture.input);
		assert.equal(fixtureInput.platform, 'node', `${fixture.id}: platform`);
		assert.deepEqual(fixtureInput.interopManifest.modules, [], `${fixture.id}: interop must remain out of v1 scope`);
		assert.equal(fixtureInput.emit.sourceMap, false, `${fixture.id}: source maps are outside Project Compiler v1`);
		assert.equal(fixtureInput.emit.sourcesContent, true, `${fixture.id}: sourcesContent`);
	}
});
