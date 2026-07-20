import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { buildInteropAdapters } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('real zod and rxjs adapters compile to the versioned monomorphic ABI', async () => {
	const temporaryRoot = join(repositoryRoot, '.test-tmp');
	await mkdir(temporaryRoot, { recursive: true });
	const outputRoot = await mkdtemp(join(temporaryRoot, 'interop-corpus-'));
	const result = await buildInteropAdapters({ projectRoot: repositoryRoot, sourceDir: 'corpus/js-interop/adapters', outDir: outputRoot, write: true });
	assert.deepEqual(result.diagnostics, []);
	assert.equal(result.artifacts.length, 2);
	const zodArtifact = result.artifacts.find(item => item.sourcePath.endsWith('zod.interop.ts'));
	const rxjsArtifact = result.artifacts.find(item => item.sourcePath.endsWith('rxjs.interop.ts'));
	assert.ok(zodArtifact);
	assert.ok(rxjsArtifact);
	const zodModule = await import(`${pathToFileURL(zodArtifact.outputPath).href}?v=${Date.now()}`) as { parseUser(value: unknown): unknown };
	const rxjsModule = await import(`${pathToFileURL(rxjsArtifact.outputPath).href}?v=${Date.now()}`) as { echoAsync(value: unknown): Promise<unknown> };
	assert.deepEqual(zodModule.parseUser({ id: '1', name: 'Virune' }), { id: '1', name: 'Virune' });
	assert.equal(zodModule.parseUser({ id: 1 }), undefined);
	assert.equal(await rxjsModule.echoAsync('Virune'), 'Virune');
	for (const artifact of result.artifacts) {
		const abi = JSON.parse(await readFile(artifact.abiPath, 'utf8')) as { abiVersion: number; typescriptVersion: string; sourceHash: string; abiHash: string };
		assert.equal(abi.abiVersion, 1);
		assert.equal(abi.typescriptVersion, '6.0.3');
		assert.match(abi.sourceHash, /^[0-9a-f]{64}$/u);
		assert.match(abi.abiHash, /^[0-9a-f]{64}$/u);
	}
});
