import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(import.meta.dirname, '..');
const semanticFuzzScript = resolve(import.meta.dirname, 'semantic-fuzz.mjs');
const defaultArtifactDirectory = resolve(repositoryRoot, 'fuzz-regressions/semantic-artifacts');
const GOLDEN_RATIO_32 = 0x9e3779b1;

export function deriveBatchSeed(baseSeed, batch) {
	return (baseSeed + Math.imul(batch, GOLDEN_RATIO_32)) >>> 0;
}

export async function runSemanticFuzzLong(options = {}) {
	const shard = nonNegativeInteger(options.shard ?? process.env.VIRUNE_SEMANTIC_FUZZ_SHARD, 0, 'shard');
	const durationMs = nonNegativeInteger(options.durationMs ?? process.env.VIRUNE_SEMANTIC_FUZZ_DURATION_MS, 0, 'durationMs');
	const batchIterations = positiveInteger(options.batchIterations ?? process.env.VIRUNE_SEMANTIC_FUZZ_BATCH_ITERATIONS, 25, 'batchIterations');
	const baseSeed = nonNegativeInteger(
		options.seed ?? process.env.VIRUNE_SEMANTIC_FUZZ_SEED,
		0x53_45_4d_41 + Math.imul(shard, GOLDEN_RATIO_32),
		'seed',
	) >>> 0;
	const artifactDirectory = resolve(options.artifactDirectory ?? process.env.VIRUNE_SEMANTIC_FUZZ_ARTIFACT_DIR ?? defaultArtifactDirectory);
	const now = options.now ?? Date.now;
	const runBatch = options.runBatch ?? runChildBatch;
	const startedAt = now();
	let batches = 0;
	let iterations = 0;

	do {
		const seed = deriveBatchSeed(baseSeed, batches);
		const result = await runBatch({
			artifactDirectory,
			batch: batches,
			iterations: batchIterations,
			seed,
			shard,
		});
		if (result.status !== 0) {
			const evidence = persistSupervisorFailure({
				artifactDirectory,
				baseSeed,
				batch: batches,
				batchIterations,
				result,
				seed,
				shard,
			});
			throw new Error(`Semantic fuzz batch ${batches} failed; evidence=${evidence}`);
		}
		batches++;
		iterations += batchIterations;
	} while (durationMs > 0 && now() - startedAt < durationMs);

	const summary = {
		schemaVersion: 1,
		baseSeed,
		shard,
		batches,
		iterations,
		durationMs: now() - startedAt,
		batchIterations,
	};
	console.log(JSON.stringify(summary));
	return summary;
}

function runChildBatch({ artifactDirectory, batch, iterations, seed, shard }) {
	console.log(`[semantic-fuzz] shard=${shard} batch=${batch} seed=${seed} iterations=${iterations}`);
	const result = spawnSync(process.execPath, [semanticFuzzScript], {
		cwd: repositoryRoot,
		env: {
			...process.env,
			VIRUNE_SEMANTIC_FUZZ_ARTIFACT_DIR: artifactDirectory,
			VIRUNE_SEMANTIC_FUZZ_DURATION_MS: '0',
			VIRUNE_SEMANTIC_FUZZ_ITERATIONS: String(iterations),
			VIRUNE_SEMANTIC_FUZZ_SEED: String(seed),
			VIRUNE_SEMANTIC_FUZZ_SHARD: String(shard),
		},
		stdio: 'inherit',
	});
	return {
		status: result.status ?? 1,
		signal: result.signal ?? null,
		...(result.error === undefined ? {} : { error: result.error.message }),
	};
}

function persistSupervisorFailure({ artifactDirectory, baseSeed, batch, batchIterations, result, seed, shard }) {
	mkdirSync(artifactDirectory, { recursive: true });
	const path = resolve(artifactDirectory, `semantic-supervisor-shard-${shard}-batch-${batch}.json`);
	writeFileSync(path, `${JSON.stringify({
		schemaVersion: 1,
		baseSeed,
		seed,
		shard,
		batch,
		batchIterations,
		status: result.status,
		signal: result.signal ?? null,
		error: result.error ?? null,
		replayCommand: `VIRUNE_SEMANTIC_FUZZ_SEED=${seed} VIRUNE_SEMANTIC_FUZZ_SHARD=${shard} VIRUNE_SEMANTIC_FUZZ_ITERATIONS=${batchIterations} npm run test:semantic-fuzz:smoke`,
	}, null, '\t')}\n`, 'utf8');
	return path;
}

function nonNegativeInteger(value, fallback, name) {
	if (value === undefined) return fallback;
	const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
	return parsed;
}

function positiveInteger(value, fallback, name) {
	const parsed = nonNegativeInteger(value, fallback, name);
	if (parsed === 0) throw new Error(`${name} must be greater than zero`);
	return parsed;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await runSemanticFuzzLong();
