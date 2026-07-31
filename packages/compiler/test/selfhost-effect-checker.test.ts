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
type EffectFunction = {
	readonly id: number;
	readonly name: string;
	readonly declaredEffects: readonly string[];
	readonly wildcard: boolean;
};
type EffectRequirement = {
	readonly id: number;
	readonly functionId: number;
	readonly requiredEffects: readonly string[];
	readonly missingEffects: readonly string[];
	readonly satisfied: boolean;
};
type Diagnostic = {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly functionId: number | null;
	readonly effect: string | null;
	readonly help: string | null;
};
type EffectResult = {
	readonly accepted: boolean;
	readonly functions: readonly EffectFunction[];
	readonly requirements: readonly EffectRequirement[];
	readonly diagnostics: readonly Diagnostic[];
};
type EffectModule = {
	readonly checkFrontendEffectsContract: (request: string) => ViruneResult<string>;
};

test('declared effects and wildcard requirements are canonical and deterministic', async () => {
	const loaded = await loadEffectModule();
	try {
		const request = {
			functions: [
				{ name: 'readConfig', declaredEffects: ['File', 'Console', 'File'] },
				{ name: 'entry', declaredEffects: ['*', 'Console'] },
				{ name: 'pure', declaredEffects: [] },
			],
			requirements: [
				{ functionId: 0, requiredEffects: ['Console', 'File', 'Console'] },
				{ functionId: 1, requiredEffects: ['JavaScript', 'Network', 'Timer'] },
				{ functionId: 2, requiredEffects: [] },
			],
		};
		const firstEncoded = evaluateEncoded(loaded.module, request);
		const secondEncoded = evaluateEncoded(loaded.module, request);
		assert.equal(firstEncoded, secondEncoded);
		const result = JSON.parse(firstEncoded) as EffectResult;
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.functions.map(item => item.id), [0, 1, 2]);
		assert.deepEqual(result.functions[0]?.declaredEffects, ['Console', 'File']);
		assert.equal(result.functions[1]?.wildcard, true);
		assert.ok(result.requirements.every(item => item.satisfied));
		assert.deepEqual(result.requirements[0]?.requiredEffects, ['Console', 'File']);
		assert.deepEqual(result.requirements[1]?.requiredEffects, ['Network', 'Timer', 'JavaScript']);
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('missing and unknown effects preserve Legacy L2076 and L2085 diagnostics', async () => {
	const loaded = await loadEffectModule();
	try {
		const result = evaluate(loaded.module, {
			functions: [
				{ name: 'worker', declaredEffects: ['Console', 'MadeUp', 'MadeUp'] },
				{ name: 'network', declaredEffects: ['Network'] },
			],
			requirements: [
				{ functionId: 0, requiredEffects: ['Console', 'File', 'Ghost', 'File'] },
				{ functionId: 1, requiredEffects: ['Network', 'Timer'] },
			],
		});
		assert.equal(result.accepted, false);
		assert.deepEqual(result.functions[0]?.declaredEffects, ['Console']);
		assert.deepEqual(result.requirements[0]?.missingEffects, ['File']);
		assert.deepEqual(result.requirements[1]?.missingEffects, ['Timer']);
		assert.equal(result.requirements[0]?.satisfied, false);
		assert.equal(result.diagnostics.filter(item => item.code === 'L2085').length, 2);
		assert.equal(result.diagnostics.filter(item => item.code === 'L2076').length, 2);
		assert.ok(result.diagnostics.every(item => item.help !== null));
		validateReferences(result);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('duplicate names and malformed function references are bounded and deterministic', async () => {
	const loaded = await loadEffectModule();
	try {
		const request = {
			functions: [
				{ name: 'entry', declaredEffects: [] },
				{ name: 'entry', declaredEffects: ['Console'] },
				{ name: '', declaredEffects: [] },
			],
			requirements: [
				{ functionId: 9, requiredEffects: ['Console'] },
				{ functionId: -1, requiredEffects: [] },
			],
		};
		const first = evaluate(loaded.module, request);
		const second = evaluate(loaded.module, request);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.ok(first.diagnostics.some(item => item.code === 'L1001'));
		assert.equal(first.diagnostics.filter(item => item.code === 'L9001').length, 3);
		assert.ok(first.requirements.every(item => item.satisfied === false));
		validateReferences(first);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function evaluate(module: EffectModule, request: unknown): EffectResult {
	return JSON.parse(evaluateEncoded(module, request)) as EffectResult;
}

function evaluateEncoded(module: EffectModule, request: unknown): string {
	const encoded = module.checkFrontendEffectsContract(JSON.stringify(request));
	if (encoded.$tag !== 'Ok') throw new Error(`Effect contract failed: ${JSON.stringify(encoded.$values[0])}`);
	return encoded.$values[0];
}

function validateReferences(result: EffectResult): void {
	assert.deepEqual(result.functions.map(item => item.id), result.functions.map((_, index) => index));
	assert.deepEqual(result.requirements.map(item => item.id), result.requirements.map((_, index) => index));
	for (const requirement of result.requirements) {
		if (requirement.functionId >= 0 && requirement.functionId < result.functions.length) continue;
		assert.equal(requirement.satisfied, false);
	}
}

async function loadEffectModule(): Promise<{ readonly root: string; readonly module: EffectModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-effect-checker-'));
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
	const moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as EffectModule };
}
