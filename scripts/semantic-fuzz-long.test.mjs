import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deriveBatchSeed, runSemanticFuzzLong } from './semantic-fuzz-long.mjs';

test('derives deterministic distinct seeds for isolated batches', () => {
	assert.equal(deriveBatchSeed(123, 0), 123);
	assert.equal(deriveBatchSeed(123, 1), deriveBatchSeed(123, 1));
	assert.notEqual(deriveBatchSeed(123, 1), deriveBatchSeed(123, 2));
});

test('runs a bounded batch when no duration is configured', async () => {
	const calls = [];
	const summary = await runSemanticFuzzLong({
		batchIterations: 7,
		durationMs: 0,
		seed: 42,
		shard: 2,
		now: () => 100,
		runBatch: async input => {
			calls.push(input);
			return { status: 0, signal: null };
		},
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].iterations, 7);
	assert.equal(calls[0].seed, 42);
	assert.equal(summary.batches, 1);
	assert.equal(summary.iterations, 7);
});

test('records supervisor evidence when a child exits without a fuzz artifact', async t => {
	const artifactDirectory = await mkdtemp(join(tmpdir(), 'virune-semantic-supervisor-'));
	t.after(() => rm(artifactDirectory, { recursive: true, force: true }));
	await assert.rejects(runSemanticFuzzLong({
		artifactDirectory,
		batchIterations: 5,
		durationMs: 0,
		seed: 99,
		shard: 3,
		now: () => 100,
		runBatch: async () => ({ status: 1, signal: 'SIGABRT', error: 'child terminated' }),
	}), /batch 0 failed/u);
	const evidence = JSON.parse(await readFile(join(artifactDirectory, 'semantic-supervisor-shard-3-batch-0.json'), 'utf8'));
	assert.equal(evidence.seed, 99);
	assert.equal(evidence.signal, 'SIGABRT');
	assert.match(evidence.replayCommand, /VIRUNE_SEMANTIC_FUZZ_ITERATIONS=5/u);
});
