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

type InteropImport = { readonly kind: string; readonly importedName: string | null };
type ResolutionWitness = {
	readonly moduleSpecifier: string;
	readonly runtimeFormat: string | null;
	readonly conditions: readonly string[];
	readonly platform: string;
	readonly providerVersion: string;
};
type InteropModule = {
	readonly specifier: string;
	readonly imports: readonly InteropImport[];
	readonly resolutionWitness: ResolutionWitness | null;
};
type ManifestDiagnostic = {
	readonly code: string;
	readonly severity: 'error';
	readonly message: string;
	readonly specifier: string | null;
};
type ManifestResult = {
	readonly accepted: boolean;
	readonly version: string;
	readonly platform: string;
	readonly modules: readonly InteropModule[];
	readonly diagnostics: readonly ManifestDiagnostic[];
};
type ManifestModule = {
	readonly validateProjectInteropManifestJson: (request: string) => ViruneResult<string>;
};

const nodeWitness = (specifier: string, conditions: readonly string[]): ResolutionWitness => ({
	moduleSpecifier: specifier,
	runtimeFormat: 'esm',
	conditions,
	platform: 'node',
	providerVersion: 'host-v1',
});

test('Interop Manifest validation canonicalizes modules, imports, and witness conditions', async () => {
	const loaded = await loadManifestModule();
	try {
		const modules: readonly InteropModule[] = [
			{
				specifier: 'z-package',
				imports: [
					{ kind: 'side-effect', importedName: null },
					{ kind: 'named', importedName: 'parse' },
				],
				resolutionWitness: nodeWitness('z-package', ['node', 'import']),
			},
			{
				specifier: 'a-package',
				imports: [
					{ kind: 'type-only', importedName: 'Options' },
					{ kind: 'default', importedName: null },
				],
				resolutionWitness: nodeWitness('a-package', ['types', 'node']),
			},
		];
		const first = validate(loaded.module, { version: '1', platform: 'node', modules });
		const second = validate(loaded.module, { version: '1', platform: 'node', modules: [...modules].reverse() });
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.modules.map(item => item.specifier), ['a-package', 'z-package']);
		assert.deepEqual(first.modules[0]?.imports, [
			{ kind: 'default', importedName: null },
			{ kind: 'type-only', importedName: 'Options' },
		]);
		assert.deepEqual(first.modules[0]?.resolutionWitness?.conditions, ['node', 'types']);
		assert.deepEqual(first.modules[1]?.imports, [
			{ kind: 'named', importedName: 'parse' },
			{ kind: 'side-effect', importedName: null },
		]);
		assert.deepEqual(first.modules[1]?.resolutionWitness?.conditions, ['import', 'node']);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('Interop Manifest validation rejects stale and malformed module metadata deterministically', async () => {
	const loaded = await loadManifestModule();
	try {
		const modules: readonly InteropModule[] = [
			{
				specifier: 'pkg',
				imports: [
					{ kind: 'named', importedName: null },
					{ kind: 'default', importedName: 'unexpected' },
					{ kind: 'named', importedName: 'value' },
					{ kind: 'named', importedName: 'value' },
				],
				resolutionWitness: {
					moduleSpecifier: 'other',
					runtimeFormat: 'script',
					conditions: ['node', '', 'node'],
					platform: 'browser',
					providerVersion: '',
				},
			},
			{
				specifier: 'pkg',
				imports: [],
				resolutionWitness: null,
			},
		];
		const first = validate(loaded.module, { version: '2', platform: 'node', modules });
		const second = validate(loaded.module, { version: '2', platform: 'node', modules: [...modules].reverse() });
		assert.deepEqual(first.diagnostics, second.diagnostics);
		assert.equal(first.accepted, false);
		assert.equal(second.accepted, false);
		assert.deepEqual(first.diagnostics.map(item => item.code), [
			'SHP2300',
			'SHP2302',
			'SHP2305',
			'SHP2306',
			'SHP2307',
			'SHP2310',
			'SHP2311',
			'SHP2312',
			'SHP2313',
			'SHP2314',
			'SHP2315',
		]);
		assert.ok(first.diagnostics.every(item => item.severity === 'error'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('Interop Manifest JSON boundary fails closed on malformed input', async () => {
	const loaded = await loadManifestModule();
	try {
		assert.equal(loaded.module.validateProjectInteropManifestJson('{').$tag, 'Err');
		assert.equal(loaded.module.validateProjectInteropManifestJson('{}').$tag, 'Err');
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function validate(
	module: ManifestModule,
	request: { readonly version: string; readonly platform: string; readonly modules: readonly InteropModule[] },
): ManifestResult {
	const encoded = module.validateProjectInteropManifestJson(JSON.stringify(request));
	assert.equal(encoded.$tag, 'Ok');
	return JSON.parse(encoded.$values[0]) as ManifestResult;
}

async function loadManifestModule(): Promise<{ readonly root: string; readonly module: ManifestModule }> {
	const result = await buildProject(mvpRoot, {
		write: false,
		additionalEntries: ['src/project-interop-manifest.virune'],
	});
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-project-interop-manifest-'));
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
	const moduleUrl = `${pathToFileURL(join(root, 'project-interop-manifest.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as ManifestModule };
}
