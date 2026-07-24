import assert from 'node:assert/strict';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { CachedTypeScriptInteropProvider } from '../packages/js-interop/dist/src/cached-provider.js';

if (typeof global.gc !== 'function') throw new Error('Run with --expose-gc');

const provider = new CachedTypeScriptInteropProvider({ projectRoot: process.cwd() });
const request = {
	containingFile: join(process.cwd(), 'src', 'main.virune'),
	moduleSpecifier: 'node:path',
	kind: 'named',
	importedName: 'join',
	platform: 'node',
};

provider.resolveImport(request);
for (let iteration = 0; iteration < 5_000; iteration++) provider.resolveImport(request);
global.gc();
const baseline = process.memoryUsage().heapUsed;
const startedAt = performance.now();

for (let batch = 0; batch < 20; batch++) {
	for (let iteration = 0; iteration < 5_000; iteration++) provider.resolveImport(request);
	global.gc();
}

const elapsedMs = performance.now() - startedAt;
const retained = process.memoryUsage().heapUsed;
const driftBytes = retained - baseline;
const driftLimitBytes = 32 * 1024 * 1024;

assert.equal(provider.cachedImportCount, 1);
assert.ok(driftBytes < driftLimitBytes, `Interop heap drift exceeded 32 MiB: ${driftBytes} bytes`);

provider.dispose();
global.gc();
const disposed = process.memoryUsage().heapUsed;
assert.equal(provider.cachedImportCount, 0);

const report = {
	iterations: 100_000,
	elapsedMs,
	baselineHeapBytes: baseline,
	retainedHeapBytes: retained,
	driftBytes,
	disposedHeapBytes: disposed,
	cacheEntriesBeforeDispose: 1,
	cacheEntriesAfterDispose: provider.cachedImportCount,
};
console.log(JSON.stringify(report, null, 2));
