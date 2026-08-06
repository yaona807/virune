import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
	createBootstrapShadowHistory,
	type BootstrapShadowHistoryEntryInputV1,
} from '../src/selfhost/bootstrap-shadow-history.js';
import {
	createBootstrapShadowReport,
	type BootstrapShadowStage,
} from '../src/selfhost/bootstrap-shadow-report.js';
import {
	normalizeBootstrapArtifact,
	type NormalizedBootstrapArtifactResult,
} from '../src/selfhost/bootstrap-artifact-normalizer.js';

const candidateSha = '1'.repeat(40);

test('passing shadow history produces deterministic candidate-bound promotion evidence', () => {
	const input = history([
		entry('run-1', '2026-07-30T01:00:00.000Z'),
		entry('run-2', '2026-07-30T12:00:00.000Z'),
		entry('run-3', '2026-07-31T01:00:00.000Z'),
		entry('run-4', '2026-08-01T01:00:00.000Z'),
	]);
	const first = createBootstrapShadowHistory(input);
	const second = createBootstrapShadowHistory(input);

	assert.equal(first.serialized, second.serialized);
	assert.equal(first.sha256, second.sha256);
	assert.equal(first.history.successfulRuns, 4);
	assert.equal(first.history.observationDays, 3);
	assert.equal(first.history.unexplainedDifferentials, 0);
	assert.equal(first.history.firstSuccessfulAt, '2026-07-30T01:00:00.000Z');
	assert.equal(first.history.latestCompletedAt, '2026-08-01T01:00:00.000Z');
	assert.deepEqual(first.observation.evidence, [{
		id: 'stage1-stage2',
		status: 'passed',
		candidateSha,
		source: `bootstrap-shadow-report:${input.entries[3]!.reportSha256}`,
		completedAt: '2026-08-01T01:00:00.000Z',
	}]);
});

test('trailing successful runs must bind one candidate compiler artifact identity', () => {
	assert.throws(
		() => createBootstrapShadowHistory(history([
			entry('run-1', '2026-07-31T01:00:00.000Z'),
			entry('run-2', '2026-08-01T01:00:00.000Z', {
				candidateCompilerVersion: '1.0.1-stage2',
			}),
		])),
		/successful streak must use compilerVersion 1\.0\.0-stage2/u,
	);
	assert.throws(
		() => createBootstrapShadowHistory(history([
			entry('run-1', '2026-07-31T01:00:00.000Z'),
			entry('run-2', '2026-08-01T01:00:00.000Z', {
				candidateArtifactSha256: 'f'.repeat(64),
			}),
		])),
		/successful streak must use candidate artifact/u,
	);
});

test('only the trailing passing streak contributes runs and distinct observation days', () => {
	const result = createBootstrapShadowHistory(history([
		entry('run-1', '2026-07-28T01:00:00.000Z'),
		entry('run-2', '2026-07-29T01:00:00.000Z', { mismatch: true }),
		entry('run-3', '2026-07-31T01:00:00.000Z'),
		entry('run-4', '2026-08-01T01:00:00.000Z'),
	]));

	assert.equal(result.history.successfulRuns, 2);
	assert.equal(result.history.observationDays, 2);
	assert.equal(result.history.firstSuccessfulAt, '2026-07-31T01:00:00.000Z');
	assert.equal(result.history.unexplainedDifferentials, 2);
	assert.equal(result.observation.evidence[0]?.status, 'failed');
});

test('a latest mismatch resets the trailing streak and remains explicit', () => {
	const result = createBootstrapShadowHistory(history([
		entry('run-1', '2026-07-31T01:00:00.000Z'),
		entry('run-2', '2026-08-01T01:00:00.000Z', { mismatch: true }),
	]));

	assert.equal(result.history.successfulRuns, 0);
	assert.equal(result.history.observationDays, 0);
	assert.equal(result.history.firstSuccessfulAt, null);
	assert.equal(result.observation.successfulRuns, 0);
	assert.equal(result.observation.evidence[0]?.status, 'failed');
});

test('shadow history validation fails closed on stale, duplicate, unordered, tampered, and invalid-stage input', () => {
	const first = entry('run-1', '2026-07-31T01:00:00.000Z');
	const second = entry('run-2', '2026-08-01T01:00:00.000Z');
	assert.throws(
		() => createBootstrapShadowHistory(history([first, { ...second, runId: first.runId }])),
		/duplicate runId/u,
	);
	assert.throws(
		() => createBootstrapShadowHistory(history([second, first])),
		/strictly ordered/u,
	);
	assert.throws(
		() => createBootstrapShadowHistory(history([{
			...first,
			candidateSha: '2'.repeat(40),
		}])),
		/expected 111111/u,
	);
	assert.throws(
		() => createBootstrapShadowHistory({
			...history([first]),
			candidateSha: 'A'.repeat(40),
		}),
		/lowercase 40- or 64-character hexadecimal SHA/u,
	);
	assert.throws(
		() => createBootstrapShadowHistory(history([{
			...first,
			reportSha256: '0'.repeat(64),
		}])),
		/reportSha256/u,
	);
	const tamperedReport = {
		...first.report,
		expectedChanges: first.report.expectedChanges.map(change => ({
			...change,
			before: JSON.stringify('stage0'),
		})),
	};
	assert.throws(
		() => createBootstrapShadowHistory(history([{
			...first,
			report: tamperedReport,
			reportSha256: sha256(JSON.stringify(tamperedReport)),
		}])),
		/canonical stage1 to stage2/u,
	);
	assert.throws(
		() => createBootstrapShadowHistory(history([
			entry('run-stage0', '2026-08-01T01:00:00.000Z', { baselineStage: 'stage0' }),
		])),
		/expected "stage1"/u,
	);
});

function history(entries: readonly BootstrapShadowHistoryEntryInputV1[]) {
	return {
		version: 1 as const,
		candidateSha,
		entries,
	};
}

function entry(
	runId: string,
	completedAt: string,
	options: {
		readonly mismatch?: boolean;
		readonly baselineStage?: BootstrapShadowStage;
		readonly candidateCompilerVersion?: string;
		readonly candidateArtifactSha256?: string;
	} = {},
): BootstrapShadowHistoryEntryInputV1 {
	const baselineStage = options.baselineStage ?? 'stage1';
	const generated = createBootstrapShadowReport({
		baseline: {
			label: 'stage-1',
			stage: baselineStage,
			compilerVersion: '1.0.0-stage1',
			artifact: artifact(baselineStage),
		},
		candidate: {
			label: 'stage-2',
			stage: 'stage2',
			compilerVersion: '1.0.0-stage2',
			artifact: artifact('stage2', options.mismatch === true),
		},
	});
	const report = options.candidateCompilerVersion === undefined && options.candidateArtifactSha256 === undefined
		? generated.report
		: {
			...generated.report,
			candidate: {
				...generated.report.candidate,
				compilerVersion: options.candidateCompilerVersion ?? generated.report.candidate.compilerVersion,
				artifactSha256: options.candidateArtifactSha256 ?? generated.report.candidate.artifactSha256,
			},
		};
	return {
		version: 1,
		runId,
		candidateSha,
		completedAt,
		report,
		reportSha256: sha256(JSON.stringify(report)),
	};
}

function artifact(stage: BootstrapShadowStage, mismatch = false): NormalizedBootstrapArtifactResult {
	return normalizeBootstrapArtifact({
		policyVersion: 1,
		root: '/repo',
		modules: [{
			path: '/repo/dist/main.js',
			code: mismatch ? 'export const value = 2;\n' : 'export const value = 1;\n',
			sourceMap: {
				version: 3,
				file: '/repo/dist/main.js',
				sources: ['/repo/src/main.virune'],
				names: [],
				mappings: '',
			},
			exports: ['value'],
		}],
		diagnosticsSchema: { type: 'object', required: ['code', 'severity'] },
		metadata: {
			stage,
			compilerVersion: '1.0.0',
			languageVersion: '1.0',
			runtimeAbi: '1',
			interopAbi: '1',
		},
		checksumManifest: [{
			path: '/repo/dist/main.js',
			sha256: (mismatch ? 'b' : 'a').repeat(64),
		}],
	});
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
