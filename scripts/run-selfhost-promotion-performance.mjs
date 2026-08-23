import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROMOTION_PERFORMANCE_SCHEMA_VERSION = 1;
export const DEFAULT_PROMOTION_PERFORMANCE_OUTPUT = '.cache/selfhost-promotion-observation/performance.json';
export const PROMOTION_PERFORMANCE_BUDGET = Object.freeze({
	coldBuildRatio: 1.25,
	editedRebuildRatio: 1.25,
	peakRssRatio: 1.5,
	artifactSizeRatio: 1.25,
	majorFixtureLatencyRatio: 1.5,
});
const DEFAULT_SAMPLES = 5;
const root = fileURLToPath(new URL('..', import.meta.url));
const corpusPath = resolve(root, '.github/self-hosting/differential-corpus-v1.json');
const selfhostModulePath = resolve(root, 'selfhost/mvp/dist/main.js');

export async function runSelfhostPromotionPerformance({
	repositoryRoot = root,
	output = DEFAULT_PROMOTION_PERFORMANCE_OUTPUT,
	samples = DEFAULT_SAMPLES,
	runSample = executeWorkerSample,
} = {}) {
	const corpus = JSON.parse(await readFile(resolve(repositoryRoot, '.github/self-hosting/differential-corpus-v1.json'), 'utf8'));
	const fixtureIds = selectProjectFixtures(corpus);
	const records = [];
	for (const fixtureId of fixtureIds) {
		const implementations = {};
		for (const implementation of ['legacy', 'selfhost']) {
			const values = [];
			for (let sample = 0; sample < samples; sample += 1) values.push(await runSample({ repositoryRoot, implementation, fixtureId }));
			implementations[implementation] = summarizeSamples(values);
		}
		const ratios = compareSummaries(implementations.legacy, implementations.selfhost);
		records.push({ fixtureId, implementations, ratios, majorRegression: majorLatencyRegression(implementations.legacy, implementations.selfhost) });
	}
	const legacyAggregate = summarizeFixtureMedians(records, 'legacy');
	const selfhostAggregate = summarizeFixtureMedians(records, 'selfhost');
	const aggregateRatios = compareSummaries(legacyAggregate, selfhostAggregate);
	const passed = summariesWithinBudget(legacyAggregate, selfhostAggregate)
		&& records.every(record => !record.majorRegression);
	const report = {
		schemaVersion: PROMOTION_PERFORMANCE_SCHEMA_VERSION,
		claim: 'required-selfhost-relative-performance',
		productionEligible: false,
		incrementalCacheClaim: false,
		editedRebuildProxy: true,
		budget: PROMOTION_PERFORMANCE_BUDGET,
		fixtureIds,
		samplesPerImplementation: samples,
		fixtures: records,
		aggregate: { legacy: legacyAggregate, selfhost: selfhostAggregate, ratios: aggregateRatios },
		status: passed ? 'passed' : 'failed',
	};
	const serialized = JSON.stringify(report);
	const target = resolve(repositoryRoot, output);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, serialized, 'utf8');
	if (!passed) process.exitCode = 1;
	return { report, serialized, evidenceSha256: sha256(serialized) };
}

export function evaluatePromotionPerformanceSamples(fixtures) {
	if (!Array.isArray(fixtures) || fixtures.length === 0) throw new Error('fixtures must contain at least one performance fixture');
	const records = fixtures.map(item => {
		const legacy = summarizeSamples(item.legacy);
		const selfhost = summarizeSamples(item.selfhost);
		const ratios = compareSummaries(legacy, selfhost);
		return { fixtureId: item.fixtureId, implementations: { legacy, selfhost }, ratios, majorRegression: majorLatencyRegression(legacy, selfhost) };
	});
	const legacyAggregate = summarizeFixtureMedians(records, 'legacy');
	const selfhostAggregate = summarizeFixtureMedians(records, 'selfhost');
	const ratios = compareSummaries(legacyAggregate, selfhostAggregate);
	return {
		records,
		legacyAggregate,
		selfhostAggregate,
		ratios,
		passed: summariesWithinBudget(legacyAggregate, selfhostAggregate)
			&& records.every(record => !record.majorRegression),
	};
}

function selectProjectFixtures(corpus) {
	if (corpus?.schemaVersion !== 1 || !Array.isArray(corpus.fixtures)) throw new Error('differential corpus schema is invalid');
	const ids = corpus.fixtures
		.filter(fixture => Array.isArray(fixture.tags) && fixture.tags.includes('project') && (fixture.expectedDivergences ?? []).length === 0)
		.map(fixture => fixture.id)
		.sort();
	if (ids.length === 0) throw new Error('no non-divergent project differential fixtures are available for performance evidence');
	return ids;
}

function summarizeSamples(samples) {
	if (!Array.isArray(samples) || samples.length === 0) throw new Error('performance samples are empty');
	for (const sample of samples) validateSample(sample);
	return {
		coldBuildMs: median(samples.map(value => value.coldBuildMs)),
		editedRebuildMs: median(samples.map(value => value.editedRebuildMs)),
		peakRssKb: median(samples.map(value => value.peakRssKb)),
		artifactSizeBytes: median(samples.map(value => value.artifactSizeBytes)),
	};
}

function summarizeFixtureMedians(records, implementation) {
	return {
		coldBuildMs: median(records.map(record => record.implementations[implementation].coldBuildMs)),
		editedRebuildMs: median(records.map(record => record.implementations[implementation].editedRebuildMs)),
		peakRssKb: median(records.map(record => record.implementations[implementation].peakRssKb)),
		artifactSizeBytes: median(records.map(record => record.implementations[implementation].artifactSizeBytes)),
	};
}

function compareSummaries(legacy, selfhost) {
	return {
		coldBuild: ratio(selfhost.coldBuildMs, legacy.coldBuildMs, 'cold build'),
		editedRebuild: ratio(selfhost.editedRebuildMs, legacy.editedRebuildMs, 'edited rebuild'),
		peakRss: ratio(selfhost.peakRssKb, legacy.peakRssKb, 'peak RSS'),
		artifactSize: ratio(selfhost.artifactSizeBytes, legacy.artifactSizeBytes, 'artifact size'),
	};
}

function summariesWithinBudget(legacy, selfhost) {
	return withinRatio(selfhost.coldBuildMs, legacy.coldBuildMs, PROMOTION_PERFORMANCE_BUDGET.coldBuildRatio)
		&& withinRatio(selfhost.editedRebuildMs, legacy.editedRebuildMs, PROMOTION_PERFORMANCE_BUDGET.editedRebuildRatio)
		&& withinRatio(selfhost.peakRssKb, legacy.peakRssKb, PROMOTION_PERFORMANCE_BUDGET.peakRssRatio)
		&& withinRatio(selfhost.artifactSizeBytes, legacy.artifactSizeBytes, PROMOTION_PERFORMANCE_BUDGET.artifactSizeRatio);
}

function majorLatencyRegression(legacy, selfhost) {
	return !withinRatio(selfhost.coldBuildMs, legacy.coldBuildMs, PROMOTION_PERFORMANCE_BUDGET.majorFixtureLatencyRatio)
		|| !withinRatio(selfhost.editedRebuildMs, legacy.editedRebuildMs, PROMOTION_PERFORMANCE_BUDGET.majorFixtureLatencyRatio);
}

function withinRatio(numerator, denominator, limit) {
	if (!(denominator > 0)) throw new Error('Legacy performance baseline must be positive');
	return numerator <= denominator * limit;
}

function validateSample(value) {
	for (const key of ['coldBuildMs', 'editedRebuildMs', 'peakRssKb', 'artifactSizeBytes']) {
		if (typeof value?.[key] !== 'number' || !Number.isFinite(value[key]) || value[key] <= 0) throw new Error(`invalid performance sample ${key}`);
	}
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratio(numerator, denominator, label) {
	if (!(denominator > 0)) throw new Error(`${label} Legacy baseline must be positive`);
	return Number((numerator / denominator).toFixed(6));
}

async function executeWorkerSample({ repositoryRoot, implementation, fixtureId }) {
	const result = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), `--worker=${implementation}`, `--fixture=${fixtureId}`], {
		cwd: repositoryRoot,
		env: process.env,
		encoding: 'utf8',
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.error !== undefined || result.status !== 0) throw new Error(`performance worker ${implementation}/${fixtureId} failed: ${(result.stderr || result.error?.message || result.stdout).trim()}`);
	const text = result.stdout.trim();
	let value;
	try { value = JSON.parse(text); }
	catch { throw new Error(`performance worker ${implementation}/${fixtureId} emitted invalid JSON`); }
	validateSample(value);
	return value;
}

async function runWorker(implementation, fixtureId) {
	if (implementation !== 'legacy' && implementation !== 'selfhost') throw new Error('worker implementation must be legacy or selfhost');
	const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
	const fixture = corpus.fixtures?.find(item => item.id === fixtureId);
	if (fixture === undefined) throw new Error(`unknown performance fixture ${fixtureId}`);
	const { validateKernelInput } = await import('../packages/compiler/dist/src/selfhost/contract.js');
	const input = validateKernelInput(fixture.input);
	let compile;
	if (implementation === 'legacy') {
		({ compileWithLegacyKernel: compile } = await import('../packages/compiler/dist/src/selfhost/legacy-adapter.js'));
	} else {
		const [{ compileWithSelfhostProject }, module] = await Promise.all([
			import('../packages/compiler/dist/src/selfhost/project-differential-adapter.js'),
			import(pathToFileURL(selfhostModulePath).href),
		]);
		compile = value => compileWithSelfhostProject(module, value);
	}
	globalThis.gc?.();
	const coldStart = performance.now();
	const cold = await compile(input);
	const coldBuildMs = performance.now() - coldStart;
	const editedInput = validateKernelInput({ ...input, sources: input.sources.map((source, index) => index === 0 ? { ...source, text: `${source.text}\n` } : source) });
	globalThis.gc?.();
	const rebuildStart = performance.now();
	const rebuilt = await compile(editedInput);
	const editedRebuildMs = performance.now() - rebuildStart;
	const artifactSizeBytes = Buffer.byteLength(JSON.stringify(rebuilt.emittedModules), 'utf8');
	const peakRssKb = process.resourceUsage().maxRSS;
	return { coldBuildMs, editedRebuildMs, peakRssKb, artifactSizeBytes };
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function parseArguments(argumentsList) {
	const result = {};
	for (const argument of argumentsList) {
		if (argument.startsWith('--worker=')) result.worker = argument.slice('--worker='.length);
		else if (argument.startsWith('--fixture=')) result.fixture = argument.slice('--fixture='.length);
		else if (argument.startsWith('--output=')) result.output = argument.slice('--output='.length);
		else if (argument.startsWith('--samples=')) result.samples = Number(argument.slice('--samples='.length));
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const options = parseArguments(process.argv.slice(2));
	if (options.worker !== undefined) {
		if (typeof options.fixture !== 'string' || options.fixture.length === 0) throw new Error('--fixture is required in worker mode');
		console.log(JSON.stringify(await runWorker(options.worker, options.fixture)));
	} else {
		const result = await runSelfhostPromotionPerformance({
			...(options.output === undefined ? {} : { output: options.output }),
			...(options.samples === undefined ? {} : { samples: options.samples }),
		});
		console.log(JSON.stringify({ status: result.report.status, evidenceSha256: result.evidenceSha256 }));
	}
}
