import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createBootstrapShadowReport,
	type BootstrapShadowStage,
} from '../src/selfhost/bootstrap-shadow-report.js';
import {
	normalizeBootstrapArtifact,
	type NormalizedBootstrapArtifactResult,
} from '../src/selfhost/bootstrap-artifact-normalizer.js';

function artifact(
	stage: BootstrapShadowStage,
	options: { readonly code?: string; readonly checksum?: string; readonly runtimeAbi?: string } = {},
): NormalizedBootstrapArtifactResult {
	return normalizeBootstrapArtifact({
		policyVersion: 1,
		root: '/repo',
		modules: [{
			path: '/repo/dist/main.js',
			code: options.code ?? 'export const value = 1;\n',
			sourceMap: {
				version: 3,
				file: '/repo/dist/main.js',
				sources: ['/repo/src/main.virune'],
				names: [],
				mappings: '',
			},
			exports: ['value'],
		}],
		diagnosticsSchema: {
			type: 'object',
			required: ['code', 'severity'],
		},
		metadata: {
			stage,
			compilerVersion: '1.0.0',
			languageVersion: '1.0',
			runtimeAbi: options.runtimeAbi ?? '1',
			interopAbi: '1',
		},
		checksumManifest: [{
			path: '/repo/dist/main.js',
			sha256: options.checksum ?? 'a'.repeat(64),
		}],
	});
}

test('stage-only shadow differences are explicit and otherwise equivalent', () => {
	const first = createBootstrapShadowReport({
		baseline: {
			label: 'stage-1',
			stage: 'stage1',
			compilerVersion: '1.0.0-stage1',
			artifact: artifact('stage1'),
		},
		candidate: {
			label: 'stage-2',
			stage: 'stage2',
			compilerVersion: '1.0.0-stage2',
			artifact: artifact('stage2'),
		},
	});
	const second = createBootstrapShadowReport({
		baseline: {
			label: 'stage-1',
			stage: 'stage1',
			compilerVersion: '1.0.0-stage1',
			artifact: artifact('stage1'),
		},
		candidate: {
			label: 'stage-2',
			stage: 'stage2',
			compilerVersion: '1.0.0-stage2',
			artifact: artifact('stage2'),
		},
	});

	assert.equal(first.serialized, second.serialized);
	assert.equal(first.sha256, second.sha256);
	assert.equal(first.report.status, 'equivalent');
	assert.equal(first.report.rawArtifactEqual, false);
	assert.deepEqual(first.report.expectedDifferencePaths, ['metadata.stage']);
	assert.deepEqual(first.report.expectedChanges.map(change => change.path), ['metadata.stage']);
	assert.deepEqual(first.report.unexpectedChanges, []);
	assert.deepEqual(first.report.unexpectedSections, []);
	assert.equal(first.report.blocking, false);
});

test('meaningful artifact differences remain visible and fail shadow equivalence', () => {
	const report = createBootstrapShadowReport({
		baseline: {
			label: 'stage-1',
			stage: 'stage1',
			compilerVersion: '1.0.0-stage1',
			artifact: artifact('stage1'),
		},
		candidate: {
			label: 'stage-2',
			stage: 'stage2',
			compilerVersion: '1.0.0-stage2',
			artifact: artifact('stage2', {
				code: 'export const value = 2;\n',
				checksum: 'b'.repeat(64),
				runtimeAbi: '2',
			}),
		},
	});

	assert.equal(report.report.status, 'mismatch');
	assert.deepEqual(report.report.expectedChanges.map(change => change.path), ['metadata.stage']);
	assert.deepEqual(report.report.unexpectedSections, [
		{ section: 'checksumManifest', count: 1 },
		{ section: 'metadata', count: 1 },
		{ section: 'modules', count: 1 },
	]);
	assert.deepEqual(
		report.report.unexpectedChanges.map(change => change.path),
		['checksumManifest[0].sha256', 'metadata.runtimeAbi', 'modules[0].code'],
	);
});

test('declared stage claims must match artifact metadata', () => {
	const report = createBootstrapShadowReport({
		baseline: {
			label: 'claimed-stage-1',
			stage: 'stage1',
			compilerVersion: '1.0.0-stage1',
			artifact: artifact('stage0'),
		},
		candidate: {
			label: 'stage-2',
			stage: 'stage2',
			compilerVersion: '1.0.0-stage2',
			artifact: artifact('stage2'),
		},
	});

	assert.equal(report.report.status, 'mismatch');
	assert.deepEqual(report.report.expectedChanges, []);
	assert.deepEqual(report.report.unexpectedSections, [{ section: 'metadata', count: 1 }]);
	assert.deepEqual(report.report.unexpectedChanges.map(change => change.path), ['metadata.stage']);
});

test('shadow subjects and artifact integrity are validated fail-closed', () => {
	const baseline = artifact('stage1');
	const candidate = artifact('stage2');
	assert.throws(
		() => createBootstrapShadowReport({
			baseline: { label: 'same', stage: 'stage1', compilerVersion: '1', artifact: baseline },
			candidate: { label: 'same', stage: 'stage2', compilerVersion: '2', artifact: candidate },
		}),
		/labels must be distinct/u,
	);

	const tampered = { ...candidate, sha256: '0'.repeat(64) };
	assert.throws(
		() => createBootstrapShadowReport({
			baseline: { label: 'stage-1', stage: 'stage1', compilerVersion: '1', artifact: baseline },
			candidate: { label: 'stage-2', stage: 'stage2', compilerVersion: '2', artifact: tampered },
		}),
		/sha256 does not match serialized content/u,
	);
});
