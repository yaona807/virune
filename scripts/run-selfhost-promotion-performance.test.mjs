import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePromotionPerformanceSamples, PROMOTION_PERFORMANCE_BUDGET } from './run-selfhost-promotion-performance.mjs';

function sample(coldBuildMs, editedRebuildMs, peakRssKb, artifactSizeBytes) {
	return { coldBuildMs, editedRebuildMs, peakRssKb, artifactSizeBytes };
}

function fixture(id, legacy, selfhost) { return { fixtureId: id, legacy, selfhost }; }

test('passes ratios inside Gate D aggregate and per-fixture budgets', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(100, 80, 1000, 1000), sample(102, 82, 1010, 1000), sample(98, 78, 990, 1000)], [sample(120, 96, 1400, 1200), sample(121, 97, 1410, 1200), sample(119, 95, 1390, 1200)]),
		fixture('b', [sample(110, 90, 1100, 1100), sample(112, 92, 1110, 1100), sample(108, 88, 1090, 1100)], [sample(132, 108, 1500, 1320), sample(133, 109, 1510, 1320), sample(131, 107, 1490, 1320)]),
	]);
	assert.equal(result.passed, true);
	assert.ok(result.ratios.coldBuild <= PROMOTION_PERFORMANCE_BUDGET.coldBuildRatio);
	assert.ok(result.records.every(record => record.majorRegression === false));
});

test('fails when aggregate cold or edited rebuild exceeds 1.25x', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(100, 100, 1000, 1000)], [sample(130, 126, 1000, 1000)]),
	]);
	assert.equal(result.passed, false);
	assert.ok(result.ratios.coldBuild > 1.25 || result.ratios.editedRebuild > 1.25);
});

test('does not round a just-over-budget ratio down to a pass', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(10_000_000, 10_000_000, 1000, 1000)], [sample(12_500_001, 10_000_000, 1000, 1000)]),
	]);
	assert.equal(result.ratios.coldBuild, 1.25);
	assert.equal(result.passed, false);
});

test('does not round a just-over-major-fixture ratio down to non-regression', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(10_000_000, 10_000_000, 1000, 1000)], [sample(15_000_001, 10_000_000, 1000, 1000)]),
	]);
	assert.equal(result.records[0].ratios.coldBuild, 1.5);
	assert.equal(result.records[0].majorRegression, true);
});

test('fails a major single-fixture latency regression even if another fixture masks the aggregate median', () => {
	const result = evaluatePromotionPerformanceSamples([
		fixture('a', [sample(100, 100, 1000, 1000)], [sample(160, 160, 1000, 1000)]),
		fixture('b', [sample(100, 100, 1000, 1000)], [sample(100, 100, 1000, 1000)]),
		fixture('c', [sample(100, 100, 1000, 1000)], [sample(100, 100, 1000, 1000)]),
	]);
	assert.equal(result.passed, false);
	assert.equal(result.records[0].majorRegression, true);
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
