import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { evaluatePromotionPerformanceSamples, PROMOTION_PERFORMANCE_BUDGET, runSelfhostPromotionPerformance } from './run-selfhost-promotion-performance.mjs';

function sample(coldBuildMs, editedRebuildMs, peakRssKb, artifactSizeBytes) {
	return { coldBuildMs, editedRebuildMs, peakRssKb, artifactSizeBytes };
}

function fixture(id, legacy, selfhost) { return { fixtureId: id, legacy, selfhost }; }

test('passes recorded aggregate numeric budgets inside the explicitly measured Gate D ratios', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(100, 80, 1000, 1000), sample(102, 82, 1010, 1000), sample(98, 78, 990, 1000)], [sample(120, 96, 1400, 1200), sample(121, 97, 1410, 1200), sample(119, 95, 1390, 1200)]),
		fixture('b', [sample(110, 90, 1100, 1100), sample(112, 92, 1110, 1100), sample(108, 88, 1090, 1100)], [sample(132, 108, 1500, 1320), sample(133, 109, 1510, 1320), sample(131, 107, 1490, 1320)]),
	]);
	assert.equal(result.passed, true);
	assert.ok(result.ratios.coldBuild <= PROMOTION_PERFORMANCE_BUDGET.coldBuildRatio);
	assert.equal('editedRebuildRatio' in PROMOTION_PERFORMANCE_BUDGET, false);
	assert.equal('majorFixtureLatencyRatio' in PROMOTION_PERFORMANCE_BUDGET, false);
	assert.ok(result.records.every(record => !('majorRegression' in record)));
});

test('canonical runner measures the complete project corpus but fails closed without real incremental evidence', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-performance-'));
	try {
		await mkdir(join(root, '.github', 'self-hosting'), { recursive: true });
		const fixtures = Array.from({ length: 7 }, (_, index) => ({ id: `project-${index + 1}`, tags: ['project'], expectedDivergences: [] }));
		fixtures.push({ id: 'project-diagnostic', tags: ['project', 'diagnostic'], expectedDivergences: [] });
		fixtures.push({ id: 'not-project', tags: ['smoke'], expectedDivergences: [] });
		fixtures.push({ id: 'expected-divergence', tags: ['project'], expectedDivergences: ['known'] });
		await writeFile(join(root, '.github', 'self-hosting', 'differential-corpus-v1.json'), JSON.stringify({ schemaVersion: 1, fixtures }), 'utf8');
		const result = await runSelfhostPromotionPerformance({
			repositoryRoot: root,
			output: 'performance.json',
			samples: 1,
			runSample: async ({ implementation }) => implementation === 'legacy'
				? sample(100, 100, 1000, 1000)
				: sample(110, 110, 1100, 1100),
		});
		const expected = fixtures
			.filter(item => item.tags.includes('project') && item.expectedDivergences.length === 0)
			.map(item => item.id)
			.sort();
		assert.deepEqual(result.report.fixtureIds, expected);
		assert.equal(result.report.fixtures.length, expected.length);
		assert.ok(result.report.fixtureIds.includes('project-diagnostic'));
		assert.equal(result.report.incrementalCacheClaim, false);
		assert.equal(result.report.editedRebuildProxy, true);
		assert.equal(result.report.status, 'failed');
		assert.equal('editedRebuildRatio' in result.report.budget, false);
		assert.equal('majorFixtureLatencyRatio' in result.report.budget, false);
		assert.ok(result.report.fixtures.every(record => !('majorRegression' in record)));
	} finally {
		process.exitCode = 0;
		await rm(root, { recursive: true, force: true });
	}
});

test('canonical runner rejects malformed corpus metadata instead of silently narrowing performance scope', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-performance-malformed-'));
	try {
		await mkdir(join(root, '.github', 'self-hosting'), { recursive: true });
		const base = { id: 'project-1', tags: ['project'], expectedDivergences: [] };
		for (const malformed of [
			{ ...base, tags: 'project' },
			{ ...base, expectedDivergences: '' },
			{ ...base, id: ' ' },
		]) {
			await writeFile(join(root, '.github', 'self-hosting', 'differential-corpus-v1.json'), JSON.stringify({ schemaVersion: 1, fixtures: [malformed] }), 'utf8');
			await assert.rejects(
				() => runSelfhostPromotionPerformance({ repositoryRoot: root, output: 'performance.json', samples: 1, runSample: async () => sample(100, 100, 1000, 1000) }),
				/differential corpus fixture/u,
			);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('fails when aggregate cold build exceeds its explicit 1.25x budget', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(100, 100, 1000, 1000)], [sample(130, 100, 1000, 1000)]),
	]);
	assert.equal(result.passed, false);
	assert.ok(result.ratios.coldBuild > 1.25);
});

test('does not round a just-over-budget ratio down to a pass', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(10_000_000, 10_000_000, 1000, 1000)], [sample(12_500_001, 10_000_000, 1000, 1000)]),
	]);
	assert.equal(result.ratios.coldBuild, 1.25);
	assert.equal(result.passed, false);
});

test('retains edited rebuild as raw diagnostic evidence without applying the incremental threshold to the proxy', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(100, 100, 1000, 1000)], [sample(100, 160, 1000, 1000)]),
	]);
	assert.equal(result.passed, true);
	assert.equal(result.records[0].ratios.editedRebuild, 1.6);
	assert.equal('editedRebuildRatio' in PROMOTION_PERFORMANCE_BUDGET, false);
});

test('retains individual fixture ratios without inventing a severe-regression threshold', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(100, 100, 1000, 1000)], [sample(160, 160, 1000, 1000)]),
		fixture('b', [sample(100, 100, 1000, 1000)], [sample(100, 100, 1000, 1000)]),
		fixture('c', [sample(100, 100, 1000, 1000)], [sample(100, 100, 1000, 1000)]),
	]);
	assert.equal(result.passed, true);
	assert.equal(result.records[0].ratios.coldBuild, 1.6);
	assert.equal(result.records[0].ratios.editedRebuild, 1.6);
	assert.equal('majorRegression' in result.records[0], false);
	assert.equal('majorFixtureLatencyRatio' in PROMOTION_PERFORMANCE_BUDGET, false);
});

test('fails peak RSS and artifact-size budget violations independently', () => {
	const rss = evaluatePromotionPerformanceSamples([fixture('a', [sample(100, 100, 1000, 1000)], [sample(100, 100, 1600, 1000)])]);
	assert.equal(rss.passed, false);
	assert.ok(rss.ratios.peakRss > 1.5);
	const artifact = evaluatePromotionPerformanceSamples([fixture('a', [sample(100, 100, 1000, 1000)], [sample(100, 100, 1000, 1300)])]);
	assert.equal(artifact.passed, false);
	assert.ok(artifact.ratios.artifactSize > 1.25);
});

test('rejects missing or non-positive measurement evidence', () => {
	assert.throws(() => evaluatePromotionPerformanceSamples([]), /at least one performance fixture/u);
	assert.throws(() => evaluatePromotionPerformanceSamples([fixture('a', [sample(0, 1, 1, 1)], [sample(1, 1, 1, 1)])]), /invalid performance sample coldBuildMs/u);
});
