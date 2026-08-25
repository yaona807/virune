import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyCiGate, verifyOptionalFormalGate } from './verify-formal-ci-gate.mjs';

const badResults = ['failure', 'cancelled', 'skipped', 'neutral', 'unknown', ''];

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
	for (const upstreamResult of ['success', 'failure', 'cancelled', 'unknown', '']) {
		assert.throws(() => verifyOptionalFormalGate({
			label: 'performance',
			required: 'false',
			classifyResult: 'success',
			upstreamResult,
		}), /Not-required performance validation concluded with unexpected result/u, upstreamResult || '<missing>');
	}
});

test('optional required lane rejects skipped, failed, cancelled, neutral, unknown, and missing results', () => {
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
	for (const classifyResult of ['failure', 'cancelled', 'skipped', 'unknown', '']) {
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
	assert.throws(() => verifyCiGate({
		eventName: 'pull_request',
		docsOnly: 'false',
		classifyResult: 'cancelled',
		results: requiredCiResults(),
	}), /CI classification concluded with cancelled/u);
});
