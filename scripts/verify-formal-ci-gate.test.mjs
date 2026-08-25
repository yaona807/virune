import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { verifyCiGate, verifyOptionalFormalGate } from './verify-formal-ci-gate.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const badResults = ['failure', 'cancelled', 'skipped', 'neutral', 'partial', 'stale', 'timed_out', 'unknown', ''];
const providerTerminalContexts = Object.freeze([
	['.github/workflows/ci.yml', 'Required CI gate'],
	['.github/workflows/selfhost-clean-bootstrap.yml', 'Required self-host gate'],
	['.github/workflows/browser-conformance.yml', 'Required browser conformance gate'],
	['.github/workflows/performance.yml', 'Required performance gate'],
	['.github/workflows/selfhost-fixed-seed.yml', 'Required fixed Seed gate'],
	['.github/workflows/typescript-7-prototype.yml', 'Required TypeScript 7 gate'],
	['.github/workflows/vsix-smoke.yml', 'Required VSIX gate'],
]);

function requiredCiResults() {
	return {
		metadata: 'success',
		build: 'success',
		verify: 'success',
		selfhostInventory: 'success',
		quality: 'success',
		semanticFuzz: 'success',
		compatibility: 'success',
		browser: 'success',
		releaseArtifacts: 'success',
	};
}

function docsOnlyResults() {
	return {
		metadata: 'success',
		build: 'skipped',
		verify: 'skipped',
		selfhostInventory: 'skipped',
		quality: 'skipped',
		semanticFuzz: 'skipped',
		compatibility: 'skipped',
		browser: 'skipped',
		releaseArtifacts: 'skipped',
	};
}

test('provider terminal context names are unique, stable, and always evaluated', async () => {
	for (const [path, context] of providerTerminalContexts) {
		const source = await readFile(resolve(repositoryRoot, path), 'utf8');
		const marker = `name: ${context}`;
		const first = source.indexOf(marker);
		assert.notEqual(first, -1, `${path}: missing ${context}`);
		assert.equal(source.indexOf(marker, first + marker.length), -1, `${path}: duplicate ${context}`);
		assert.match(source.slice(first, first + 500), /\n    if: always\(\)/u, `${path}: ${context} must use if: always()`);
	}
});

test('optional formal gate accepts required success', () => {
	assert.equal(verifyOptionalFormalGate({
		label: 'performance',
		required: 'true',
		classifyResult: 'success',
		upstreamResult: 'success',
	}), 'required-success');
});

test('optional formal gate accepts only an explicit skipped not-required lane', () => {
	assert.equal(verifyOptionalFormalGate({
		label: 'performance',
		required: 'false',
		classifyResult: 'success',
		upstreamResult: 'skipped',
	}), 'not-required');
	for (const upstreamResult of ['success', 'failure', 'cancelled', 'partial', 'stale', 'timed_out', 'unknown', '']) {
		assert.throws(() => verifyOptionalFormalGate({
			label: 'performance',
			required: 'false',
			classifyResult: 'success',
			upstreamResult,
		}), /Not-required performance validation concluded with unexpected result/u, upstreamResult || '<missing>');
	}
});

test('optional required lane rejects skipped, failed, cancelled, neutral, partial, stale, timed-out, unknown, and missing results', () => {
	for (const upstreamResult of badResults) {
		assert.throws(() => verifyOptionalFormalGate({
			label: 'fixed Seed',
			required: 'true',
			classifyResult: 'success',
			upstreamResult,
		}), /Required fixed Seed validation concluded with/u, upstreamResult || '<missing>');
	}
});

test('optional gate rejects invalid or unsuccessful classification', () => {
	for (const classifyResult of ['failure', 'cancelled', 'skipped', 'partial', 'stale', 'timed_out', 'unknown', '']) {
		assert.throws(() => verifyOptionalFormalGate({
			label: 'VSIX',
			required: 'false',
			classifyResult,
			upstreamResult: 'skipped',
		}), /VSIX classification concluded with/u, classifyResult || '<missing>');
	}
	for (const required of ['unknown', '1', '']) {
		assert.throws(() => verifyOptionalFormalGate({
			label: 'VSIX',
			required,
			classifyResult: 'success',
			upstreamResult: 'skipped',
		}), /Invalid formal_required output/u, required || '<missing>');
	}
});

test('CI gate accepts complete pull-request evidence', () => {
	assert.equal(verifyCiGate({
		eventName: 'pull_request',
		docsOnly: 'false',
		classifyResult: 'success',
		results: requiredCiResults(),
	}), 'required-success');
});

test('CI gate accepts reviewed documentation-only omission only when every heavy lane is skipped', () => {
	assert.equal(verifyCiGate({
		eventName: 'pull_request',
		docsOnly: 'true',
		classifyResult: 'success',
		results: docsOnlyResults(),
	}), 'docs-only');
	for (const key of Object.keys(docsOnlyResults()).filter(key => key !== 'metadata')) {
		const results = docsOnlyResults();
		results[key] = 'success';
		assert.throws(() => verifyCiGate({
			eventName: 'pull_request',
			docsOnly: 'true',
			classifyResult: 'success',
			results,
		}), /Documentation-only CI expected/u, key);
	}
});

test('CI gate rejects every non-success result for required pull-request lanes', () => {
	for (const key of Object.keys(requiredCiResults())) {
		for (const result of badResults) {
			const results = requiredCiResults();
			results[key] = result;
			assert.throws(() => verifyCiGate({
				eventName: 'pull_request',
				docsOnly: 'false',
				classifyResult: 'success',
				results,
			}), /expected|semantic fuzz concluded/u, `${key}=${result || '<missing>'}`);
		}
	}
});

test('CI gate preserves reviewed non-PR semantic-fuzz omission', () => {
	for (const eventName of ['push', 'workflow_dispatch']) {
		const results = requiredCiResults();
		results.semanticFuzz = 'skipped';
		assert.equal(verifyCiGate({
			eventName,
			docsOnly: 'false',
			classifyResult: 'success',
			results,
		}), 'required-success');
	}
});

test('CI gate rejects unexpected events and malformed classification state', () => {
	assert.throws(() => verifyCiGate({
		eventName: 'schedule',
		docsOnly: 'false',
		classifyResult: 'success',
		results: requiredCiResults(),
	}), /Unsupported CI event/u);
	assert.throws(() => verifyCiGate({
		eventName: 'pull_request',
		docsOnly: 'unknown',
		classifyResult: 'success',
		results: requiredCiResults(),
	}), /Invalid docs_only output/u);
	for (const classifyResult of ['cancelled', 'partial', 'stale', 'timed_out']) {
		assert.throws(() => verifyCiGate({
			eventName: 'pull_request',
			docsOnly: 'false',
			classifyResult,
			results: requiredCiResults(),
		}), new RegExp(`CI classification concluded with ${classifyResult}`, 'u'));
	}
});
