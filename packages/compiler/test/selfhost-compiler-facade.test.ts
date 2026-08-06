import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createInternalCompilerFacade,
	INTERNAL_COMPILER_DEFAULT_SELECTION,
	INTERNAL_COMPILER_FACADE_VERSION,
	type InternalKernelCompiler,
} from '../src/selfhost/compiler-facade.js';
import type { KernelInputV1, KernelOutputV1 } from '../src/selfhost/contract.js';

const input: KernelInputV1 = {
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [{ path: 'src/main.virune', text: 'pub fn main() -> Int {\n\treturn 0\n}\n' }],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: false, sourcesContent: true },
};

function output(marker: string): KernelOutputV1 {
	return {
		contractVersion: '1',
		languageVersion: '1.0',
		platform: 'node',
		entryPath: input.entryPath,
		accepted: true,
		diagnostics: [],
		emittedModules: [{
			sourcePath: input.entryPath,
			outputPath: 'dist/main.js',
			code: `export const compiler = ${JSON.stringify(marker)};\n`,
			sourceMap: '',
		}],
		dependencies: [],
		exportedSymbols: [{
			modulePath: input.entryPath,
			name: 'compiler',
			declarationKind: 'VariableDeclaration',
		}],
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 1,
			reusedCheckedModules: 0,
			emittedModules: 1,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
}

function trackedCompiler(marker: string, calls: KernelInputV1[]): InternalKernelCompiler {
	return value => {
		calls.push(value);
		return output(marker);
	};
}

test('internal facade keeps Legacy as the immutable default selection', async () => {
	const legacyCalls: KernelInputV1[] = [];
	const selfHostCalls: KernelInputV1[] = [];
	const facade = createInternalCompilerFacade({
		legacyCompiler: trackedCompiler('legacy', legacyCalls),
		selfHostCompiler: trackedCompiler('self-host', selfHostCalls),
	});
	assert.equal(facade.version, INTERNAL_COMPILER_FACADE_VERSION);
	assert.equal(facade.defaultSelection, INTERNAL_COMPILER_DEFAULT_SELECTION);
	assert.equal(facade.defaultSelection, 'legacy');
	assert.equal(facade.selfHostAvailable, true);
	assert.equal((await facade.compile(input)).emittedModules[0]?.code, 'export const compiler = "legacy";\n');
	assert.equal((await facade.compile(input, {})).emittedModules[0]?.code, 'export const compiler = "legacy";\n');
	assert.equal(legacyCalls.length, 2);
	assert.equal(selfHostCalls.length, 0);
	assert.deepEqual(legacyCalls[0], input);
});

test('self-host compiler runs only through an explicit per-call opt-in', async () => {
	const legacyCalls: KernelInputV1[] = [];
	const selfHostCalls: KernelInputV1[] = [];
	const facade = createInternalCompilerFacade({
		legacyCompiler: trackedCompiler('legacy', legacyCalls),
		selfHostCompiler: trackedCompiler('self-host', selfHostCalls),
	});
	const result = await facade.compile(input, { selection: 'self-host' });
	assert.equal(result.emittedModules[0]?.code, 'export const compiler = "self-host";\n');
	assert.equal(legacyCalls.length, 0);
	assert.equal(selfHostCalls.length, 1);
	assert.equal(facade.defaultSelection, 'legacy');
});

test('self-host selection fails closed when no candidate compiler is available', async () => {
	const facade = createInternalCompilerFacade({ legacyCompiler: async () => output('legacy') });
	assert.equal(facade.selfHostAvailable, false);
	await assert.rejects(
		facade.compile(input, { selection: 'self-host' }),
		/self-host was selected but no self-host compiler is available/u,
	);
});

test('selection options reject implicit or unknown switching mechanisms', async () => {
	const facade = createInternalCompilerFacade({ legacyCompiler: async () => output('legacy') });
	await assert.rejects(
		facade.compile(input, { selection: 'automatic' } as never),
		/expected legacy or self-host/u,
	);
	await assert.rejects(
		facade.compile(input, { selection: 'legacy', environment: 'production' } as never),
		/options\.environment: unknown property/u,
	);
	await assert.rejects(
		facade.compile(input, null as never),
		/options: expected a plain object/u,
	);
});

test('compiler output is revalidated at the facade boundary', async () => {
	const facade = createInternalCompilerFacade({
		legacyCompiler: async () => ({ ...output('legacy'), contractVersion: 'invalid' } as never),
	});
	await assert.rejects(facade.compile(input), /contractVersion/u);
});
