import assert from 'node:assert/strict';
import test from 'node:test';
import * as stableCompilerApi from '../src/public-api.js';
import {
	KernelContractError,
	roundTripKernelInput,
	roundTripKernelOutput,
	validateKernelInput,
	type KernelInputV1,
} from '../src/selfhost/contract.js';
import { compileWithLegacyKernel } from '../src/selfhost/legacy-adapter.js';

const kernelInput = (overrides: Partial<KernelInputV1> = {}): KernelInputV1 => ({
	contractVersion: '1',
	languageVersion: '1.0',
	platform: 'node',
	entryPath: 'src/main.virune',
	sources: [
		{ path: 'src/main.virune', text: 'pub fn main() -> Int {\n\treturn 1\n}\n' },
	],
	interopManifest: { version: '1', modules: [] },
	emit: { target: 'es2022', sourceMap: true, sourcesContent: true },
	...overrides,
});

test('kernel input is canonical, deterministic JSON data', () => {
	const input = validateKernelInput(kernelInput({
		entryPath: '.\\src\\main.virune',
		sources: [
			{ path: 'src\\z.virune', text: 'fn z() -> Int { return 2 }\n' },
			{ path: './src/part/../main.virune', text: 'pub fn main() -> Int { return 1 }\n' },
		],
		interopManifest: {
			version: '1',
			modules: [{ specifier: 'example', metadata: { z: 1, nested: { b: true, a: false }, a: 2 } }],
		},
	}));
	assert.equal(input.entryPath, 'src/main.virune');
	assert.deepEqual(input.sources.map(source => source.path), ['src/main.virune', 'src/z.virune']);
	assert.deepEqual(Object.keys(input.interopManifest.modules[0]!.metadata), ['a', 'nested', 'z']);
	assert.deepEqual(roundTripKernelInput(input), input);
});

test('kernel boundary rejects version drift, host objects, callbacks, and escaping paths', () => {
	assert.throws(() => validateKernelInput({ ...kernelInput(), contractVersion: '2' }), KernelContractError);
	assert.throws(() => validateKernelInput({ ...kernelInput(), entryPath: '../main.virune' }), /must not escape/u);
	assert.throws(() => validateKernelInput({ ...kernelInput(), interopManifest: new Error('host object') }), /class instances/u);
	assert.throws(() => validateKernelInput({
		...kernelInput(),
		interopManifest: { version: '1', modules: [{ specifier: 'example', metadata: { callback: () => 1 } }] },
	}), /JSON data/u);
	assert.throws(() => validateKernelInput({
		...kernelInput(),
		interopManifest: { version: '1', modules: [{ specifier: 'example', metadata: { values: new Map() } }] },
	}), /class instances/u);
});

test('legacy adapter compiles a canonical multi-module project without changing the stable facade', async () => {
	const output = await compileWithLegacyKernel(kernelInput({
		entryPath: 'src/main.virune',
		sources: [
			{
				path: 'src/value.virune',
				text: 'pub fn value() -> Int {\n\treturn 42\n}\n',
			},
			{
				path: 'src/main.virune',
				text: 'import { value } from "./value.virune"\n\npub fn main() -> Int {\n\treturn value()\n}\n',
			},
		],
	}));
	assert.equal(output.accepted, true);
	assert.deepEqual(output.diagnostics, []);
	assert.deepEqual(output.emittedModules.map(module => module.sourcePath), ['src/main.virune', 'src/value.virune']);
	assert.ok(output.emittedModules.every(module => module.outputPath.startsWith('.selfhost-output/')));
	assert.ok(output.dependencies.some(dependency => dependency.modulePath === 'src/main.virune' && dependency.resolvedPath === 'src/value.virune'));
	assert.ok(output.exportedSymbols.some(symbol => symbol.modulePath === 'src/main.virune' && symbol.name === 'main'));
	assert.ok(output.exportedSymbols.some(symbol => symbol.modulePath === 'src/value.virune' && symbol.name === 'value'));
	assert.equal(output.stats.parsedModules, 2);
	assert.deepEqual(roundTripKernelOutput(output), output);
	assert.equal('compileWithLegacyKernel' in stableCompilerApi, false);
});

test('legacy adapter refuses to silently ignore a non-empty Interop Manifest', async () => {
	await assert.rejects(
		compileWithLegacyKernel(kernelInput({
			interopManifest: { version: '1', modules: [{ specifier: 'example', metadata: {} }] },
		})),
		/non-empty Interop Manifest execution is deferred/u,
	);
});
