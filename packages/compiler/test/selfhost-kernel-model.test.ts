import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';
import {
	createKernelModelHostAdapter,
	KernelModelHostError,
	type SelfhostKernelModelModule,
} from '../src/selfhost/kernel-model-host-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const kernelRoot = join(repositoryRoot, 'selfhost', 'kernel');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

const emptyModel = (strings: readonly string[], numbers: readonly number[]) => ({
	version: 1,
	positions: [],
	spans: [],
	tokens: [],
	diagnostics: [],
	nodes: [],
	symbols: [],
	types: [],
	strings: {
		entries: strings.map((value, index) => ({ id: { value: strings.length - index }, value })),
	},
	numbers: {
		entries: numbers.map((value, index) => ({ id: { value: numbers.length - index }, value })),
	},
});

test('Stage 0 compiler builds the Virune kernel model and host adapter round-trips canonical data', async () => {
	const loaded = await loadKernelModule();
	try {
		const adapter = createKernelModelHostAdapter(loaded.module);
		const left = adapter.encodeCanonicalModel(emptyModel(['zeta', 'alpha', 'beta', 'zeta'], [9, 1, 3, 9]));
		const right = adapter.encodeCanonicalModel(emptyModel(['beta', 'zeta', 'alpha'], [3, 9, 1]));
		assert.equal(left, right);

		const parsed = JSON.parse(left) as {
			strings: { entries: readonly { id: { value: number }; value: string }[] };
			numbers: { entries: readonly { id: { value: number }; value: number }[] };
		};
		assert.deepEqual(parsed.strings.entries, [
			{ id: { value: 0 }, value: 'alpha' },
			{ id: { value: 1 }, value: 'beta' },
			{ id: { value: 2 }, value: 'zeta' },
		]);
		assert.deepEqual(parsed.numbers.entries, [
			{ id: { value: 0 }, value: 1 },
			{ id: { value: 1 }, value: 3 },
			{ id: { value: 2 }, value: 9 },
		]);
		assert.deepEqual(adapter.decodeModel(parsed), parsed);

		const probe = adapter.runArenaProbe() as {
			readonly first: string;
			readonly second: string;
			readonly count: number;
			readonly missingRejected: boolean;
		};
		assert.deepEqual(probe, { first: 'first', second: 'second', count: 2, missingRejected: true });
		assert.throws(() => adapter.decodeModel({}), KernelModelHostError);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

async function loadKernelModule(): Promise<{ readonly root: string; readonly module: SelfhostKernelModelModule }> {
	const result = await buildProject(kernelRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-kernel-'));
	const configuredOutDir = resolve(kernelRoot, 'dist');
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
	}
	const moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as SelfhostKernelModelModule };
}
